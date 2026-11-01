import { PixelGridError, type PixelAnswer, type PixelGrid } from "./pixel";

export const CANVAS_BATCHES = 3;
export const CANVAS_OPERATIONS = 24;

/** Validate a local edit before rasterization, so failure cannot mutate the retained canvas. */
export function validateCanvasEdit(answer: PixelAnswer, previous?: PixelGrid) {
  if ((answer.operations?.length ?? 0) > CANVAS_OPERATIONS)
    throw new PixelGridError(`Canvas batches allow at most ${CANVAS_OPERATIONS} operations; inspect the rendered result before continuing`);
  if ((answer.patches ?? []).reduce((sum, patch) => sum + patch.rows.reduce((count, row) => count + row.length, 0), 0) > 512)
    throw new PixelGridError("Canvas patches may replace at most 512 cells per batch; use shapes for large areas");
  if (!previous) return;
  if (answer.width !== previous.width || answer.height !== previous.height)
    throw new PixelGridError(`The canvas is locked to ${previous.width}×${previous.height}; edits cannot resize it`);
  for (const entry of answer.palette) {
    const retained = previous.palette.find(color => color.key === entry.key);
    if (!retained || retained.color.toLowerCase() !== entry.color.toLowerCase())
      throw new PixelGridError(`The canvas palette is locked; key ${entry.key} cannot be added or recolored. Select the complete palette in the first batch`);
  }
  if (answer.rows || answer.frames || answer.layers)
    throw new PixelGridError("Edit the retained canvas with operations or patches; do not replace whole rows, frames or layers");
  if (answer.fps !== undefined && answer.fps !== previous.fps ||
      answer.loop !== undefined && answer.loop !== previous.loop ||
      answer.anchors !== undefined && JSON.stringify(answer.anchors) !== JSON.stringify(previous.anchors))
    throw new PixelGridError("Canvas edits must retain animation timing and anchors");
}

export function canvasBatchInstruction(batch: number) {
  return `PERSISTENT CANVAS, batch ${batch}/${CANVAS_BATCHES} for this construction pass.
${batch === 1 ? "Start this pass with a small change. If no canvas exists, choose its complete palette, dimensions, all requested frames/layers, timing and anchors now. Block the subject with simple shapes." : "Inspect the attached CURRENT CANVAS image before editing. Describe what you actually observe in canvas.observation and correct the most important visible issue."}
Return canvas: {status: "continue" or "complete", observation: "what you see and changed"}.
Use at most ${CANVAS_OPERATIONS} drawing operations, or local rectangular patches. Every batch is rendered before you receive the next turn. Once a previous canvas exists, omit rows/frames/layers; operations and patches edit it in place. Its dimensions, palette keys/colors, frame/layer structure and timing are frozen. Use the complete chosen palette from the outset, including transparent '.', even for colors not used in blocking. Use pixels operations for individual cell corrections and transparent ink for erasing.
${batch === CANVAS_BATCHES ? "This is the last batch in this pass. Finish the highest-priority correction within the budget; report remaining limitations honestly." : "Request continue when another inspection/edit is needed. Completion is accepted only after at least one rendered inspection in this pass."}`;
}
