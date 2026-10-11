import { test, expect } from "bun:test";
import viewRender from "../../eve/agent/tools/view_render";

test("quick sprites and retained final evidence follow separate build identities", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const root = await mkdtemp(resolve(tmpdir(), "sprite-vision-")),
    previous = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = root;
  try {
    const capability = crypto.randomUUID();
    await mkdir(resolve(root, "capabilities"));
    await mkdir(resolve(root, "asset/preview"), { recursive: true });
    await writeFile(
      resolve(root, "capabilities", `${capability}.json`),
      JSON.stringify({ directory: "asset" }),
    );
    await writeFile(resolve(root, "asset/sprites.png"), "old final pixels");
    await writeFile(
      resolve(root, "asset/preview/sprites.png"),
      "current quick pixels",
    );
    await writeFile(
      resolve(root, "asset/state.json"),
      JSON.stringify({ scriptSha256: "old" }),
    );
    await writeFile(
      resolve(root, "asset/preview/state.json"),
      JSON.stringify({ scriptSha256: "new" }),
    );
    await writeFile(
      resolve(root, "asset/build-state.json"),
      JSON.stringify({ ok: true, scriptSha256: "new" }),
    );
    const final = await (viewRender.execute as any)({
      capability,
      view: "sprites",
    });
    const quick = await (viewRender.execute as any)({
      capability,
      view: "preview_sprites",
    });
    expect(final.note).toContain("Historical");
    expect(quick.note).toBeUndefined();
    await writeFile(
      resolve(root, "asset/build-state.json"),
      JSON.stringify({ ok: true, preview: false }),
    );
    const oldDraft = await (viewRender.execute as any)({
      capability,
      view: "preview_sprites",
    });
    expect(oldDraft.note).toContain("Historical");
    expect(final.imageKey).not.toBe(quick.imageKey);
    // An interrupted alias copy must not change the generation inspected by the judge.
    const { createHash } = await import("node:crypto");
    const generation = ".published/" + "a".repeat(32);
    await mkdir(resolve(root, "asset", generation), { recursive: true });
    const pixels = "committed sprite pixels";
    const sha256 = createHash("sha256").update(pixels).digest("hex");
    await writeFile(resolve(root, "asset", generation, "sprites.png"), pixels);
    const receipt = JSON.stringify({
      artifacts: [
        { id: "sprites", path: "sprites.png", mime: "image/png", sha256 },
      ],
    });
    await writeFile(
      resolve(root, "asset", generation, "build-receipt.json"),
      receipt,
    );
    await writeFile(
      resolve(root, "asset/output-current.json"),
      JSON.stringify({
        directory: generation,
        receiptSha256: createHash("sha256").update(receipt).digest("hex"),
      }),
    );
    await writeFile(
      resolve(root, "asset/sprites.png"),
      "partially replaced alias",
    );
    const committed = await (viewRender.execute as any)({
      capability,
      view: "sprites",
    });
    expect(committed.imageKey).toBe(`vision/${sha256}.png`);
    await writeFile(
      resolve(root, "asset", generation, "sprites.png"),
      "tampered generation",
    );
    await expect(
      (viewRender.execute as any)({ capability, view: "sprites" }),
    ).rejects.toThrow("Artifact changed");
  } finally {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
test("render pixels are a vision file part, never base64 text", async () => {
  const output = (await viewRender.toModelOutput!({
    view: "front",
    image: "YWJj",
  } as any)) as any;
  expect(output.type).toBe("content");
  expect(output.value[1].type).toBe("file");
  expect(output.value[1].mediaType).toBe("image/png");
  expect(output.value[0].text).not.toContain("YWJj");
});

test("render tool stores a small immutable reference while model receives the original pixels", async () => {
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const directory = `/tmp/studio-vision-${crypto.randomUUID()}`;
  const previous = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = directory;
  try {
    const capability = crypto.randomUUID();
    await mkdir(resolve(directory, "capabilities"), { recursive: true });
    await mkdir(resolve(directory, "render"), { recursive: true });
    await writeFile(
      resolve(directory, "capabilities", capability + ".json"),
      JSON.stringify({ directory: "render" }),
    );
    await writeFile(
      resolve(directory, "render/front.png"),
      "original image pixels",
    );
    const output = await (viewRender.execute as any)({
      capability,
      view: "front",
    });
    expect(output.image).toBeUndefined();
    expect(JSON.stringify(output).length).toBeLessThan(160);
    await writeFile(resolve(directory, "render/front.png"), "new render");
    const modelOutput = (await viewRender.toModelOutput!(output)) as any;
    expect(modelOutput.value[1].type).toBe("file");
    expect(JSON.stringify(modelOutput)).toContain(
      Buffer.from("original image pixels").toString("base64"),
    );
  } finally {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
