import { test, expect } from "bun:test";
import { requestImage } from "./image-api";
import { imageModel } from "./provider.server";
const base = {
  model: "gpt-image-2",
  quality: "medium",
  prompt: "A clay barn",
  references: [] as File[],
  signal: new AbortController().signal,
};

test("gateway image requests use the provider's namespaced model id", () => {
  expect(imageModel("gateway", "gpt-image-2")).toBe("codex/gpt-image-2");
  expect(imageModel("gateway", "codex/gpt-image-2")).toBe("codex/gpt-image-2");
  expect(imageModel("openai", "gpt-image-2")).toBe("gpt-image-2");
});
test("image adapter sends generation and multipart reference requests with usage", async () => {
  const received: Request[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      received.push(request);
      if (request.url.endsWith("/generations"))
        expect(await request.json()).toEqual({
          model: "gpt-image-2",
          quality: "medium",
          prompt: "A clay barn",
          size: "1024x1024",
          output_format: "png",
          n: 1,
        });
      else {
        const body = await request.formData();
        expect(body.get("prompt")).toBe(base.prompt);
        expect(body.get("size")).toBe("1024x1536");
        expect(body.getAll("image[]")).toHaveLength(2);
      }
      return Response.json({
        data: [{ b64_json: "fixture" }],
        usage: { input_tokens: 12, output_tokens: 34 },
      });
    },
  });
  try {
    const provider = {
      key: "test-only",
      url: `http://127.0.0.1:${server.port}/v1/`,
    };
    expect(
      (await requestImage({ ...base, provider })).usage?.output_tokens,
    ).toBe(34);
    await requestImage({
      ...base,
      provider,
      size: "1024x1536",
      references: [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.jpg", { type: "image/jpeg" }),
      ],
    });
    expect(received.map((r) => new URL(r.url).pathname)).toEqual([
      "/v1/images/generations",
      "/v1/images/edits",
    ]);
  } finally {
    server.stop(true);
  }
});
test("errors redact provider bodies and are never retried; abort is honored", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      calls++;
      return new Response("secret diagnostic", { status: 401 });
    },
  });
  const provider = {
    key: "test-only",
    url: `http://127.0.0.1:${server.port}/v1`,
  };
  try {
    await expect(requestImage({ ...base, provider })).rejects.toThrow(
      "HTTP 401",
    );
    expect(calls).toBe(1);
    await expect(
      requestImage({ ...base, provider, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("exact custom dimensions reach generation and edit requests unchanged", async () => {
  const sizes: unknown[] = [];
  const server = Bun.serve({ port: 0, fetch: async (request) => {
    sizes.push(request.headers.get("content-type")?.includes("application/json")
      ? (await request.json()).size : (await request.formData()).get("size"));
    return Response.json({ data: [{ b64_json: "fixture" }] });
  } });
  try {
    const provider = { key: "test-only", url: `http://127.0.0.1:${server.port}/v1` };
    await requestImage({ ...base, provider, size: "1920x1080" });
    await requestImage({ ...base, provider, size: "720x1280", references: [new File(["a"], "a.png", { type: "image/png" })] });
    expect(sizes).toEqual(["1920x1080", "720x1280"]);
  } finally { server.stop(true); }
});

test("unsupported size reports the exact resolution without a fallback request", async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch: () => {
    calls++;
    return Response.json({ error: { param: "size", code: "invalid_value", message: "private provider detail" } }, { status: 400 });
  } });
  try {
    const provider = { key: "test-only", url: `http://127.0.0.1:${server.port}/v1` };
    await expect(requestImage({ ...base, provider, size: "64x64" })).rejects.toThrow("rejected 64x64");
    expect(calls).toBe(1);
  } finally { server.stop(true); }
});
