import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
const dataDirectory = () => resolve(process.env.STUDIO_DATA_DIR || "../data");
export default defineTool({
  description:
    "Visually inspect an exported Blender render. Sends actual image content to the vision model. Use this instead of reading image bytes or base64 as text.",
  inputSchema: z.object({
    capability: z.string().uuid(),
    view: z.enum(["front", "rear", "detail"]),
  }),
  async execute({ capability, view }) {
    const dataDir = dataDirectory();
    const authorization = JSON.parse(
      await readFile(
        resolve(dataDir, "capabilities", capability + ".json"),
        "utf8",
      ),
    );
    const path = await realpath(
      resolve(dataDir, authorization.directory, view + ".png"),
    );
    if (!path.startsWith((await realpath(dataDir)) + sep))
      throw new Error("Invalid render path");
    const bytes = await readFile(path);
    const imageKey = `vision/${createHash("sha256").update(bytes).digest("hex")}.png`;
    await mkdir(resolve(dataDir, "vision"), { recursive: true });
    await writeFile(resolve(dataDir, imageKey), bytes);
    // Persist a small immutable reference. Raw base64 makes Eve's context-size
    // estimator trigger compaction before the model can inspect the images.
    return { view, imageKey };
  },
  async toModelOutput(output: {
    view: string;
    imageKey?: string;
    image?: string;
  }) {
    // Historical sessions may still contain the original inline image output.
    let pixels = output.image;
    if (!pixels && output.imageKey) {
      const root = await realpath(dataDirectory());
      const path = await realpath(resolve(root, output.imageKey));
      if (!path.startsWith(root + sep)) throw new Error("Invalid render path");
      pixels = (await readFile(path)).toString("base64");
    }
    if (!pixels) throw new Error("Render image is missing");
    return toolOutput.content([
      toolOutputPart.text(`${output.view} view of the current asset`),
      toolOutputPart.file(pixels, { mediaType: "image/png" }),
    ]);
  },
});
