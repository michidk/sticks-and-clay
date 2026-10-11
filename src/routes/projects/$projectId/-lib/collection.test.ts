import { expect, test } from "bun:test";
import { pendingCollectionItems } from "./collection";
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
test("failed batches retain a recovery card after all model rows exist", () => {
  const items = pendingCollectionItems(
    [{ ...batch, status: "failed" }],
    Array(3).fill({ batchId: "b" }),
  );
  expect(items).toHaveLength(1);
  expect(items[0].placeholder).toBe(false);
});
