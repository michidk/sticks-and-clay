import { test, expect } from "bun:test";
import { requestImage } from "./image-api";
const base = {
  model: "gpt-image-2",
  quality: "medium",
  prompt: "A clay barn",
  references: [] as File[],
  signal: new AbortController().signal,
};
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
