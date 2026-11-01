import { expect, test } from "bun:test";
import { textModel } from "./text-model";

test("retired Astra selections use Sol, including qualified saved models", () => {
  expect(textModel("gpt-6-astra")).toBe("gpt-6-sol");
  expect(textModel("openai/gpt-6-astra")).toBe("gpt-6-sol");
  expect(textModel("gpt-6-sol")).toBe("gpt-6-sol");
  expect(textModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
});
