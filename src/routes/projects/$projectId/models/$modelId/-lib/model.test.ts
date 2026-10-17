import { test, expect } from "bun:test";
import { resolveBuild, modelStatus, type Model, type Build } from "./model";
const artifacts = {
  glb: "versions/latest/asset.glb",
  blend: "versions/latest/source.blend",
  renders: [],
  metrics: {},
};
const model: Model = {
  id: "model",
  name: "test",
  prompt: "test",
  status: "done",
  phase: "done",
  progress: 100,
  verdict: "limit_reached",
  artifacts,
  visualTarget: "current.png",
};
test("an unavailable or failed historical version never borrows latest exports or target", () => {
  const versions: Build[] = [
    {
      id: "failed",
      modelId: "model",
      iteration: 0,
      status: "failed",
      createdAt: "",
      judges: [],
    },
  ];
  expect(resolveBuild(model, versions, "missing")).toMatchObject({
    missing: true,
    artifacts: undefined,
    target: undefined,
  });
  expect(resolveBuild(model, versions, "failed")).toMatchObject({
    missing: false,
    artifacts: undefined,
    target: undefined,
  });
  expect(resolveBuild(model, versions).artifacts).toBe(artifacts);
});
test("historical media and feedback stay associated with their own model and iteration", () => {
  const old = {
    ...artifacts,
    glb: "versions/old/asset.glb",
    visualTarget: "old.png",
  };
  const review = {
    score: 40,
    passed: false,
    summary: "old review",
    improvements: [],
  };
  const versions: Build[] = [
    {
      id: "old",
      modelId: "model",
      iteration: 0,
      status: "done",
      createdAt: "",
      artifacts: old,
      judges: [{ id: "judge", status: "done", result: review }],
    },
  ];
  expect(resolveBuild(model, versions, "old")).toMatchObject({
    artifacts: old,
    feedback: review,
    target: "old.png",
  });
  expect(
    resolveBuild({ ...model, id: "another" }, versions, "old").missing,
  ).toBe(true);
  expect(modelStatus(model)).toBe("Completed with issues");
});
