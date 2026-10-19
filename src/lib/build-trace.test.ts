import { expect, test } from "bun:test";
import { buildTrace } from "./build-trace";

const at = "2026-10-19T10:00:00.000Z";
const call = (callId: string, toolName: string, input: object) =>
  ({ type: "actions.requested", createdAt: at, payload: { actions: [{ kind: "tool-call", callId, toolName, input }] } });
const result = (callId: string, payload: object) =>
  ({ type: "action.result", createdAt: at, payload: { ...payload, result: { callId, ...(payload as any).result } } });

test("a build run condenses to narration, tool calls with outcomes, and its result", () => {
  const steps = buildTrace([
    { type: "message.completed", createdAt: at, payload: { message: " I’ll keep the pivots. " } },
    { type: "reasoning.completed", createdAt: at, payload: { reasoning: "**Checking export****Fixing pivots**" } },
    call("a", "asset_workspace", { operation: "write", code: "a\nb\nc" }),
    call("b", "asset_workspace", { operation: "run" }),
    result("b", { result: { output: { ok: true, metrics: { triangles: 5400, materials: [{}, {}] } } } }),
    call("c", "view_render", { view: "preview_front" }),
    result("c", { result: { output: { view: "front", imageKey: "vision/x.png" } } }),
    call("c2", "view_render", { view: "rear", crop: [0, 0, 1, 1] }),
    result("c2", { result: { output: { view: "rear", imageKey: "vision/y.png" } } }),
    call("d", "asset_workspace", { operation: "run" }),
    result("d", { result: { output: { ok: false, lastGoodRetained: true, log: "Traceback\nKeyError: 'wheel'\n" } } }),
    call("e", "generate_texture", { name: "brass" }),
    result("e", { status: "failed", error: { message: "ECONNREFUSED" }, result: { isError: true } }),
    call("f", "connection_execute", { tool: "photograph_asset", input: { elevation: 30, front_azimuth: -115 } }),
    { type: "turn.failed", createdAt: at, payload: { details: { detail: "RetryError: limit\n at stack" } } },
    { type: "result.completed", createdAt: at, payload: { result: { summary: "Built the car." } } },
  ]);
  expect(steps.map(({ at: _, ...step }) => step)).toEqual([
    { kind: "say", text: "I’ll keep the pivots." },
    { kind: "think", text: "Checking export · Fixing pivots" },
    { kind: "tool", summary: "Wrote the build script (3 lines)" },
    { kind: "tool", summary: "Ran the Blender build", ok: true, note: "5,400 triangles · 2 materials" },
    { kind: "tool", summary: "Looked at the preview front, rear (zoomed) renders", ok: true, views: ["preview front", "rear (zoomed)"], images: ["vision/x.png", "vision/y.png"] },
    { kind: "tool", summary: "Ran the Blender build", ok: false, note: "KeyError: 'wheel' · kept the last good build" },
    { kind: "tool", summary: "Generated texture “brass”", ok: false, note: "ECONNREFUSED" },
    { kind: "tool", summary: "Photographed the asset (30° elevation, -115° azimuth)" },
    { kind: "error", text: "RetryError: limit" },
    { kind: "result", text: "Built the car." },
  ]);
});
