"use client";
import type { RefObject } from "react";
import { viewerBackgroundColor } from "./model-viewer-colors";
import type { ViewerLighting } from "./model-viewer-types";
import type { ReportFeedback } from "./use-viewer-feedback";

/** PNG copy/download of the composited canvas over the lighting background. */
export function useViewerCapture({
  canvasRef,
  canCapture,
  lighting,
  fileName,
  report,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canCapture: boolean;
  lighting: ViewerLighting;
  fileName: string;
  report: ReportFeedback;
}) {
  return async function capture(action: "copy" | "download") {
    const canvas = canvasRef.current;
    if (!canCapture || !canvas) return;
    try {
      const source = document.createElement("canvas");
      source.width = canvas.width;
      source.height = canvas.height;
      const context = source.getContext("2d");
      if (!context) throw new Error("The viewer could not create a PNG.");
      context.fillStyle = viewerBackgroundColor(lighting);
      context.fillRect(0, 0, source.width, source.height);
      context.drawImage(canvas, 0, 0);
      const image = new Promise<Blob>((resolve, reject) => {
        source.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("The viewer could not create a PNG.")),
          "image/png",
        );
      });
      if (action === "copy") {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
          throw new Error("Image clipboard access is unavailable. Download the PNG instead.");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
        report("Screenshot copied to clipboard.");
      } else {
        const blob = await image;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${
          fileName
            .replace(/[^a-z0-9-_]+/gi, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 80) || "model-view"
        }.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        report("Screenshot downloaded as PNG.");
      }
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not capture the view.", true);
    }
  };
}
