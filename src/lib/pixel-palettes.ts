/** Classic palettes artists name in a brief. Presets are never retyped from memory by the model: when a design or
 * request names one, its exact colors are put in the prompt and the review measures how far the art strays. */
export const pixelPalettes: Record<string, { label: string; colors: string[] }> = {
  "1bit": { label: "1-bit", colors: ["#000000", "#ffffff"] },
  endesga32: {
    label: "Endesga 32",
    colors: [
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
      "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
      "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
    ],
  },
  nes: {
    label: "NES (RGB preset)",
    colors: [
      "#000000", "#fcfcfc", "#f8f8f8", "#bcbcbc", "#7c7c7c", "#a4e4fc", "#3cbcfc", "#0078f8",
      "#0000fc", "#b8b8f8", "#6888fc", "#0058f8", "#0000bc", "#d8b8f8", "#9878f8", "#6844fc",
      "#4428bc", "#f8b8f8", "#f878f8", "#d800cc", "#940084", "#f8a4c0", "#f85898", "#e40058",
      "#a80020", "#f0d0b0", "#f87858", "#f83800", "#a81000", "#fce0a8", "#fca044", "#e45c10",
      "#881400", "#f8d878", "#f8b800", "#ac7c00", "#503000", "#d8f878", "#b8b818", "#00b800",
      "#007800", "#b8f8b8", "#58d854", "#00a800", "#006800", "#b8f8d8", "#58f898", "#00a844",
      "#005800", "#00fcfc", "#00e8d8", "#008888", "#004058", "#f8d8f8", "#787878",
    ],
  },
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
};

const aliases: Record<string, RegExp> = {
  "1bit": /\b1[-\s]?bit\b|\bone[-\s]bit\b/i,
  endesga32: /\bendesga[-\s]?32\b|\bedg32\b/i,
  nes: /\bnes\b/i,
  "game boy": /\bgame\s?boy\b|\bdmg\b/i,
  pico8: /\bpico[-\s]?8\b/i,
  db16: /\bdb16\b|\bdawn\s?bringer\s?16\b/i,
  sweetie16: /\bsweetie[-\s]?16\b/i,
};

/** The presets a design or request names, in the order of the registry. */
export function namedPalettes(...texts: string[]) {
  const text = texts.join("\n");
  return Object.entries(aliases).filter(([, pattern]) => pattern.test(text)).map(([id]) => ({ id, ...pixelPalettes[id] }));
}

/** Prompt text listing the exact colors of each preset the brief names; "None" when it names none. */
export function palettePromptText(presets: ReturnType<typeof namedPalettes>) {
  return presets.length
    ? presets.map((preset) => `${preset.label} (${preset.colors.length} colors, use only these exact values): ${preset.colors.join(" ")}`).join("\n")
    : "None";
}
