import { expect, test } from "bun:test";
import { assetStage, boardColumns } from "./board";

test("board places ideas, owed batch work and the newest iteration of each asset", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  const columns = boardColumns(
    [{ id: "i1", readyAt: null }, { id: "i2", readyAt: at(1) }],
    [
      { id: "a", batchId: "b1", status: "done", acceptedAt: at(2), createdAt: at(1) },
      { id: "a2", batchId: "b2", status: "building", parentModelId: "a", branchKind: "iterate", createdAt: at(3) },
      { id: "c", batchId: "b1", status: "done", createdAt: at(1) },
      { id: "d", batchId: "b3", status: "failed", createdAt: at(1) },
      { id: "e", batchId: "b3", status: "done", acceptedAt: at(4), createdAt: at(2) },
    ],
    [
      { id: "b1", status: "rendering", count: 2 },
      { id: "b4", status: "planning", count: 3 },
      { id: "b5", status: "failed", count: 1 },
    ],
  );
  expect(columns.idea.map((card) => card.idea.id)).toEqual(["i1"]);
  expect(columns.ready.map((card) => card.idea.id)).toEqual(["i2"]);
  expect(columns.progress.map((card) => card.kind === "asset" ? card.asset.id : `${card.batch.id}x${card.owed}`))
    .toEqual(["b4x3", "b5x1", "a2", "d"]);
  expect(columns.progress.find((card) => card.kind === "asset" && card.asset.id === "a2")).toMatchObject({ attempts: 2 });
  expect(columns.review.map((card) => card.asset.id)).toEqual(["c"]);
  expect(columns.done.map((card) => card.asset.id)).toEqual(["e"]);
  expect(assetStage({ status: "awaiting_approval", acceptedAt: null })).toBe("progress");
});
