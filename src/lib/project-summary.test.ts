import { expect, test } from "bun:test";
import { collectionSummary, projectState } from "./project-summary";

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
