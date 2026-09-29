import { defineAgent } from "eve";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});
export default defineAgent({
  model: wrapLanguageModel({
    model: provider.responses(process.env.STUDIO_MODEL || "gpt-6-sol"),
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
  }),
  defaultTools: false,
  limits: { maxInputTokensPerSession: false, sessionTimeoutMs: 1800000 },
});
