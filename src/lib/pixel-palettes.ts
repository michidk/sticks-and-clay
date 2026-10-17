/** Classic palettes artists name in a brief. Presets are never retyped from memory by the model: when a design or
 * request names one, its exact colors are put in the prompt and the review measures how far the art strays. */
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
};

const aliases: Record<string, RegExp> = {
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
