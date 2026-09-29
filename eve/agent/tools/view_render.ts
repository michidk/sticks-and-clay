import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
const dataDir = resolve(process.env.STUDIO_DATA_DIR || "../data");
export default defineTool({
  description:
    "Visually inspect an exported Blender render. Sends actual image content to the vision model. Use this instead of reading image bytes or base64 as text.",
  inputSchema: z.object({
    capability: z.string().uuid(),
    view: z.enum(["front", "rear", "detail"]),
  }),
  async execute({ capability, view }) {
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
    return { view, image: (await readFile(path)).toString("base64") };
  },
  toModelOutput(output) {
    return toolOutput.content([
      toolOutputPart.text(`${output.view} view of the current asset`),
      toolOutputPart.file(output.image, { mediaType: "image/png" }),
    ]);
  },
});
