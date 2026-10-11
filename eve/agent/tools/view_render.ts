import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { committedDirectory } from "../../../src/modules/asset-builds/publication.server";
const dataDirectory = () => resolve(process.env.STUDIO_DATA_DIR || "../data");
export default defineTool({
  description:
    "Visually inspect an exported Blender render. Sends actual image content to the vision model. Use this instead of reading image bytes or base64 as text.",
  inputSchema: z.object({
    capability: z.string().uuid(),
    artifactId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
    crop: z
      .tuple([
        z.number().int().min(0),
        z.number().int().min(0),
        z.number().int().positive().max(4096),
        z.number().int().positive().max(4096),
      ])
      .optional(),
    view: z.enum([
      "front",
      "rear",
      "detail",
      "left",
      "right",
      "top",
      "bottom",
      "preview_front",
      "preview_rear",
      "preview_detail",
      "preview_sprites",
      "sprites",
    ]),
  }),
  async execute({ capability, view, artifactId, crop }) {
    const dataDir = dataDirectory();
    const authorization = JSON.parse(
      await readFile(
        resolve(dataDir, "capabilities", capability + ".json"),
        "utf8",
      ),
    );
    const output = await committedDirectory(
      resolve(
        dataDir,
        authorization.directory,
        view.startsWith("preview_") ? "preview" : ".",
      ),
    );
    let artifactPath: string | undefined, artifactHash: string | undefined;
    const receiptText = await readFile(
      resolve(output, "build-receipt.json"),
      "utf8",
    ).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (artifactId || receiptText) {
      const receipt = receiptText ? JSON.parse(receiptText) : { artifacts: [] };
      const id =
        artifactId || (view.startsWith("preview_") ? view.slice(8) : view);
      const artifact = receipt.artifacts.find(
        (a: { id: string; mime: string }) =>
          a.id === id && a.mime === "image/png",
      );
      if (!artifact || !/^[a-zA-Z0-9_.-]+\.png$/.test(artifact.path))
        throw new Error("Unknown image artifact");
      artifactPath = artifact.path;
      artifactHash = artifact.sha256;
    }
    const path = await realpath(
      resolve(
        output,
        artifactPath ||
          (view.startsWith("preview_")
            ? view.slice(8) + ".png"
            : view + ".png"),
      ),
    );
    if (!path.startsWith((await realpath(dataDir)) + sep))
      throw new Error("Invalid render path");
    let bytes = await readFile(path);
    if (
      artifactHash &&
      createHash("sha256").update(bytes).digest("hex") !== artifactHash
    )
      throw new Error("Artifact changed since its build receipt");
    if (crop) {
      const script =
        "import sys,io;from PIL import Image;im=Image.open(sys.argv[1]);x,y,w,h=map(int,sys.argv[2:]);assert x+w<=im.width and y+h<=im.height,'Crop outside image';out=io.BytesIO();im.crop((x,y,x+w,y+h)).save(out,format='PNG');sys.stdout.buffer.write(out.getvalue())";
      const python =
        process.env.STUDIO_PYTHON ||
        resolve(
          process.platform === "win32"
            ? "../.venv/Scripts/python.exe"
            : "../.venv/bin/python",
        );
      const result = await promisify(execFile)(
        python,
        ["-c", script, path, ...crop.map(String)],
        { encoding: "buffer", timeout: 10000, maxBuffer: 24 * 1024 * 1024 },
      );
      bytes = result.stdout;
    }
    const imageKey = `vision/${createHash("sha256").update(bytes).digest("hex")}.png`;
    await mkdir(resolve(dataDir, "vision"), { recursive: true });
    await writeFile(resolve(dataDir, imageKey), bytes);
    // Persist a small immutable reference. Raw base64 makes Eve's context-size
    // estimator trigger compaction before the model can inspect the images.
    const buildState = await readFile(
      resolve(dataDir, authorization.directory, "build-state.json"),
      "utf8",
    )
      .then(JSON.parse)
      .catch(() => undefined);
    const artifactState = await readFile(resolve(output, "state.json"), "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
    const stale =
      buildState &&
      (!buildState.ok ||
        (artifactState?.scriptSha256 &&
          artifactState.scriptSha256 !== buildState.scriptSha256));
    return {
      view: `${artifactId || view}${crop ? ` crop ${crop.join(",")}` : ""}`,
      imageKey,
      ...(stale
        ? {
            note: "Historical successful render retained; the current script has not produced this artifact.",
          }
        : {}),
    };
  },
  async toModelOutput(output: {
    view: string;
    imageKey?: string;
    image?: string;
    note?: string;
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
      toolOutputPart.text(
        `${output.view} view of the current asset${output.note ? `. ${output.note}` : ""}`,
      ),
      toolOutputPart.file(pixels, { mediaType: "image/png" }),
    ]);
  },
});
