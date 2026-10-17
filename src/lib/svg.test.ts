import { expect, test } from "bun:test";
import { validateSvg } from "./svg";
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
