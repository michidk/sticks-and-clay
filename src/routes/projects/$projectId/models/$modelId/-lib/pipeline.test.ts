import { describe, expect, test } from "bun:test";
import { pipelineSteps, type PipelineRun } from "./pipeline";
import type { Model, Build } from "./model";
const model: Model = {
  id: "m",
  name: "Model",
  prompt: "",
  phase: "Judging",
  progress: 50,
  status: "judging",
};
const run = (
  id: string,
  role: string,
  status = "done",
  result?: PipelineRun["result"],
): PipelineRun => ({
  id,
  modelId: "m",
  role,
  status,
  iteration: 0,
  createdAt: `2026-09-29T10:0${id}:00Z`,
  estimatedCost: null,
  result,
});
describe("recorded pipeline graph", () => {
  test("orders stages chronologically and excludes other models and texture subrequests", () => {
    const steps = pipelineSteps(
      model,
      [
        run("3", "judge"),
        run("2", "photographer"),
        run("1", "builder"),
        run("0", "visual-target"),
        run("4", "texture"),
        { ...run("5", "builder"), modelId: "other" },
      ],
      [],
    );
    expect(steps.map((s) => s.label)).toEqual([
      "Visual target",
      "Build",
      "Photography",
      "Judge",
    ]);
  });
  test("uses judge IDs to associate versions even when iterations repeat", () => {
    const versions: Build[] = ["1", "2"].map((id) => ({
      id,
      modelId: "m",
      iteration: 0,
      status: "done",
      createdAt: "",
      judges: [{ id: "judge-" + id, status: "done" }],
    }));
    const steps = pipelineSteps(model, [run("judge-1", "judge")], versions);
    expect(steps[0].version?.id).toBe("1");
  });
  test("separates changes requested, technical failures, active and interrupted runs", () => {
    const runs = [
      run("1", "judge", "done", { score: 43, passed: false }),
      run("2", "builder", "failed"),
      run("3", "builder", "running"),
    ];
    expect(pipelineSteps(model, runs, []).map((s) => s.state)).toEqual([
      "Changes requested",
      "Failed",
      "Running",
    ]);
    expect(
      pipelineSteps({ ...model, status: "failed" }, runs, []).at(-1)?.state,
    ).toBe("Interrupted");
  });
  test("does not fabricate judges for unreviewed builds", () => {
    expect(
      pipelineSteps(
        { ...model, status: "done" },
        [run("1", "builder")],
        [],
      ).map((s) => s.state),
    ).toEqual(["Complete"]);
  });
});

test("photography links only to its explicitly recorded builder version", () => {
  const version: Build = {
    id: "build",
    modelId: "m",
    iteration: 0,
    status: "done",
    createdAt: "",
    judges: [],
  };
  const photo = run("2", "photographer", "done", {
    photography: { builderRunId: "build" },
  });
  expect(pipelineSteps(model, [photo], [version])[0].version?.id).toBe("build");
  expect(
    pipelineSteps(model, [{ ...photo, result: null }], [version])[0].version,
  ).toBeUndefined();
});

test("only the latest visual target waits for approval", () => {
  const steps = pipelineSteps({ ...model, status: "awaiting_approval" }, [run("0", "visual-target"), run("1", "visual-target")], []);
  expect(steps.map((step) => step.state)).toEqual(["Complete", "Awaiting approval"]);
});
