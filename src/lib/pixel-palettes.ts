/** Classic palettes artists name in a brief. Presets are never retyped from memory by the model: when a design or
 * request names one, its exact colors are put in the prompt, the drawing must use only those colors, and the review
 * measures how far the art strays. */
export const pixelPalettes: Record<string, { label: string; colors: string[] }> = {
  "game boy": { label: "Game Boy", colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] },
  pico8: {
    label: "PICO-8",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
  },
  db16: {
    label: "DawnBringer 16",
    colors: [
      "#140c1c", "#442434", "#30346d", "#4e4a4e", "#854c30", "#346524", "#d04648", "#757161",
      "#597dce", "#d27d2c", "#8595a1", "#6daa2c", "#d2aa99", "#6dc2ca", "#dad45e", "#deeed6",
    ],
  },
  sweetie16: {
    label: "Sweetie 16",
    colors: [
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ],
  },
  endesga32: {
    label: "Endesga 32",
    colors: [
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
      "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
      "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
    ],
  },
  // The console's commonly used RGB approximation (duplicates and the unusable blacks removed). A drawing still uses
  // at most 32 of these.
  nes: {
    label: "NES",
    colors: [
      "#000000", "#fcfcfc", "#f8f8f8", "#bcbcbc", "#7c7c7c", "#a4e4fc", "#3cbcfc", "#0078f8",
      "#0000fc", "#b8b8f8", "#6888fc", "#0058f8", "#0000bc", "#d8b8f8", "#9878f8", "#6844fc",
      "#4428bc", "#f8b8f8", "#f878f8", "#d800cc", "#940084", "#f8a4c0", "#f85898", "#e40058",
      "#a80020", "#f0d0b0", "#f87858", "#f83800", "#a81000", "#fce0a8", "#fca044", "#e45c10",
      "#881400", "#f8d878", "#f8b800", "#ac7c00", "#503000", "#d8f878", "#b8f818", "#00b800",
      "#007800", "#b8f8b8", "#58d854", "#00a800", "#006800", "#b8f8d8", "#58f898", "#00a844",
      "#005800", "#00fcfc", "#00e8d8", "#008888", "#004058", "#f8d8f8", "#787878",
    ],
  },
  "1bit": { label: "1-bit", colors: ["#000000", "#ffffff"] },
};

const aliases: Record<string, RegExp> = {
  "game boy": /\bgame\s?boy\b|\bdmg\b/i,
  pico8: /\bpico[-\s]?8\b/i,
  db16: /\bdb16\b|\bdawn\s?bringer\s?16\b/i,
  sweetie16: /\bsweetie[-\s]?16\b/i,
  endesga32: /\bendesga[-\s]?32\b|\bedg[-\s]?32\b/i,
  nes: /\bnes\b|\bfamicom\b/i,
  "1bit": /\b(?:1|one)[-\s]?bit\b/i,
};

/** The presets a design or request names, in the order of the registry. */
export function namedPalettes(...texts: string[]) {
  const text = texts.join("\n");
  return Object.entries(aliases).filter(([, pattern]) => pattern.test(text)).map(([id]) => ({ id, ...pixelPalettes[id] }));
}

/** Prompt text listing the exact colors of each preset the brief names, plus ready-made shading ramps from them;
 * "None" when it names none. */
export function palettePromptText(presets: ReturnType<typeof namedPalettes>) {
  return presets.length
    ? presets.map((preset) => {
        const ramps = paletteRamps(preset.colors);
        return `${preset.label} (${preset.colors.length} colors, use only these exact values): ${preset.colors.join(" ")}`
          + (ramps.length ? `\nShading ramps inside ${preset.label}, dark to light (shadows cooler, highlights warmer):\n${ramps.map((ramp) => `- ${ramp.join(" ")}`).join("\n")}` : "");
      }).join("\n")
    : "None";
}

// ---- colors ------------------------------------------------------------------------------------------------------

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace(/^#/, "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (c: readonly number[]) =>
  `#${[c[0], c[1], c[2]].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/** OKLab of an sRGB color: a space where equal distances look about equally different, used to find the nearest
 * palette color instead of raw RGB distance (which overrates green and underrates blue). */
export function oklab([r, g, b]: readonly number[]): Rgb {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The palette color that looks closest to `color` (both #rrggbb). */
export function nearestColor(color: string, palette: readonly string[]) {
  const target = oklab(hexToRgb(color));
  let best = palette[0], distance = Infinity;
  for (const candidate of palette) {
    const [l, a, b] = oklab(hexToRgb(candidate));
    const d = (l - target[0]) ** 2 + (a - target[1]) ** 2 + (b - target[2]) ** 2;
    if (d < distance) [best, distance] = [candidate, d];
  }
  return best.toLowerCase();
}

function hsv([r, g, b]: Rgb): Rgb {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  if (d) h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}

function fromHsv(h: number, s: number, v: number): Rgb {
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** A shading ramp around `base`, dark to light, the way pixel artists build one: shadow steps turn toward blue-purple
 * (250 degrees) and gain a little saturation, highlight steps turn toward yellow (60 degrees), lose a little saturation
 * and brighten. The hue turns by at most `hueShift` degrees at either end. With `palette`, every step snaps to the
 * nearest palette color and repeated steps are dropped, so the ramp stays legal for a named palette. */
export function hueShiftedRamp(base: string, steps = 4, { hueShift = 18, palette }: { hueShift?: number; palette?: readonly string[] } = {}) {
  const [h, s, v] = hsv(hexToRgb(base));
  const mid = (steps - 1) / 2;
  const ramp = Array.from({ length: steps }, (_, i) => {
    const t = Math.max(-1, Math.min(1, (i - mid) / Math.max(mid, 1))); // -1 darkest .. +1 lightest
    const target = t > 0 ? 60 : 250;
    const delta = ((target - h + 540) % 360) - 180;
    const hue = h + Math.sign(delta) * Math.min(Math.abs(delta), hueShift * Math.abs(t));
    const [ss, vv] = t > 0 ? [s * (1 - 0.18 * t), v + (1 - v) * 0.7 * t + 0.08 * t] : [s * (1 + 0.12 * -t), v * (1 - 0.6 * -t)];
    return rgbToHex(fromHsv((hue + 360) % 360, ss, vv));
  });
  return palette ? [...new Set(ramp.map((color) => nearestColor(color, palette)))] : ramp;
}

/** A few on-palette ramps for the saturated mid-tones of a palette, for the prompt; ramps that collapse to fewer than
 * three distinct colors (a tiny palette) are left out. */
export function paletteRamps(colors: readonly string[], limit = 8) {
  const bases = colors
    .map((color) => ({ color, hsv: hsv(hexToRgb(color)) }))
    .filter(({ hsv: [, s, v] }) => s > 0.3 && v > 0.35 && v < 0.95)
    .sort((a, b) => a.hsv[0] - b.hsv[0]);
  const seen = new Set<string>();
  const ramps: string[][] = [];
  for (const { color } of bases) {
    const ramp = hueShiftedRamp(color, 4, { palette: colors });
    const id = ramp.join();
    if (ramp.length < 3 || seen.has(id)) continue;
    seen.add(id);
    ramps.push(ramp);
    if (ramps.length >= limit) break;
  }
  return ramps;
}
