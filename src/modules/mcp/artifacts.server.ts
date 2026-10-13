import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { assertStoragePath, fileMimeType, storageUrl } from "../../lib/storage/path";
import { readStoredFile } from "../../lib/storage.server";
import { result } from "./api.server";

const artifactRoots = new Set([
  "references", "models", "versions", "graphics", "collections", "photographs",
  "project-photographs", "imports", "materials", "presentations", "assignments",
]);
export const artifactKey = z.string().min(1).max(1024).refine((key) => {
  try { assertStoragePath(key); } catch { return false; }
  return artifactRoots.has(key.split("/")[0]) && !key.split("/").some((part) => part.startsWith("."));
}, "Choose an artifact key returned by the application; internal state is not accessible");
const MAX_INLINE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function artifactDownloadUrl(key: string, publicUrl: URL) {
  return new URL(storageUrl(artifactKey.parse(key)).replace("/api/files/", "/api/mcp/files/"), publicUrl).toString();
}

export function registerArtifacts(server: McpServer, options: {
  scopes: readonly string[];
  publicUrl: URL;
  readFile?: typeof readStoredFile;
}) {
  if (!options.scopes.includes("sticks-and-clay:read")) return;
  const load = options.readFile ?? readStoredFile;
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("read_artifact", {
    description: "Get a saved artifact's size, format, MCP resource URI and authenticated download URL. Use an application-returned key; downloads require the same OAuth bearer token.",
    inputSchema: z.object({ key: artifactKey }).strict(),
    outputSchema: z.object({ data: z.object({ key: z.string(), mimeType: z.string(), sizeBytes: z.number(), downloadUrl: z.string().url(), resourceUri: z.string() }) }),
    annotations,
  }, async ({ key }) => {
    try {
      const blob = await load(key);
      const data = { key, mimeType: fileMimeType(key), sizeBytes: blob.size, downloadUrl: artifactDownloadUrl(key, options.publicUrl), resourceUri: `sticks-and-clay://files/${encodeURIComponent(key)}` };
      return {
        ...result({ data }),
        content: [
          { type: "text", text: JSON.stringify({ data }) },
          { type: "resource_link", uri: data.resourceUri, name: key.split("/").pop() ?? key, mimeType: data.mimeType, size: data.sizeBytes },
        ],
      };
    } catch { return result({ data: { error: "Artifact unavailable" } }, true); }
  });
  server.registerTool("view_image", {
    description: "Inspect pixels of a saved reference, render, graphic or material map up to 8 MiB. Binary models and source bundles use read_artifact.",
    inputSchema: z.object({ key: artifactKey }).strict(),
    annotations,
  }, async ({ key }) => {
    const mimeType = fileMimeType(key);
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return result({ data: { error: "Choose a PNG, JPEG or WebP artifact" } }, true);
    try {
      const blob = await load(key);
      if (blob.size > MAX_IMAGE_BYTES) return result({ data: { error: "Image exceeds the 8 MiB inline limit; use read_artifact" } }, true);
      return { resultType: "complete", content: [{ type: "image", mimeType, data: Buffer.from(await blob.arrayBuffer()).toString("base64") }] };
    } catch { return result({ data: { error: "Image unavailable" } }, true); }
  });
  server.registerResource("artifact", new ResourceTemplate("sticks-and-clay://files/{key}", { list: undefined }),
    { description: "Read a saved artifact up to 16 MiB. Larger assets use read_artifact's authenticated download URL." },
    async (uri, variables) => {
      const key = artifactKey.parse(typeof variables.key === "string" ? decodeURIComponent(variables.key) : undefined);
      const blob = await load(key);
      if (blob.size > MAX_INLINE_BYTES) throw new Error("Artifact exceeds 16 MiB; use the authenticated download URL from read_artifact");
      const mimeType = fileMimeType(key);
      return { contents: [{ uri: uri.toString(), mimeType, ...(mimeType === "application/json" || mimeType.startsWith("text/")
        ? { text: await blob.text() } : { blob: Buffer.from(await blob.arrayBuffer()).toString("base64") }) }] };
    });
}
