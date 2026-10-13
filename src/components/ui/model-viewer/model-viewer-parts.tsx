"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { ModelInspector, type ModelInspectorProps } from "./model-inspector";
import { useModelViewer, useViewerRuntime } from "./model-viewer-context";
import { ModelViewerAnimationControls, ModelViewerControls } from "./model-viewer-toolbar";
import { ViewerControlButton } from "./viewer-ui";

/** Ready-made toolbar connected to the nearest root. */
export function ModelViewerDefaultToolbar(props: Omit<ComponentProps<"div">, "onReset">) {
  const viewer = useModelViewer();
  return (
    <ModelViewerControls
      mode={viewer.mode}
      onModeChange={viewer.setMode}
      shading={viewer.shading}
      onShadingChange={viewer.setShading}
      lighting={viewer.lighting}
      onLightingChange={viewer.setLighting}
      grid={viewer.showGrid}
      onGridChange={viewer.setShowGrid}
      floor={viewer.showFloor}
      onFloorChange={viewer.setShowFloor}
      autoRotate={viewer.autoRotate}
      onAutoRotateChange={viewer.setAutoRotate}
      projection={viewer.projection}
      onProjectionChange={viewer.setProjection}
      viewCube={viewer.viewCube}
      onViewCubeChange={viewer.setViewCube}
      inspectorOpen={viewer.inspectorOpen}
      onInspectorChange={viewer.setInspectorOpen}
      onReset={viewer.resetView}
      captureDisabled={!viewer.canCapture}
      onCapture={viewer.capture}
      {...props}
    />
  );
}

/** Renders only when the current model has animation clips. */
export function ModelViewerAnimationBar(props: ComponentProps<"div">) {
  const viewer = useModelViewer();
  if (viewer.animationNames.length === 0) return null;
  return (
    <ModelViewerAnimationControls
      clips={viewer.animationNames}
      animation={viewer.animation}
      onAnimationChange={viewer.setAnimation}
      playing={viewer.animationPlaying}
      onPlayingChange={viewer.setAnimationPlaying}
      speed={viewer.animationSpeed}
      onSpeedChange={viewer.setAnimationSpeed}
      onRestart={viewer.restartAnimation}
      {...props}
    />
  );
}

export type ModelViewerInspectorProps = Omit<
  ModelInspectorProps,
  "inspection" | "selectedMesh" | "onSelectMesh"
>;

/** Connected inspector; ModelInspector remains available for standalone data. */
export function ModelViewerInspector({ onClose, ...props }: ModelViewerInspectorProps) {
  const viewer = useModelViewer();
  if (!viewer.inspectorOpen || !viewer.inspection) return null;
  return (
    <ModelInspector
      inspection={viewer.inspection}
      selectedMesh={viewer.selectedMesh}
      onSelectMesh={viewer.setSelectedMesh}
      onClose={() => {
        viewer.setInspectorOpen(false);
        onClose?.();
      }}
      {...props}
    />
  );
}

export function ModelViewerStatus({ className, children, ...props }: ComponentProps<"div">) {
  const { state: viewer, pointerLockAvailable, locked } = useViewerRuntime();
  const instructions =
    viewer.mode === "firstPerson"
      ? pointerLockAvailable
        ? locked
          ? "WASD to fly · Space up · Shift down · Esc to release"
          : "Click the scene to look · WASD to fly"
        : "Drag to look · WASD to fly · Space / Shift vertically"
      : viewer.mode === "split"
        ? "Fixed views · Drag to pan · Scroll to zoom"
        : "Drag to orbit · Scroll to zoom";
  return (
    <div
      data-slot="model-viewer-status"
      className={cn(
        "viewer-help rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground",
        viewer.feedback?.error && "text-destructive",
        className,
      )}
      role={viewer.feedback?.error ? "alert" : "status"}
      {...props}
    >
      {children ?? viewer.feedback?.message ?? instructions}
    </div>
  );
}

export function ModelViewerFullscreen({
  className,
  children,
  onClick,
  ...props
}: ComponentProps<typeof ViewerControlButton>) {
  const viewer = useModelViewer();
  return (
    <ViewerControlButton
      data-slot="model-viewer-fullscreen"
      size="icon-sm"
      variant="secondary"
      className={cn("viewer-fullscreen", className)}
      aria-label={viewer.fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void viewer.toggleFullscreen();
      }}
    >
      {children ?? (viewer.fullscreen ? <Minimize2 /> : <Maximize2 />)}
    </ViewerControlButton>
  );
}

export function ModelViewerOverlay({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="model-viewer-overlay"
      className={cn("viewer-overlay-slot", className)}
      {...props}
    />
  );
}
