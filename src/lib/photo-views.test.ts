import { test, expect } from "bun:test";
import { REVIEW_VIEWS, judgeImageLabels } from "./photo-views";
test("judge labels distinguish seven current renders and three legacy renders from references", () => {
  const images = REVIEW_VIEWS.map((v) => `versions/run/${v}.png`);
  expect(judgeImageLabels(images, true)).toContain(
    "Image 7: actual render — bottom",
  );
  expect(judgeImageLabels(images, true)).toContain(
    "Image 8: concept visual target",
  );
  expect(judgeImageLabels(images.slice(0, 3), true)).toContain(
    "Image 4: concept visual target",
  );
  expect(judgeImageLabels(images, false)).not.toContain("Image 8");
});
