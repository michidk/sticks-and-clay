import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
export async function provider() {
  let auth: any = {},
    config: any = {};
  try {
    auth = JSON.parse(
      await readFile(join(homedir(), ".codex/auth.json"), "utf8"),
    );
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw new Error("Cannot read configured API credentials");
  }
  try {
    config = parse(
      await readFile(join(homedir(), ".codex/config.toml"), "utf8"),
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw new Error("Cannot read configured provider");
  }
  const selected = config.model_providers?.[config.model_provider] || {};
  const key =
    auth.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env[selected.env_key];
  const url =
    process.env.OPENAI_BASE_URL ||
    selected.base_url ||
    "https://api.openai.com/v1";
  if (!key) throw new Error("No configured API credential available");
  return { key, url };
}
