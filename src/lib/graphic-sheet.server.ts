import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db/client";
import { batches, models } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { getStorage, readStoredFile } from "./storage.server";

const CELL = 384, PAD = 24, LABEL = 36;
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Lay the images out on one ivory sheet, each on a white card with its name beneath. */
export async function composeSheet(tiles: { name: string; image: Buffer }[]) {
  const columns = Math.min(tiles.length, Math.ceil(Math.sqrt(tiles.length)));
  const rows = Math.ceil(tiles.length / columns);
  const cards = await Promise.all(
    tiles.map(async ({ name, image }, index) => {
      // Small images (pixel art) are enlarged without smoothing; large ones are shrunk with the default filter.
      const { width = CELL } = await sharp(image).metadata();
      const card = await sharp(image, { density: 144 })
        .resize(CELL, CELL, { fit: "contain", background: "#ffffff", kernel: width < CELL ? "nearest" : "lanczos3" })
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${LABEL}"><text x="${CELL / 2}" y="24" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#32423a">${escape(name.length > 34 ? name.slice(0, 33) + "…" : name)}</text></svg>`,
      );
      const left = PAD + (index % columns) * (CELL + PAD);
      const top = PAD + Math.floor(index / columns) * (CELL + LABEL + PAD);
      return [
        { input: card, left, top },
        { input: label, left, top: top + CELL },
      ];
    }),
  );
  return sharp({
    create: {
      width: PAD + columns * (CELL + PAD),
      height: PAD + rows * (CELL + LABEL + PAD),
      channels: 3,
      background: "#f6f4ec",
    },
  })
    .composite(cards.flat())
    .png()
    .toBuffer();
}

/** Graphic and SVG counterpart of the 3D scale lineup: every finished asset on one sheet. */
export async function renderGraphicSheet(batchId: string) {
  const assets = await db.select().from(models).where(eq(models.batchId, batchId));
  const ready = assets.filter((m) => m.status === "done" && typeof m.artifacts?.image === "string");
  if (!ready.length) throw new Error("No completed assets to render");
  const sheet = await composeSheet(
    await Promise.all(
      ready.map(async (m) => ({
        name: m.name,
        image: Buffer.from(await (await readStoredFile(String(m.artifacts!.image))).arrayBuffer()),
      })),
    ),
  );
  await assertJobActive();
  const key = `collections/${batchId}/${crypto.randomUUID()}/sheet.png`;
  await getStorage().upload(new Blob([new Uint8Array(sheet)], { type: "image/png" }), key);
  await db
    .update(batches)
    .set({
      status: assets.some((m) => m.status !== "done" || m.verdict === "limit_reached")
        ? "completed_with_errors"
        : "done",
      preview: { sheet: key },
    })
    .where(eq(batches.id, batchId));
}
