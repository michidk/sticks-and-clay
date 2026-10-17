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

test("visual targets awaiting approval need attention without counting as active work", () => {
  expect(collectionSummary([{ status: "awaiting_approval" }], [])).toEqual({ total: 1, queued: 0, active: 0, completed: 0, attention: 1 });
});

test("run results drop the repeated artifact record but keep the files other views look up", async () => {
  const { slimResult } = await import("./project-summary");
  expect(slimResult({ summary: "s", artifacts: { glb: "a.glb", blend: "a.blend", metrics: { big: 1 } } }))
    .toEqual({ summary: "s", artifacts: { glb: "a.glb", blend: "a.blend" } });
  expect(slimResult({ key: "k.png" })).toEqual({ key: "k.png" });
  expect(slimResult(null)).toBeNull();
});

test("asset identity groups versions without requiring their parent chain", () => {
  const versions = [
    { id: "v3", assetId: "asset-a", status: "done", parentModelId: "missing", branchKind: "iterate" as const, createdAt: "2026-01-03T00:00:00Z" },
    { id: "v1", assetId: "asset-a", status: "done", createdAt: "2026-01-01T00:00:00Z" },
    { id: "fork", assetId: "asset-b", status: "done", parentModelId: "v3", branchKind: "fork" as const, createdAt: "2026-01-04T00:00:00Z" },
  ];
  expect(collectionAssetGroups(versions).map((group) => ({ root: group.root.id, latest: group.representative.id, versions: group.assets.map((version) => version.id) }))).toEqual([
    { root: "v1", latest: "v3", versions: ["v3", "v1"] },
    { root: "fork", latest: "fork", versions: ["fork"] },
  ]);
});

test("an asset ID prevents legacy parent metadata from joining another asset", () => {
  const groups = collectionAssetGroups([
    { id: "a", assetId: "asset-a", status: "done" },
    { id: "b", assetId: "asset-b", status: "building", parentModelId: "a", branchKind: "iterate" as const },
  ]);
  expect(groups.map((group) => group.assets.map((version) => version.id))).toEqual([["a"], ["b"]]);
});
