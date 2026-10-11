import { defineTool, defineDynamic } from "eve/tools";
import { z } from "zod";
const tool = defineTool({
  description:
    "Builder-only: generate a base-color texture using the image-generation API. Returns a PNG path to load into Blender materials. Describe a flat, seamless, evenly lit material and match the design palette. Never call in poly mode.",
  inputSchema: z.object({
    capability: z.string().uuid(),
    name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    prompt: z.string().min(20).max(8000),
    references: z.array(z.string()).max(4).default([]),
  }),
  async execute(input, options) {
    const response = await fetch(
      `${process.env.STUDIO_APP_URL || "http://127.0.0.1:34193"}/api/textures/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: options.abortSignal,
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Texture generation failed");
    return result;
  },
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const config = JSON.parse(
        await readFile(
          resolve(
            process.env.STUDIO_DATA_DIR || "../data",
            "session-config",
            ctx.session.id + ".json",
          ),
          "utf8",
        ).catch(() => "{}"),
      );
      return config.role === "builder" ? tool : null;
    },
  },
});
