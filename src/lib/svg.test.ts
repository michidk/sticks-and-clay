import { expect, test } from "bun:test";
import { analyzeSvg, validateSvg, viewableReferences } from "./svg";
import { fileMimeType } from "./storage/path";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
test("editable vector artwork preserves gradients, shapes and text", () => {
  const source = svg(
    '<defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0L100 100" stroke="url(#paint)"/><text x="10" y="20">Clay &amp; sticks</text>',
  );
  expect(validateSvg(source)).toBe(source);
  expect(fileMimeType("graphics/test.svg")).toBe("image/svg+xml");
});
for (const body of [
  "<script>alert(1)</script>",
  '<rect onclick="alert(1)"/>',
  "<foreignObject/>",
  '<image href="https://example.com/pixel.png"/>',
  "<style>rect{fill:red}</style>",
  '<rect style="fill:red"/>',
  '<rect fill="url(https://example.com/paint)"/>',
  '<rect fill="url(&#104;ttps://example.com/paint)"/>',
  '<rect fill="uRl(#paint)"/>',
  '<animate attributeName="href"/>',
  '<g xmlns="https://example.com"/>',
  "<rect><g></rect>",
])
  test(`rejects unsafe or malformed SVG: ${body}`, () => {
    expect(() => validateSvg(svg(body))).toThrow();
  });
test("rejects declarations, multiple roots, invalid viewports and oversized output", () => {
  for (const value of [
    "<!DOCTYPE svg>" + svg(""),
    '<?xml version="1.0"?>' + svg(""),
    svg("") + svg(""),
    svg("").replace("0 0 100 100", "0 0 0 100"),
    svg("").replace(' viewBox="0 0 100 100"', ""),
    " ".repeat(500_001),
  ])
    expect(() => validateSvg(value)).toThrow();
});

test("analysis reports structure, palette and stroke widths for the judge", () => {
  const analysis = analyzeSvg(
    svg(
      '<g><path d="M0 0L10 10" stroke="#284E3C" stroke-width="2"/><circle cx="5" cy="5" r="4" fill="#C8D8B0" stroke="#284e3c" stroke-width="3"/><text x="1" y="1">A</text></g>',
    ),
  );
  expect(analysis).toMatchObject({
    elements: { g: 1, path: 1, circle: 1, text: 1 },
    pathCommands: 2,
    colors: ["#284e3c", "#c8d8b0"],
    strokeWidths: [2, 3],
    hasText: true,
  });
});

test("SVG sources are not sent to vision models as images", () => {
  expect(viewableReferences(["graphics/a.svg", "references/b.png", "references/c.jpg"])).toEqual(["references/b.png", "references/c.jpg"]);
});

test("the SVG model is shown renders of the earlier versions before the style references", async () => {
  const { attachedImages } = await import("./svg-generation.server");
  const shown = await attachedImages([{ key: "g/preview.png", label: "full-size" }, { key: "g/preview-24.png", label: "24 px" }], ["s/preview.png"], ["s/source.svg", "references/a.png"]);
  expect(shown.keys).toEqual(["g/preview.png", "g/preview-24.png", "s/preview.png", "references/a.png"]);
  expect(shown.notes.split("\n")).toEqual([
    "Image 1: render of the PREVIOUS ATTEMPT SVG: full-size",
    "Image 2: render of the PREVIOUS ATTEMPT SVG: 24 px",
    "Image 3: render of the SAVED SOURCE SVG, on white",
    "Image 4: style reference, not the artwork to copy",
  ]);
  expect((await attachedImages([], [], [])).notes).toBe("None");
});

test("a restored SVG source preview is rendered to PNG before attaching it", async () => {
  const { attachedImages } = await import("./svg-generation.server");
  const { getStorage, readStoredFile } = await import("./storage.server");
  const directory = `graphics/${crypto.randomUUID()}`;
  const source = `${directory}/graphic.svg`, preview = `${directory}/preview.png`;
  const storage = getStorage();
  try {
    await storage.upload(new Blob([svg('<circle cx="5" cy="5" r="4"/>')], { type: "image/svg+xml" }), source);
    expect((await attachedImages([{ key: source, label: "restored SVG" }], [], [])).keys).toEqual([preview]);
    const bytes = new Uint8Array(await (await readStoredFile(preview)).arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await attachedImages([{ key: source, label: "restored SVG" }], [], [])).keys).toEqual([preview]);
  } finally {
    for (const key of [source, preview]) if (await storage.exists(key)) await storage.delete(key);
  }
});
