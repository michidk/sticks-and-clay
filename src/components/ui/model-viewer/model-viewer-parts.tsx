"use client";

import type { ComponentProps } from "react";
import { useModelViewer } from "./model-viewer-context";
import { ModelViewerAnimationControls, ModelViewerControls } from "./model-viewer-toolbar";

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
