import { defineAgent, defineDynamic } from "eve";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { statelessResponses } from "./stateless";
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
function selectedModel(model: string) {
  return wrapLanguageModel({
    model: provider.responses(model),
    middleware: statelessResponses,
  });
}
export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
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
        // Usage events can qualify the model name; the provider expects its raw ID.
        config.model = config.model.replace(/^openai\//, "");
        return {
          model: selectedModel(config.model),
          // Bound application context without requiring gateway catalog metadata.
          modelContextWindowTokens:
            config.model === "gpt-6-astra" ? 1050000 : 200000,
          modelOptions: {
            providerOptions: { openai: { reasoningEffort: config.effort } },
          },
        };
      },
    },
  }),
  defaultTools: false,
  limits: { maxInputTokensPerSession: false, sessionTimeoutMs: false },
});
