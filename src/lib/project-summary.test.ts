import { expect, test } from "bun:test";
import {
  collectionAssetGroups,
  collectionSummary,
  projectState,
} from "./project-summary";

test("approved design does not imply that queued or failed assets are ready", () => {
  const queued = collectionSummary([{ batchId: "a", status: "queued" }], []);
  expect(projectState("ready", queued).label).toBe("1 queued");
  expect(projectState("review", queued).label).toBe("Review design");
  const issues = collectionSummary(
    [{ batchId: "a", status: "done", verdict: "limit_reached" }],
    [],
  );
  expect(issues.completed).toBe(1);
  expect(projectState("ready", issues).tone).toBe("warning");
});

test("planned slots are replaced by model rows without losing failed batch recovery", () => {
  const models = [
    { batchId: "a", status: "building" },
    { batchId: "a", status: "done" },
  ];
  expect(
    collectionSummary(models, [{ id: "a", status: "planning", count: 3 }]),
  ).toEqual({ total: 3, active: 2, queued: 0, completed: 1, attention: 0 });
  expect(
    collectionSummary(models, [{ id: "a", status: "failed", count: 2 }]),
  ).toEqual({ total: 2, active: 1, queued: 0, completed: 1, attention: 1 });
  expect(projectState("ready", collectionSummary([], [])).label).toBe(
    "Ready to generate",
  );
});

test("prompt iterations replace their model in collection summaries while forks remain separate", () => {
  const original = {
    id: "original",
    batchId: "a",
    status: "done",
    createdAt: "2026-01-01T00:00:00Z",
  };
  const iteration = {
    id: "iteration",
    batchId: "b",
    status: "building",
    parentModelId: "original",
    branchKind: "iterate" as const,
    createdAt: "2026-01-02T00:00:00Z",
  };
  const fork = {
    id: "fork",
    batchId: "c",
    status: "done",
    parentModelId: "iteration",
    branchKind: "fork" as const,
    createdAt: "2026-01-03T00:00:00Z",
  };

  const groups = collectionAssetGroups([original, iteration, fork]);
  expect(groups).toHaveLength(2);
  expect(groups[0].representative.id).toBe("iteration");
  expect(groups[0].assets.map((asset) => asset.id)).toEqual([
    "original",
    "iteration",
  ]);
  expect(groups[1].representative.id).toBe("fork");
  expect(collectionSummary([original, iteration, fork], [])).toEqual({
    total: 2,
    active: 1,
    queued: 0,
    completed: 1,
    attention: 0,
  });
});
