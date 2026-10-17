import { expect, test } from "bun:test";
import { describeError } from "./error-message";

test("usage limits name the model and the next step", () => {
  const message = describeError(
    "Error: 429 All credentials for model gpt-6-sol are cooling down (last error: usage_limit_reached: The usage limit has been reached)",
  );
  expect(message).toContain("usage limit for gpt-6-sol");
  expect(message).toContain("Admin → Agents");
  expect(message).not.toContain("cooling down");
});

test("other errors keep their text without the Error prefix", () => {
  expect(describeError("Error: Brief is required")).toBe("Brief is required");
  expect(describeError(null)).toBe("");
});
