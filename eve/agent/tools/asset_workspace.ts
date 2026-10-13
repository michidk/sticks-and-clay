import { defineTool, defineDynamic } from "eve/tools";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const workspaceTool = defineTool({
  description:
    "Builder-only script workspace. Read asset.py (bounded line ranges), write its complete source, edit exactly one matching text block, or run the saved script using the fixed render.py runner. Parameters and support files are read-only. Use mode quick for previews and final for delivery; inspect images with view_render. No arbitrary file paths or shell commands.",
  inputSchema: z.object({
    capability: z.string().uuid(),
    operation: z.enum(["read", "write", "edit", "run"]),
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    code: z.string().min(1).max(200000).optional(),
    oldText: z.string().min(1).optional(),
    newText: z.string().optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    mode: z.enum(["quick", "final"]).default("quick"),
  }),
  async execute(input, options) {
    const url =
      process.env.BLENDER_RUNNER_URL ||
      new URL(
        "/workspace",
        process.env.BLENDER_MCP_URL || "http://127.0.0.1:33442/mcp",
      ).href;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: options.abortSignal,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Asset workspace operation failed");
    return result;
  },
});

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
      return config.role === "builder" ? workspaceTool : null;
    },
  },
});
