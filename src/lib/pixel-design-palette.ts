import { namedPalettes } from "./pixel-palettes";

const heading = /^##[\t ]+Pixel palette[\t ]*\r?$/gim;

function section(design: string) {
  const matches = [...design.matchAll(heading)];
  if (matches.length > 1) throw new Error("Use only one Pixel palette section.");
  const match = matches[0];
  if (!match) return null;
  const start = match.index;
  const bodyStart = start + match[0].length;
  const next = design.slice(bodyStart).search(/^#{1,2}[\t ]/m);
  return { start, bodyStart, end: next < 0 ? design.length : bodyStart + next };
}

export function parsePaletteColors(text: string) {
  const tokens = text.match(/#[\w]+/g) ?? [];
  if (!tokens.length || tokens.some((token) => !/^#[0-9a-f]{6}$/i.test(token)))
    throw new Error("Enter colors as six-digit hex values, such as #306230.");
  const colors = [...new Set(tokens.map((color) => color.toLowerCase()))];
  if (colors.length > 64) throw new Error("Use at most 64 palette colors.");
  return colors;
}

export function designPalette(design: string): string[] | null {
  const found = section(design);
  return found ? parsePaletteColors(design.slice(found.bodyStart, found.end)) : null;
}

export function withDesignPalette(design: string, colors: string[]) {
  const normalized = parsePaletteColors(colors.join(" "));
  const replacement = `## Pixel palette\n\n${normalized.join(" ")}\n\n`;
  const found = section(design);
  return found
    ? design.slice(0, found.start) + replacement + design.slice(found.end)
    : `${design.trimEnd()}\n\n${replacement.trimEnd()}`;
}

export function generationPalettes(design: string, request = "") {
  const colors = designPalette(design);
  return colors ? [{ id: "design", label: "Design palette", colors }] : namedPalettes(design, request);
}
