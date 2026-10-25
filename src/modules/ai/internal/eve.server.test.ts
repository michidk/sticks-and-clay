import { expect, test } from "bun:test";
import { parseStructuredOutput } from "./eve.server";

test("recovers structured output from a final JSON message", () => {
  expect(parseStructuredOutput('{"score":29}')).toEqual({ score: 29 });
  expect(parseStructuredOutput("```json\n{\"score\":29}\n```")).toEqual({ score: 29 });
  expect(parseStructuredOutput("The response was interrupted")).toBeUndefined();
});
