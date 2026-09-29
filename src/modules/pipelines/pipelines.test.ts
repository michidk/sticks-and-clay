import { expect, test } from "bun:test";
import { modelReviewPipeline, runPipeline } from "./index";
import { executionPolicy, roles } from "../ai/roles";

test("role registry selects one-shot or resumable execution, including legacy designer", () => {
  for (const role of ["project-brief", "model-brief", "designer"] as const)
    expect(executionPolicy(role)).toEqual({
      engine: "tanstack",
      resumable: false,
    });
  for (const role of ["builder", "judge", "planner"] as const)
    expect(executionPolicy(role)).toEqual({ engine: "eve", resumable: true });
  expect(executionPolicy("designer", true).engine).toBe("eve");
  expect(roles.judge.schema.safeParse({ passed: true }).success).toBe(false);
});

test("review composition: zero, early pass, exhaustion, feedback ordering", async () => {
  for (const [rounds, passAt, expected] of [
    [0, -1, ["builder:0"]],
    [3, 0, ["builder:0", "judge:0"]],
    [2, -1, ["builder:0", "judge:0", "builder:1", "judge:1"]],
  ] as const) {
    const seen: string[] = [];
    let feedback = -1;
    await runPipeline(modelReviewPipeline(rounds), {
      builder: async (node) => {
        expect(feedback).toBe(node.iteration - 1);
        seen.push(node.id);
      },
      judge: async (node) => {
        feedback = node.iteration;
        seen.push(node.id);
        return { passed: node.iteration === passAt };
      },
    });
    expect(seen).toEqual([...expected]);
  }
});

test("invalid graphs and cancellation cannot start downstream work", async () => {
  let calls = 0;
  const handlers = {
    builder: async () => {
      calls++;
    },
    judge: async () => {},
  };
  await expect(
    runPipeline(
      {
        id: "bad",
        version: 1,
        nodes: [{ id: "a", task: "builder", iteration: 0, next: "a" }],
      },
      handlers,
    ),
  ).rejects.toThrow("cycle");
  expect(calls).toBe(0);
  await expect(
    runPipeline(modelReviewPipeline(2), handlers, async () => {
      throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(calls).toBe(0);
  expect(() => modelReviewPipeline(-1)).toThrow();
});

test("quality pipeline gates surface work, permits early geometry pass, and retains zero-review semantics", async () => {
  const { qualityPipeline } = await import("./index");
  for (const [rounds, geometryPass, expected] of [
    [0, false, ["builder:0"]],
    [2, false, ["builder:0", "judge:0", "builder:1", "judge:1"]],
    [2, true, ["builder:0", "judge:0", "builder:2", "judge:2"]],
  ] as const) {
    const seen: string[] = [];
    await runPipeline(qualityPipeline(rounds), {
      builder: async (node) => {
        seen.push(node.id);
      },
      judge: async (node) => {
        seen.push(node.id);
        return { passed: node.stage === "surface" || geometryPass };
      },
    });
    expect(seen).toEqual([...expected]);
  }
});
