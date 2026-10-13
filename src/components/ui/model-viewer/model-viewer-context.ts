"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ModelViewerState } from "./model-viewer-types";
import type { useModelViewerRuntime } from "./use-model-viewer-runtime";

/** Internal renderer context. Not part of the public barrel. */
export const ModelViewerContext = createContext<ReturnType<typeof useModelViewerRuntime> | null>(
  null,
);

export function useOptionalViewerRuntime() {
  return useContext(ModelViewerContext);
}

export function useViewerRuntime() {
  const context = useOptionalViewerRuntime();
  if (!context)
    throw new Error("Model viewer parts must be used inside <ModelViewerRoot> or <ModelViewer>.");
  return context;
}

/** State and actions scoped to the nearest viewer. */
export function useModelViewer(): ModelViewerState {
  return useViewerRuntime().state;
}

/** Live primary orbit camera view without rerendering the whole viewer. */
export function useModelViewerCamera() {
  const { cameraStore } = useViewerRuntime();
  return useSyncExternalStore(cameraStore.subscribe, cameraStore.getSnapshot, () => null);
}
