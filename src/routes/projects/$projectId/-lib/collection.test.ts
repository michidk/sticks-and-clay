import { expect, test } from "bun:test";
import { failedBatchFor, pendingCollectionItems } from "./collection";
const batch = { id: "b", count: 3, prompt: "Ships", status: "queued" };
test("queued requests occupy one card per model and disappear as models are created", () => {
  expect(pendingCollectionItems([batch], [])).toHaveLength(3);
  expect(pendingCollectionItems([batch], [{ batchId: "b" }])).toHaveLength(2);
  expect(
    pendingCollectionItems([batch], Array(3).fill({ batchId: "b" })),
  ).toHaveLength(0);
});
test("other batches do not consume slots and finished batches do not create placeholders", () => {
  expect(pendingCollectionItems([batch], [{ batchId: "other" }])).toHaveLength(
    3,
  );
  expect(
    pendingCollectionItems([{ ...batch, status: "done" }], []),
  ).toHaveLength(0);
});
test("a batch that failed after its models exist attaches to those models instead of a card", () => {
  const failed = { ...batch, status: "failed", error: "Render timed out" };
  const models = Array(3).fill({ batchId: "b" });
  expect(pendingCollectionItems([failed], models)).toHaveLength(0);
  expect(failedBatchFor([failed], models)).toBe(failed);
  expect(failedBatchFor([failed], [{ batchId: "other" }])).toBeUndefined();
  expect(failedBatchFor([batch], models)).toBeUndefined();
});
