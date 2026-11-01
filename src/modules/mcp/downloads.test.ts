import { expect, setSystemTime, test } from "bun:test";
import { createArtifactDownload, verifyArtifactDownload } from "./downloads.server";
import { resolveMcpConfig } from "./config.server";

const config = resolveMcpConfig({ MCP_PUBLIC_URL: "https://studio.example/api/mcp", MCP_SECRET: "fixture-secret-".repeat(3) });
const ticketOf = (key: string, c = config) => new URL(createArtifactDownload(key, c).downloadUrl).searchParams.get("ticket") ?? "";

test("download links expire after five minutes", () => {
  const key = "exports/fixture/collection.zip";
  const now = Math.floor(Date.now() / 1000);
  try {
    setSystemTime(new Date(now * 1000));
    const link = createArtifactDownload(key, config);
    const ticket = new URL(link.downloadUrl).searchParams.get("ticket") ?? "";
    expect(link.downloadExpiresAt).toBe(new Date((now + 300) * 1000).toISOString());
    expect(verifyArtifactDownload(ticket, key, config)).toBe(true);
    setSystemTime(new Date((now + 300) * 1000));
    expect(verifyArtifactDownload(ticket, key, config)).toBe(false);
  } finally { setSystemTime(); }
});

test("download tickets are bound to one artifact and signing secret", () => {
  const key = "graphics/fixture/image.png";
  const ticket = ticketOf(key);
  expect(verifyArtifactDownload(ticket, key, config)).toBe(true);
  expect(verifyArtifactDownload(ticket, "graphics/fixture/other.png", config)).toBe(false);
  expect(verifyArtifactDownload(ticket, key, { ...config, signingSecret: "rotated".repeat(10) })).toBe(false);
  expect(verifyArtifactDownload("garbage", key, config)).toBe(false);
});
