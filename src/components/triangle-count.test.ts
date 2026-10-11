import { expect, test } from "bun:test";
import { triangleCounts } from "./triangle-count";

test("uses handover counts for simplified exports", () => {
  expect(
    triangleCounts({
      handover: {
        cleanup: { triangles: { before: 3_200, after: 1_600 } },
      },
      metrics: { triangles: 1_600 },
    }),
  ).toEqual({ before: 3_200, after: 1_600 });
});

test("falls back to the published metric for older and skipped exports", () => {
  expect(triangleCounts({ metrics: { triangles: 900 } })).toEqual({
    after: 900,
  });
  expect(
    triangleCounts({
      handover: { cleanup: { status: "skipped" } },
      metrics: { triangles: 700 },
    }),
  ).toEqual({ after: 700 });
});
