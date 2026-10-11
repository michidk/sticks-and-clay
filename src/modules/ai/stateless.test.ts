import { expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { statelessResponses } from "../../../eve/agent/stateless";

test("Responses replay sends full messages and preserves function call/output pairing", async () => {
  let request: any;
  const provider = createOpenAI({
    apiKey: "fixture",
    fetch: (async (_url: any, init: any) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "resp_fixture",
          created_at: 1,
          model: "gpt-6-astra",
          output: [],
          usage: { input_tokens: 5, output_tokens: 0 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });
  const model = wrapLanguageModel({
    model: provider.responses("gpt-6-astra"),
    middleware: statelessResponses,
  });
  await model.doGenerate({
    providerOptions: {
      openai: { store: true, previousResponseId: "resp_missing" },
    },
    prompt: [
      { role: "user", content: [{ type: "text", text: "Build a bird" }] },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "private",
            providerOptions: { openai: { itemId: "rs_missing" } },
          },
          {
            type: "text",
            text: "Inspecting the shape",
            providerOptions: {
              openai: { itemId: "msg_missing", phase: "commentary" },
            },
          },
          {
            type: "tool-call",
            toolCallId: "call_keep",
            toolName: "view_render",
            input: { path: "front.png" },
            providerOptions: { openai: { itemId: "fc_missing" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_keep",
            toolName: "view_render",
            output: { type: "text", value: "render inspected" },
          },
        ],
      },
    ],
  });
  expect(request.store).toBe(false);
  expect(request.previous_response_id).toBeUndefined();
  expect(
    request.input.some((item: any) => item.type === "item_reference"),
  ).toBe(false);
  expect(JSON.stringify(request)).not.toContain("msg_missing");
  expect(JSON.stringify(request)).not.toContain("rs_missing");
  expect(
    request.input.find((item: any) => item.role === "assistant").content,
  ).toBe("Inspecting the shape");
  const call = request.input.find((item: any) => item.type === "function_call");
  const output = request.input.find(
    (item: any) => item.type === "function_call_output",
  );
  expect(call.call_id).toBe("call_keep");
  expect(output.call_id).toBe(call.call_id);
});
