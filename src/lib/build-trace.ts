/** A high-level account of what an agent did in one run, condensed from its saved Eve events. */
export type TraceStep = { at: string } & (
  | { kind: "say" | "think" | "result" | "error"; text: string }
  | { kind: "tool"; summary: string; ok?: boolean; note?: string; images?: string[]; views?: string[] }
);

/** The event types a trace reads; the rest (usage, turn bookkeeping) add nothing at this level. */
export const traceEventTypes = ["message.completed", "reasoning.completed", "actions.requested", "action.result", "turn.failed", "result.completed"];

type Event = { type: string; payload: unknown; createdAt: Date | string };
type Input = Record<string, any>;

const lines = (text: unknown) => (typeof text === "string" ? text.split("\n").length : 0);
const clip = (text: string, max = 240) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
const lastLine = (text: unknown) =>
  typeof text === "string" ? clip(text.trim().split("\n").filter(Boolean).at(-1) ?? "") : "";

function describe(tool: string, input: Input): string {
  if (tool === "asset_workspace") {
    if (input.operation === "read") return `Read the build script (from line ${input.offset ?? 1})`;
    if (input.operation === "write") return `Wrote the build script (${lines(input.code)} lines)`;
    if (input.operation === "edit") return `Edited the build script (${lines(input.oldText)} → ${lines(input.newText)} lines)`;
    if (input.operation === "run") return "Ran the Blender build";
  }
  if (tool === "generate_texture") return `Generated texture “${input.name}”`;
  if (tool === "connection_search") return `Searched Blender tools for “${input.query}”`;
  if (tool === "connection_execute") return describe(`blender__${input.tool}`, input.input ?? {});
  if (tool === "blender__photograph_asset") return `Photographed the asset (${input.elevation ?? 0}° elevation, ${input.front_azimuth ?? 0}° azimuth)`;
  if (tool === "blender__get_scene_info") return "Inspected the Blender scene";
  return `Called ${tool.replace(/^blender__/, "Blender ")}`;
}

/** What a tool result adds: success, a short note, and any image the agent looked at. */
function outcome(result: any) {
  const output = result?.result?.output;
  if (result?.status === "failed" || result?.result?.isError)
    return { ok: false, note: clip(result?.error?.message || lastLine(output) || "Tool failed") };
  if (!output || typeof output !== "object") return { ok: true };
  if (typeof output.imageKey === "string") return { ok: true, images: [output.imageKey as string] };
  if (output.ok === false)
    return { ok: false, note: [lastLine(output.log), output.lastGoodRetained ? "kept the last good build" : ""].filter(Boolean).join(" · ") || "Failed" };
  const metrics = output.metrics;
  if (metrics && typeof metrics === "object")
    return { ok: true, note: [
      typeof metrics.triangles === "number" && `${metrics.triangles.toLocaleString("en-US")} triangles`,
      Array.isArray(metrics.materials) && `${metrics.materials.length} materials`,
      metrics.preview && "preview build",
    ].filter(Boolean).join(" · ") };
  return { ok: output.ok ?? true };
}

/** Reasoning summaries arrive as bold headings ("**Checking export****Fixing pivots**"). */
const headings = (text: string) => {
  const titles = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((match) => match[1].trim());
  return titles.length ? titles.join(" · ") : clip(text);
};

export function buildTrace(events: Event[]): TraceStep[] {
  const steps: TraceStep[] = [];
  const calls = new Map<string, number>();
  for (const event of events) {
    const payload = (event.payload ?? {}) as any;
    const at = new Date(event.createdAt).toISOString();
    if (event.type === "message.completed" && payload.message?.trim())
      steps.push({ at, kind: "say", text: payload.message.trim() });
    else if (event.type === "reasoning.completed" && payload.reasoning?.trim())
      steps.push({ at, kind: "think", text: headings(payload.reasoning) });
    else if (event.type === "actions.requested")
      for (const action of payload.actions ?? []) {
        if (action.kind !== "tool-call") continue;
        calls.set(action.callId, steps.length);
        const input = action.input ?? {};
        steps.push(action.toolName === "view_render"
          ? { at, kind: "tool", summary: "", views: [`${String(input.view ?? "render").replaceAll("_", " ")}${input.crop ? " (zoomed)" : ""}`] }
          : { at, kind: "tool", summary: describe(action.toolName, input) });
      }
    else if (event.type === "action.result") {
      const index = calls.get(payload.result?.callId);
      const step = index === undefined ? undefined : steps[index];
      if (step?.kind === "tool") Object.assign(step, outcome(payload));
    } else if (event.type === "turn.failed")
      steps.push({ at, kind: "error", text: clip(payload.details?.detail?.split("\n")[0] || payload.message || payload.code || "The run failed") });
    else if (event.type === "result.completed" && typeof payload.result?.summary === "string")
      steps.push({ at, kind: "result", text: payload.result.summary });
  }
  // Consecutive inspections read as one look at several renders.
  const merged: TraceStep[] = [];
  for (const step of steps) {
    const last = merged.at(-1);
    if (step.kind === "tool" && step.views && last?.kind === "tool" && last.views && last.ok !== false && step.ok !== false) {
      last.views.push(...step.views);
      last.images = [...(last.images ?? []), ...(step.images ?? [])];
    } else merged.push(step.kind === "tool" && step.views ? { ...step, views: [...step.views] } : step);
  }
  for (const step of merged)
    if (step.kind === "tool" && step.views) step.summary = `Looked at the ${step.views.join(", ")} render${step.views.length > 1 ? "s" : ""}`;
  return merged;
}
