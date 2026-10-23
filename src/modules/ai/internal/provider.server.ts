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

/** The Codex gateway overrides requested quality and size; the official Images API honours them. */
export async function imageProvider(kind: "gateway" | "openai") {
  if (kind === "gateway") return provider();
  const key = process.env.OPENAI_IMAGES_API_KEY;
  if (!key)
    throw new Error("Set OPENAI_IMAGES_API_KEY to use the official OpenAI image provider");
  return { key, url: "https://api.openai.com/v1" };
}

/** The gateway namespaces OpenAI image models under its Codex provider. */
export function imageModel(kind: "gateway" | "openai", model: string) {
  return kind === "gateway" && !model.includes("/") ? `codex/${model}` : model;
}
