import { defineAgent, defineDynamic } from "eve";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
function selectedModel(model: string) {
  return wrapLanguageModel({
    model: provider.responses(model),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        prompt: params.prompt.map((message) =>
          message.role === "assistant"
            ? {
                ...message,
                content: message.content.filter(
                  (part) => part.type !== "reasoning",
                ),
              }
            : message,
        ),
      }),
    },
  });
}
export default defineAgent({
  model: defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        let config: { model: string; effort: "low" | "medium" | "high" };
        try {
          config = JSON.parse(
            await readFile(
              resolve(
                process.env.STUDIO_DATA_DIR || "../data",
                "session-config",
                ctx.session.id + ".json",
              ),
              "utf8",
            ),
          );
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
          config = {
            model: process.env.STUDIO_MODEL || "gpt-6-sol",
            effort: "medium",
          };
        }
        return {
          model: selectedModel(config.model),
          modelOptions: {
            providerOptions: { openai: { reasoningEffort: config.effort } },
          },
        };
      },
    },
  }),
  defaultTools: false,
  limits: { maxInputTokensPerSession: false, sessionTimeoutMs: 1800000 },
});
