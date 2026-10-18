import sharp from "sharp";

const SIZES = { full: 768, small: 64, icon: 24 } as const;

async function render(svg: string, size: number) {
  return sharp(Buffer.from(svg), { density: 144 })
    .resize(size, size, { fit: "contain", background: "#ffffff00" })
    .ensureAlpha();
}

/** Where the artwork's ink falls inside the canvas, as 0–1 fractions per side. */
async function inkBounds(svg: string) {
  const { data, info } = await (await render(svg, 256)).raw().toBuffer({ resolveWithObject: true });
  let left = info.width, right = -1, top = info.height, bottom = -1, inked = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
      inked++;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  if (!inked) return { empty: true as const };
  const r = (value: number, total: number) => Math.round((value / total) * 1000) / 1000;
  const margins = {
    left: r(left, info.width), top: r(top, info.height),
    right: r(info.width - 1 - right, info.width), bottom: r(info.height - 1 - bottom, info.height),
  };
  return {
    empty: false as const,
    margins,
    coverage: r(inked, info.width * info.height),
    touchesEdge: Object.entries(margins).filter(([, margin]) => margin === 0).map(([side]) => side),
  };
}

/** White-backed previews for the vision judge plus pixel measurements of the render. */
export async function renderSvg(svg: string) {
  const flat = async (size: number) => (await render(svg, size)).flatten({ background: "#ffffff" }).png().toBuffer();
  return {
    full: await flat(SIZES.full),
    small: await flat(SIZES.small),
    icon: await flat(SIZES.icon),
    ink: await inkBounds(svg),
  };
}
