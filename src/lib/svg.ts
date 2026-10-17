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

const paintAttributes = ["fill", "stroke", "stop-color"];

/** Structural facts about validated SVG, handed to the judge beside the render. */
export function analyzeSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const nodes = doc.getElementsByTagName("*");
  const elements: Record<string, number> = {};
  const colors = new Set<string>();
  const strokeWidths = new Set<number>();
  let pathCommands = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i)!;
    elements[node.tagName] = (elements[node.tagName] || 0) + 1;
    for (const name of paintAttributes) {
      const value = node.getAttribute(name)?.trim().toLowerCase();
      if (value && value !== "none" && !value.startsWith("url(")) colors.add(value);
    }
    const width = Number(node.getAttribute("stroke-width"));
    if (width > 0) strokeWidths.add(width);
    pathCommands += (node.getAttribute("d")?.match(/[a-z]/gi) || []).length;
  }
  return {
    viewBox: doc.documentElement?.getAttribute("viewBox") ?? null,
    bytes: svg.length,
    elementCount: nodes.length,
    elements,
    pathCommands,
    colors: [...colors].sort(),
    strokeWidths: [...strokeWidths].sort((a, b) => a - b),
    hasText: Boolean(elements.text),
  };
}

/** Reference keys a vision model can view: an SVG source is markup, not an image the API accepts. */
export const viewableReferences = (keys: readonly string[]) => keys.filter((key) => !key.endsWith(".svg"));
