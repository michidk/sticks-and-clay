import type { LanguageModelMiddleware } from "ai";

/** Replay local content, never ask the gateway to retrieve non-persisted items. */
export const statelessResponses: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    providerOptions: {
      ...params.providerOptions,
      openai: {
        ...params.providerOptions?.openai,
        store: false,
        previousResponseId: undefined,
        conversation: undefined,
      },
    },
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
};
