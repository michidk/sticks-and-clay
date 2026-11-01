import { createHmac, timingSafeEqual } from "node:crypto";
import { artifactDownloadUrl, artifactKey } from "./artifacts.server";
import type { McpConfig } from "./config.server";

const DOWNLOAD_TTL_SECONDS = 5 * 60;

function sign(config: McpConfig, key: string, exp: number) {
  return createHmac("sha256", config.signingSecret).update(`sticks-and-clay:mcp-artifact-download:v2\n${exp}\n${key}`).digest("base64url");
}

export function createArtifactDownload(key: string, config: McpConfig) {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  const url = new URL(artifactDownloadUrl(key, config.serverUrl));
  url.searchParams.set("ticket", `${exp}.${sign(config, key, exp)}`);
  return { downloadUrl: url.toString(), downloadExpiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyArtifactDownload(ticket: string, key: string, config: McpConfig) {
  const [exp, mac, ...rest] = ticket.split(".");
  const expiry = Number(exp);
  if (rest.length || !mac || !Number.isInteger(expiry) || expiry <= Date.now() / 1000 || !artifactKey.safeParse(key).success) return false;
  const expected = Buffer.from(sign(config, key, expiry));
  const supplied = Buffer.from(mac);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
