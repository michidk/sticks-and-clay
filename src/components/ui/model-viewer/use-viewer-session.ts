"use client";
import { useGLTF } from "@react-three/drei";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ModelInspection } from "./model-inspection";
import { initialViewerLifecycle, viewerLifecycleReducer } from "./model-viewer-lifecycle";
import { type ModelViewerRootProps, splitPanes, type ViewerMode } from "./model-viewer-types";

/** Owns scene generations and data that must be cleared together on replacement/retry. */
export function useViewerSession({
  src,
  mode,
  enableCapture,
  clearCacheOnUnmount,
  clearFeedback,
  onLoad,
  onError,
  onInspect,
}: Pick<ModelViewerRootProps, "src" | "onLoad" | "onError" | "onInspect"> & {
  mode: ViewerMode;
  enableCapture: boolean;
  clearCacheOnUnmount: boolean;
  clearFeedback: () => void;
}) {
  const [inspection, setInspection] = useState<ModelInspection | null>(null);
  const [selectedMesh, setSelectedMesh] = useState<string | null>(null);
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [lifecycle, dispatchLifecycle] = useReducer(viewerLifecycleReducer, initialViewerLifecycle);
  const loaded = lifecycle.status === "ready" || lifecycle.status === "error";
  const viewerError = lifecycle.status === "error";
  const [retryToken, setRetryToken] = useState(0);
  const [locked, setLocked] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const loadReportedGeneration = useRef<number | null>(null);
  const expectedPanes = mode === "split" ? splitPanes.length : 1;
  const [sceneMounted, setSceneMountedState] = useState(false);
  /** Clear everything derived from the current scene/load generation. */
  const resetModelSession = useCallback(() => {
    setAnimationNames([]);
    setInspection(null);
    setSelectedMesh(null);
    setLocked(false);
  }, []);
  const setSceneMounted = useCallback(
    (mounted: boolean) => {
      setSceneMountedState(mounted);
      dispatchLifecycle({ type: mounted ? "mount" : "unmount" });
      if (!mounted) {
        // The canvas goes away with the scene, so capture must wait for the next one.
        setCaptureReady(false);
        resetModelSession();
      }
    },
    [resetModelSession],
  );
  useEffect(() => {
    dispatchLifecycle({ type: "reset" });
    clearFeedback();
    resetModelSession();
  }, [src, mode, enableCapture, clearFeedback, resetModelSession]);

  useEffect(
    () => () => {
      if (src && clearCacheOnUnmount) useGLTF.clear(src);
    },
    [src, clearCacheOnUnmount],
  );

  useEffect(() => {
    if (lifecycle.status === "ready" && loadReportedGeneration.current !== lifecycle.generation) {
      loadReportedGeneration.current = lifecycle.generation;
      onLoad?.();
    }
  }, [lifecycle.status, lifecycle.generation, onLoad]);

  const reportInspection = useCallback(
    (value: ModelInspection) => {
      setInspection(value);
      onInspect?.(value);
    },
    [onInspect],
  );

  const markReady = useCallback(
    (index: number) => {
      dispatchLifecycle({ type: "ready", pane: index, expectedPanes });
    },
    [expectedPanes],
  );

  const reportAnimations = useCallback((names: string[]) => {
    setAnimationNames((current) =>
      current.length === names.length && current.every((name, index) => name === names[index])
        ? current
        : names,
    );
  }, []);

  const fail = useCallback(
    (error: Error) => {
      dispatchLifecycle({ type: "error" });
      onError?.(error);
    },
    [onError],
  );

  const retry = useCallback(() => {
    if (!viewerError || !src) return;
    useGLTF.clear(src);
    dispatchLifecycle({ type: "reset" });
    clearFeedback();
    resetModelSession();
    setRetryToken((value) => value + 1);
  }, [src, viewerError, clearFeedback, resetModelSession]);

  return {
    inspection,
    selectedMesh,
    setSelectedMesh,
    animationNames,
    loaded,
    viewerError,
    retryToken,
    locked,
    setLocked,
    captureReady,
    setCaptureReady,
    sceneMounted,
    setSceneMounted,
    reportInspection,
    markReady,
    reportAnimations,
    fail,
    retry,
    status: lifecycle.status,
  };
}
