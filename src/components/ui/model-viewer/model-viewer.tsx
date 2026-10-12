"use client";
import {
  ModelViewerAnimationBar,
  ModelViewerDefaultToolbar,
  ModelViewerFullscreen,
  ModelViewerInspector,
  ModelViewerOverlay,
  ModelViewerStatus,
} from "./model-viewer-parts";
import { ModelViewerRoot } from "./model-viewer-root";
import { ModelViewerScene } from "./model-viewer-scene";
import type { ModelViewerProps } from "./model-viewer-types";

// Keep existing direct type imports working.
export type {
  ModelInspectorPosition,
  ModelViewerProps,
  ViewerCameraOptions,
  ViewerCameraPreset,
  ViewerCameraState,
  ViewerLighting,
  ViewerMode,
  ViewerProgress,
  ViewerShading,
  ViewerViewCube,
} from "./model-viewer-types";

/** Drop-in preset built entirely from the exported compound parts. */
export function ModelViewer({
  toolbar,
  overlay,
  sceneContent,
  children,
  showUi = true,
  showAnimationControls = true,
  inspectorPosition = "right",
  ...props
}: ModelViewerProps) {
  return (
    <ModelViewerRoot showUi={showUi} {...props}>
      <ModelViewerScene sceneContent={sceneContent} />
      {overlay && <ModelViewerOverlay>{overlay}</ModelViewerOverlay>}
      {showUi && (
        <>
          {toolbar === undefined ? <ModelViewerDefaultToolbar /> : toolbar}
          {showAnimationControls && <ModelViewerAnimationBar />}
          <ModelViewerStatus />
          <ModelViewerFullscreen />
        </>
      )}
      <ModelViewerInspector position={inspectorPosition} />
      {children}
    </ModelViewerRoot>
  );
}
