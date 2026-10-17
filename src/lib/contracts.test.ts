import { test, expect } from "bun:test";
import {
  price,
  nextStage,
  judgeResult,
  planResult,
  projectNameResult,
} from "./contracts";
test("token pricing includes cache discount and ignores provider charges", () => {
  expect(
    price(1000000, 100000, 400000, { input: 2, cached: 0.2, output: 10 }),
  ).toBeCloseTo(2.28);
});
test("cannot discount more cached tokens than input", () => {
  expect(price(10, 0, 100, { input: 2, cached: 1, output: 10 })).toBe(0.00001);
});
test("review stops early on approval or at limit", () => {
  expect(nextStage(true, 0, 3)).toBe("approved");
  expect(nextStage(false, 3, 3)).toBe("limit_reached");
  expect(nextStage(false, 1, 3)).toBe("revise");
});
test("judge response requires actionable structured feedback", () => {
  expect(
    judgeResult.safeParse({
      passed: false,
      score: 101,
      summary: "bad",
      improvements: [],
    }).success,
  ).toBe(false);
  expect(planResult.safeParse({ models: [] }).success).toBe(false);
});
test("generated project names are trimmed and bounded", () => {
  expect(projectNameResult.parse({ name: "  Mosslight Hollow  " })).toEqual({
    name: "Mosslight Hollow",
  });
  expect(projectNameResult.safeParse({ name: "" }).success).toBe(false);
  expect(projectNameResult.safeParse({ name: "x".repeat(101) }).success).toBe(
    false,
  );
});

test("idea titles are trimmed and bounded; saved ideas need a brief", async () => {
  const { ideaInput } = await import("./api-inputs");
  const { ideaTitleResult } = await import("./contracts");
  expect(ideaTitleResult.parse({ title: "  Oak Chair " })).toEqual({ title: "Oak Chair" });
  expect(ideaTitleResult.safeParse({ title: "" }).success).toBe(false);
  expect(ideaTitleResult.safeParse({ title: "x".repeat(101) }).success).toBe(false);
  const idea = { count: 1, judgeIterations: 0 };
  expect(ideaInput.safeParse(idea).success).toBe(false);
  expect(ideaInput.safeParse({ ...idea, prompt: "   " }).success).toBe(false);
  expect(ideaInput.safeParse({ ...idea, prompt: "A chair", title: "x".repeat(101) }).success).toBe(false);
  expect(ideaInput.parse({ ...idea, prompt: " A chair " })).toMatchObject({ prompt: "A chair", title: "" });
});
