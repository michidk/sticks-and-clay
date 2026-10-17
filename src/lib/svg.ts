import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const elements = new Set(
  "svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath".split(
    " ",
  ),
);
const attributes = new Set(
  "xmlns id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy fr font-family font-size font-weight text-anchor dominant-baseline dx dy rotate textLength lengthAdjust preserveAspectRatio".split(
    " ",
  ),
);

/** Restrict generated documents to static, self-contained vector artwork. */
export function validateSvg(source: string): string {
  if (source.length > 500_000 || /<!|<\?/.test(source))
    throw new Error(
      "SVG must be a static document without declarations or entities",
    );
  const doc = new DOMParser({
    onError: () => {
      throw new Error("Malformed SVG document");
    },
  }).parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (
    !root ||
    root.tagName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg"
  )
    throw new Error("SVG requires an svg root and namespace");
  const viewBox = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    viewBox[2] <= 0 ||
    viewBox[3] <= 0
  )
    throw new Error("SVG requires a valid viewBox");
  const nodes = doc.getElementsByTagName("*");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i)!;
    if (!elements.has(node.tagName) || node.namespaceURI !== root.namespaceURI)
      throw new Error(`Unsupported SVG element: ${node.tagName}`);
    for (let j = 0; j < node.attributes.length; j++) {
      const attr = node.attributes.item(j)!;
      if (
        !attributes.has(attr.name) ||
        (attr.name === "xmlns" && attr.value !== root.namespaceURI)
      )
        throw new Error(`Unsupported SVG attribute: ${attr.name}`);
      const withoutLocalReferences = attr.value.replace(
        /url\(#[a-zA-Z_][\w.-]*\)/g,
        "",
      );
      if (
        /[\\\u0000-\u001f]/.test(attr.value) ||
        (attr.name !== "xmlns" &&
          /(?:url\s*\(|:)/i.test(withoutLocalReferences))
      )
        throw new Error("SVG attributes cannot reference external content");
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
