import { UnsupportedResolution } from "../../../lib/resolution";
import { z } from "zod";

export type ImageUsage = {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens_details?: { text_tokens?: number; image_tokens?: number };
  [key: string]: unknown;
};
export type ImageApiResult = {
  data?: { b64_json?: string }[];
  usage?: ImageUsage;
};
export type ImageSize = `${number}x${number}`;

/** One request, no automatic retries: failed/ambiguous requests stay in audit history. */
export async function requestImage(args: {
  provider: { key: string; url: string };
  model: string;
  quality: string;
  size?: ImageSize;
  prompt: string;
  transparentBackground?: boolean;
  references: File[];
  signal: AbortSignal;
}): Promise<ImageApiResult> {
  const fields = {
    model: args.model,
    quality: args.quality,
    prompt: args.prompt,
    size: args.size || "1024x1024",
    output_format: "png",
    n: "1",
  };
  if (args.transparentBackground) (fields as Record<string, string>).background = "transparent";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.provider.key}`,
  };
  let body: BodyInit;
  if (args.references.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    for (const file of args.references) form.append("image[]", file);
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ ...fields, n: 1 });
  }
  const response = await fetch(
    `${args.provider.url.replace(/\/$/, "")}/images/${args.references.length ? "edits" : "generations"}`,
    {
      method: "POST",
      headers,
      body,
      signal: args.signal,
      redirect: "error",
    },
  );
  if (!response.ok) {
    if (response.status === 400 || response.status === 422) {
      const parsed = z.object({ error: z.object({ param: z.string().nullable().optional(), code: z.string().nullable().optional() }) })
        .safeParse(await response.json().catch(() => null));
      if (parsed.success && (parsed.data.error.param === "size" || ["invalid_size", "unsupported_size"].includes(parsed.data.error.code ?? "")))
        throw new UnsupportedResolution(`Output dimension error: the image provider rejected ${fields.size}. Choose a model that supports this size or explicitly change the resolution. No fallback size was used.`);
    }
    // Provider response bodies can echo credentials or prompt text. Keep them private.
    throw new Error(
      `Image API request failed (HTTP ${response.status}). ${response.status === 401 || response.status === 403 ? "Check provider credentials and image access." : "Check provider availability and model support."}`,
    );
  }
  return (await response.json()) as ImageApiResult;
}
