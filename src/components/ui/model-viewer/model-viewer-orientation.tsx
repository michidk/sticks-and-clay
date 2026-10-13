"use client";

import { Compass } from "lucide-react";
import type { ComponentProps } from "react";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "./primitives/dropdown-menu";
import { cn } from "@/lib/utils";
import { useViewerRuntime } from "./model-viewer-context";
import type { ViewerCameraPreset } from "./model-viewer-types";
import { DropdownMenuContent } from "./viewer-popups";
import { ViewerControlButton } from "./viewer-ui";

const directions: ViewerCameraPreset[] = [
  "front",
  "right",
  "back",
  "left",
  "top",
  "bottom",
  "isometric",
];

/** Keyboard counterpart to the canvas gizmo. Reveals itself when focused. */
export function ModelViewerOrientationControls({ className, ...props }: ComponentProps<"div">) {
  const { state, showOrientation } = useViewerRuntime();
  if (!showOrientation || !state.viewCube || state.mode !== "orbit" || state.status !== "ready")
    return null;
  return (
    <div
      data-slot="model-viewer-orientation"
      className={cn("viewer-orientation-controls", className)}
      {...props}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <ViewerControlButton aria-label="Orient view" variant="outline" size="sm">
              <Compass /> Orient view
            </ViewerControlButton>
          }
        />
        <DropdownMenuContent align="end">
          {directions.map((direction) => (
            <DropdownMenuItem
              key={direction}
              onClick={() => {
                state.setCameraPreset(direction);
                state.resetView();
              }}
            >
              {direction[0].toUpperCase() + direction.slice(1)} view
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
