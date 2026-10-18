import { expect, test } from "bun:test";
import { designPalette, generationPalettes, parsePaletteColors, withDesignPalette } from "./pixel-design-palette";

test("the design palette reads a color table, normalizes and deduplicates without taking unrelated colors", () => {
  const design = "# Forest\nA #ffffff background.\n\n## Pixel palette\n| Name | Hex |\n| --- | --- |\n| Leaf | #306230 |\n| Light | #AABBCC |\n| Again | #aabbcc |\n\n## Exclusions\nAvoid #ff0000.";
  expect(designPalette(design)).toEqual(["#306230", "#aabbcc"]);
  expect(generationPalettes(design, "Game Boy inspiration")).toEqual([{ id: "design", label: "Design palette", colors: ["#306230", "#aabbcc"] }]);
});

test("palette editing preserves surrounding design and new palettes round trip", () => {
  const design = "# Forest\n\n## Pixel palette\n#306230\n\n## Shapes\nRound leaves.";
  expect(withDesignPalette(design, ["#ABCDEF", "#abcdef"])).toBe("# Forest\n\n## Pixel palette\n\n#abcdef\n\n## Shapes\nRound leaves.");
  expect(designPalette(withDesignPalette("# Forest", ["#123456"]))).toEqual(["#123456"]);
  expect(designPalette("## Other colors\n#123456")).toBeNull();
  expect(generationPalettes("Game Boy icons")[0].colors).toEqual(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]);
});

test("explicit broken palettes cannot silently disable enforcement", () => {
  for (const text of ["", "#fff", "#12345678", "#ffffff #nothex", Array.from({ length: 65 }, (_, n) => `#${n.toString(16).padStart(6, "0")}`).join(" ")])
    expect(() => designPalette(`## Pixel palette\n${text}`)).toThrow();
  expect(() => designPalette("## Pixel palette\n#ffffff\n## Pixel palette\n#000000")).toThrow("only one");
  expect(parsePaletteColors("#123456, #ABCDEF\n#123456")).toEqual(["#123456", "#abcdef"]);
});
