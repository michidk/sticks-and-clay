import { test, expect } from "bun:test";
import { downloadImage, remoteImageFilename } from "./remote-image.server";
import { resolvePublicHttpUrl } from "./remote-url-policy.server";
import { MAX_IMAGE_BYTES } from "./image-file";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];
const picture = () =>
  new Response(png, { headers: { "content-type": "image/png" } });

test("URL import pins each connection and redirect to a validated public address", async () => {
  const connections: string[] = [];
  const image = await downloadImage("https://first.example/picture", {
    resolveHost,
    request: async (url, addresses) => {
      expect(addresses).toEqual(await resolveHost());
      connections.push(url.hostname);
      if (connections.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: "https://second.example/final.png" },
        });
      return picture();
    },
  });
  expect(connections).toEqual(["first.example", "second.example"]);
  expect(image.filename).toBe("final.png");
  expect(image.base64).toBe(Buffer.from(png).toString("base64"));
});
test("URL import rejects private hosts, credentials, schemes and private redirects", async () => {
  for (const url of [
    "file:///tmp/a",
    "http://localhost/a",
    "http://127.0.0.1/a",
    "http://169.254.169.254/a",
    "http://[::1]/a",
    "http://[::ffff:127.0.0.1]/a",
    "https://user:pass@example.com/a",
  ]) {
    await expect(resolvePublicHttpUrl(url, resolveHost)).rejects.toThrow();
  }
  await expect(
    resolvePublicHttpUrl("https://mixed.example", async () => [
      { address: "93.184.216.34" },
      { address: "10.0.0.1" },
    ]),
  ).rejects.toThrow("not allowed");
  await expect(
    downloadImage("https://public.example/a", {
      resolveHost,
      request: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://10.0.0.1/secret" },
        }),
    }),
  ).rejects.toThrow("not allowed");
});
test("URL import rejects non-images, spoofed types, empty bodies and oversized streams", async () => {
  for (const response of [
    new Response("<html>no</html>", {
      headers: { "content-type": "text/html" },
    }),
    new Response("<svg>no</svg>", { headers: { "content-type": "image/png" } }),
    new Response(png, { headers: { "content-type": "image/jpeg" } }),
    new Response(null, { headers: { "content-type": "image/png" } }),
    new Response(png, {
      headers: {
        "content-type": "image/png",
        "content-length": String(MAX_IMAGE_BYTES + 1),
      },
    }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1));
          controller.close();
        },
      }),
      { headers: { "content-type": "image/png" } },
    ),
  ])
    await expect(
      downloadImage("https://images.example/a", {
        resolveHost,
        request: async () => response,
      }),
    ).rejects.toThrow();
});
test("redirects are bounded and remote errors stay actionable", async () => {
  let calls = 0;
  await expect(
    downloadImage("https://images.example/a", {
      resolveHost,
      request: async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: "/again" },
        });
      },
    }),
  ).rejects.toThrow("redirected too many");
  expect(calls).toBe(5);
  await expect(
    downloadImage("https://images.example/a", {
      resolveHost,
      request: async () => new Response(null, { status: 403 }),
    }),
  ).rejects.toThrow("403");
  expect(
    remoteImageFilename(
      new URL("https://images.example/My%20Image.jpg"),
      "image/webp",
    ),
  ).toBe("My Image.webp");
});
