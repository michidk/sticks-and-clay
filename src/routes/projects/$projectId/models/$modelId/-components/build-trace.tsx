import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Lightbulb, MessageSquare, Wrench, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TextSkeleton } from "@/components/loading";
import { StatusBadge } from "@/components/status";
import { fileUrl, money, previewUrl, request } from "@/lib/client";
import { roleLabel } from "@/lib/queue-view";
import type { TraceStep } from "@/lib/build-trace";

type TraceRun = {
  id: string; role: string; iteration: number; status: string; error: string | null;
  estimatedCost: number | null; inputTokens: number; outputTokens: number;
  createdAt: string; finishedAt: string | null; steps: TraceStep[];
};

const icons = { say: MessageSquare, think: Lightbulb, result: CheckCircle2, error: AlertTriangle };
const duration = (run: TraceRun) => {
  if (!run.finishedAt) return "";
  const seconds = Math.round((new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime()) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const toolCalls = (run: TraceRun) => {
  const count = run.steps.filter((step) => step.kind === "tool").length;
  return count ? `${count} tool call${count === 1 ? "" : "s"}` : "";
};

/** What each agent did to build this version, step by step, from its saved session events. */
export function BuildTrace({ modelId, working }: { modelId: string; working: boolean }) {
  const [runs, setRuns] = useState<TraceRun[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setRuns(null);
    const load = async () => {
      try {
        const result = await request<{ runs: TraceRun[] }>(`models/${modelId}/trace`);
        if (!active) return;
        setRuns(result.runs);
        setError("");
        if (working || result.runs.some((run) => run.status === "running")) timer = setTimeout(load, 4000);
      } catch (e) {
        if (active) { setError((e as Error).message); timer = setTimeout(load, 8000); }
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [modelId, working]);
  return <div className="space-y-4">
    <div>
      <h2>Debug</h2>
      <p className="muted">How the agents built this version: what they planned, each tool they used, and the renders they looked at. Full prompts and raw events are under Activity.</p>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!runs && !error && <TextSkeleton />}
    {runs && !runs.length && <p className="muted">No agent work has been recorded for this version yet.</p>}
    {runs?.map((run, index) => <details key={run.id} className="build-trace-run" open={run.status === "running" || index === runs.length - 1}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <strong>{roleLabel(run.role)}</strong>
        <span className="muted">pass {run.iteration + 1}</span>
        <StatusBadge status={run.status} />
        <span className="muted">
          {[duration(run), toolCalls(run),
            run.estimatedCost === null ? "unpriced" : money(run.estimatedCost)].filter(Boolean).join(" · ")}
        </span>
      </summary>
      {run.error && <p className="mt-2 text-destructive">{run.error.split("\n")[0]}</p>}
      {!run.steps.length
        ? <p className="muted mt-2">A single request without agent steps; see Activity for its prompt and output.</p>
        : <ol className="mt-3 space-y-2">{run.steps.map((step, stepIndex) => {
          const Icon = step.kind === "tool" ? (step.ok === false ? XCircle : Wrench) : icons[step.kind];
          const tone = step.kind === "error" || (step.kind === "tool" && step.ok === false) ? "text-destructive" : step.kind === "think" ? "muted" : "";
          return <li key={stepIndex} className="flex gap-2">
            <Icon size={15} className={`mt-1 shrink-0 ${tone}`} aria-hidden="true" />
            <div className="min-w-0">
              {step.kind === "tool" ? <>
                <span className={tone}>{step.summary}</span>
                {step.ok === undefined && run.status === "running" && <span className="muted"> · running</span>}
                {step.note && <span className={`block text-sm ${step.ok === false ? "text-destructive" : "muted"} break-words`}>{step.note}</span>}
                {!!step.images?.length && <div className="mt-1 flex flex-wrap gap-1">{step.images.map((key, imageIndex) =>
                  <a key={key + imageIndex} href={fileUrl(key)} target="_blank" rel="noreferrer" title={step.views?.[imageIndex]}>
                    <img src={previewUrl(key, 320)} alt={`${step.views?.[imageIndex] ?? "Render"} the agent inspected`} loading="lazy" className="h-16 w-16 rounded border object-cover" />
                  </a>)}</div>}
              </> : <p className={`whitespace-pre-wrap break-words ${tone} ${step.kind === "result" ? "font-medium" : ""}`}>
                {step.kind === "think" ? `Thinking: ${step.text}` : step.text}
              </p>}
            </div>
          </li>;
        })}</ol>}
    </details>)}
  </div>;
}
