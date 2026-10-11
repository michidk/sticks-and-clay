import { test, expect } from "bun:test";
import { runPipeline } from ".";
import { assetReviewPipeline } from "./review";
test("asset review bounds repairs externally and preserves zero-round rendering", async () => {
  for (const rounds of [0, 1, 3]) {
    const steps: string[] = [];
    await runPipeline(assetReviewPipeline(rounds), {
      build: async (n) => {
        steps.push(n.id);
      },
      render: async (n) => {
        steps.push(n.id);
      },
      review: async (n) => {
        steps.push(n.id);
        return { passed: false };
      },
    });
    expect(steps.filter((s) => s.startsWith("review:"))).toHaveLength(rounds);
    expect(steps.filter((s) => s.startsWith("render:"))).toHaveLength(
      Math.max(1, rounds),
    );
  }
});
test("a passing material review ends early", async () => {
  let builds = 0;
  await runPipeline(assetReviewPipeline(5), {
    build: async () => {
      builds++;
    },
    render: async () => {},
    review: async () => ({ passed: true }),
  });
  expect(builds).toBe(1);
});
