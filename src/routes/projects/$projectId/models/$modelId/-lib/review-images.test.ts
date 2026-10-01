import { expect, test } from "bun:test";
import { reviewImageNumbers } from "./review-images";

test("review links resolve actual render numbers and ranges, excluding reference images", () => {
  expect(
    reviewImageNumbers(
      "Image 3 — forehead; Images 4–6 — flanks; Image 8 concept",
      7,
    ),
  ).toEqual([3, 4, 5, 6]);
  expect(reviewImageNumbers("Images 1–7; Image 3 detail", 3)).toEqual([
    1, 2, 3,
  ]);
  expect(reviewImageNumbers("Front view at 1024px", 7)).toEqual([]);
  expect(reviewImageNumbers("Image 1", 0)).toEqual([]);
});
