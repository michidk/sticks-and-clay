import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db/client";
import { batches, assetVersions, projects } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { getStorage, readStoredFile } from "./storage.server";
import { runRole, roleInput } from "../modules/ai/index.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { analyzeSvg } from "./svg";
import { reviewPassed } from "./contracts";
import { svgIntentOf } from "./workshop";

const CELL = 384, PAD = 24, LABEL = 36;
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Lay the images out on one ivory sheet, each on a white card with its name beneath. */
export async function composeSheet(tiles: { name: string; image: Buffer }[], artworkSize: 16 | 24 | 64 | 384 = CELL) {
  const cell = artworkSize === CELL ? CELL : 128;
  const columns = Math.min(tiles.length, Math.ceil(Math.sqrt(tiles.length)));
  const rows = Math.ceil(tiles.length / columns);
  const cards = await Promise.all(
    tiles.map(async ({ name, image }, index) => {
      // Small images (pixel art) are enlarged without smoothing; large ones are shrunk with the default filter.
      const { width = CELL } = await sharp(image).metadata();
      const card = await sharp(image, { density: 144 })
        .resize(artworkSize, artworkSize, { fit: "contain", background: "#ffffff", kernel: width < CELL ? "nearest" : "lanczos3" })
        .flatten({ background: "#ffffff" })
        .extend({ top: Math.floor((cell - artworkSize) / 2), bottom: Math.ceil((cell - artworkSize) / 2), left: Math.floor((cell - artworkSize) / 2), right: Math.ceil((cell - artworkSize) / 2), background: "#ffffff" })
        .png()
        .toBuffer();
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${LABEL}"><text x="${cell / 2}" y="24" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#32423a">${escape(name.length > (cell === CELL ? 34 : 12) ? name.slice(0, cell === CELL ? 33 : 11) + "…" : name)}</text></svg>`,
      );
      const left = PAD + (index % columns) * (cell + PAD);
      const top = PAD + Math.floor(index / columns) * (cell + LABEL + PAD);
      return [
        { input: card, left, top },
        { input: label, left, top: top + cell },
      ];
    }),
  );
  return sharp({
    create: {
      width: PAD + columns * (cell + PAD),
      height: PAD + rows * (cell + LABEL + PAD),
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
  const assets = await db.select().from(assetVersions).where(eq(assetVersions.batchId, batchId)).orderBy(assetVersions.createdAt, assetVersions.id);
  const ready = assets.filter((m) => m.status === "done" && typeof m.artifacts?.image === "string");
  if (!ready.length) throw new Error("No completed assets to render");
  const tiles = await Promise.all(ready.map(async (m) => ({
    name: m.name,
    image: Buffer.from(await (await readStoredFile(String(m.artifacts!.image))).arrayBuffer()),
  })));
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
  const [project] = await db.select().from(projects).where(eq(projects.id, batch.projectId));
  const job = jobContext.getStore();
  const directory = job?.checkpoint["graphic-sheet-directory"] ?? `collections/${batchId}/${crypto.randomUUID()}`;
  if (job && !job.checkpoint["graphic-sheet-directory"]) await checkpoint("graphic-sheet-directory", directory);
  const key = `${directory}/sheet.png`;
  const saveSheet = async (path: string, size: 16 | 24 | 64 | 384) => {
    const sheet = await composeSheet(tiles, size);
    await getStorage().upload(new Blob([new Uint8Array(sheet)], { type: "image/png" }), path);
  };
  await saveSheet(key, CELL);
  let collectionError: string | null = null;
  if (project.assetType === "svg" && batch.judgeIterations > 0 && ready.length >= 2) {
    // Icons are judged at UI sizes, logos down to favicon size, illustrations only at 64 px and above.
    const intent = svgIntentOf(batch.workshop);
    const sizes = (intent === "icon" ? [64, 24, 16] : intent === "logo" ? [64, 16] : [64]) as (16 | 24 | 64)[];
    const images = [key, ...sizes.map((size) => `${directory}/sheet-${size}.png`)];
    for (const [index, size] of sizes.entries()) await saveSheet(images[index + 1], size);
    await assertJobActive();
    const { result } = await runRole({
      role: "svg-collection-judge", stepId: "svg-collection-review",
      projectId: batch.projectId, batchId,
      images,
      input: await roleInput("svg-collection-judge", {
        design: batch.design, name: "Completed SVG collection", request: batch.prompt,
        size: `Intent: ${intent}. Same collection at 384px${sizes.map((size) => `, ${size}px`).join("")} per asset; white cards do not change scale`,
        images: `Image 1: enlarged collection. ${sizes.map((size, index) => `Image ${index + 2}: ${size}px collection.`).join(" ")} Names are printed below each asset.`,
        analysis: JSON.stringify(ready.map((asset, index) => ({
          name: asset.name, brief: asset.prompt, ...analyzeSvg(tiles[index].image.toString("utf8")),
        }))),
        feedback: "None",
      }),
    });
    if (!reviewPassed(result)) collectionError = `Collection review: ${result.summary}`;
  }
  await assertJobActive();
  await db
    .update(batches)
    .set({
      error: collectionError,
      status: collectionError || assets.some((m) => m.status !== "done" || m.verdict === "limit_reached")
        ? "completed_with_errors"
        : "done",
      preview: { sheet: key },
    })
    .where(eq(batches.id, batchId));
}
