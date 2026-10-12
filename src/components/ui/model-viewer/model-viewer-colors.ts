import type { ViewerLighting } from "./model-viewer-types";

export function viewerBackgroundColor(lighting: ViewerLighting) {
  if (lighting === "night") return "#17243a";
  if (lighting === "outside") return "#dbe9ee";
  return "#f5f5f5";
}
