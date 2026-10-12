"use client";
import { useId, useImperativeHandle, useRef, useState } from "react";
import { createViewerCameraStore } from "./model-viewer-camera";
import { type ModelViewerRootProps, type ModelViewerState, splitPanes } from "./model-viewer-types";
import { useViewerCapture } from "./use-viewer-capture";
import { useViewerFeedback } from "./use-viewer-feedback";
import { useViewerFullscreen } from "./use-viewer-fullscreen";
import { useViewerInteractions } from "./use-viewer-interactions";
import { useViewerPreferences } from "./use-viewer-preferences";
import { useViewerSession } from "./use-viewer-session";
import { useReducedMotion, useViewerHidden } from "./use-viewer-visibility";

export function useModelViewerRuntime(input: ModelViewerRootProps) {
  const {
    mode,
    setMode,
    viewCube,
    setViewCube,
    projection,
    setProjection,
    inspectorOpen,
    setInspectorOpen,
    lighting,
    setLighting,
    shading,
    setShading,
    grid,
    setGrid,
    floor,
    setFloor,
    autoRotate,
    setAutoRotate,
    cameraPreset,
    setCameraPreset,
    animation,
    setAnimation,
    animationPlaying,
    setAnimationPlaying,
    animationSpeed,
    setAnimationSpeed,
    controlledAnimation,
    props: remainingProps,
  } = useViewerPreferences(input);
  const {
    components,
    src,
    alt = "3D model",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    className,
    style,
    ref,
    children,
    height,
    floorColor,
    showCubes: requestedCubes,
    showUi = true,
    enableCapture = showUi,
    showOrientation = showUi,
    viewCubePosition = "top-right",
    viewCubeMargin,
    onInspect,
    autoRotateSpeed = 0.15,
    onCameraChange,
    loopAnimation = true,
    environment = true,
    poster,
    showFileName = false,
    loadingFallback,
    errorFallback,
    showRetry = false,
    pauseWhenHidden = true,
    useDraco = true,
    useMeshopt = true,
    extendLoader,
    clearCacheOnUnmount = src?.startsWith("blob:") ?? false,
    respectReducedMotion = true,
    onPerformanceChange,
    onLoad,
    onError,
    ...props
  } = remainingProps;
  const [quality, setQuality] = useState(1.5);
  const [cameraStore] = useState(createViewerCameraStore);
  const { feedback, report, clearFeedback } = useViewerFeedback();
  const {
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
    status,
  } = useViewerSession({
    src,
    mode,
    enableCapture,
    clearCacheOnUnmount,
    clearFeedback,
    onLoad,
    onError,
    onInspect,
  });
  const {
    pointerLockAvailable,
    resetToken,
    animationResetToken,
    toolbarOffset,
    reportToolbar,
    changeMode,
    resetView,
    restartAnimation,
  } = useViewerInteractions(mode, setMode, setLocked);
  const reducedMotion = useReducedMotion(respectReducedMotion);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const viewerHidden = useViewerHidden(viewerRef);
  const renderingPaused = pauseWhenHidden && viewerHidden;
  useImperativeHandle(ref, () => viewerRef.current!, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerKey = useId();
  const cubes = requestedCubes ?? !src;
  const effectiveAutoRotate = autoRotate && !reducedMotion && !renderingPaused && mode === "orbit";
  const effectiveAnimationPlaying = animationPlaying && !reducedMotion && !renderingPaused;
  const paneTracks = useRef(
    Array.from({ length: splitPanes.length }, () => ({
      current: null as HTMLDivElement | null,
    })),
  ).current;

  const effectiveAnimation =
    controlledAnimation === null
      ? null
      : animationNames.includes(animation ?? "")
        ? animation
        : controlledAnimation === undefined
          ? (animationNames[0] ?? null)
          : animation;
  const { fullscreen, isExpanded, toggleFullscreen } = useViewerFullscreen(viewerRef, report);

  const canCapture = enableCapture && captureReady && sceneMounted && loaded && !viewerError;
  const capture = useViewerCapture({
    canvasRef,
    canCapture,
    lighting,
    fileName: ariaLabel ?? alt,
    report,
  });

  const state: ModelViewerState = {
    mode,
    setMode: changeMode,
    lighting,
    setLighting,
    shading,
    setShading,
    showGrid: grid,
    setShowGrid: setGrid,
    showFloor: floor,
    setShowFloor: setFloor,
    autoRotate,
    setAutoRotate,
    projection,
    setProjection,
    viewCube,
    setViewCube,
    cameraPreset,
    setCameraPreset,
    resetView,
    getCameraView: cameraStore.getSnapshot,
    setCameraView: cameraStore.setView,
    inspectorOpen,
    setInspectorOpen,
    inspection,
    selectedMesh,
    setSelectedMesh,
    animation: effectiveAnimation,
    animationNames,
    setAnimation,
    animationPlaying,
    setAnimationPlaying,
    animationSpeed,
    setAnimationSpeed,
    restartAnimation,
    reducedMotion,
    renderingPaused,
    retry,
    status,
    canCapture,
    capture,
    fullscreen,
    toggleFullscreen,
    feedback,
  };
  return {
    state,
    root: { components, className, style, children, height, props, isExpanded },
    viewerRef,
    canvasRef,
    enableCapture,
    setCaptureReady,
    viewerKey,
    cameraStore,
    toolbarOffset,
    reportToolbar,
    setSceneMounted,
    // Renderer configuration stays private; useModelViewer exposes only state/actions.
    src,
    accessibleLabel: ariaLabelledBy ? undefined : (ariaLabel ?? alt),
    ariaLabelledBy,
    mode,
    lighting,
    shading,
    grid,
    floor,
    floorColor,
    cubes,
    cameraPreset,
    resetToken,
    showUi,
    showOrientation,
    viewCube,
    viewCubePosition,
    viewCubeMargin,
    projection,
    effectiveAutoRotate,
    autoRotateSpeed,
    effectiveAnimation,
    effectiveAnimationPlaying,
    animationSpeed,
    animationResetToken,
    loopAnimation,
    environment,
    poster,
    showFileName,
    loadingFallback,
    errorFallback,
    showRetry,
    retryToken,
    retry,
    renderingPaused,
    useDraco,
    useMeshopt,
    extendLoader,
    loaded,
    status,
    quality,
    setQuality,
    onPerformanceChange,
    onCameraChange,
    selectedMesh,
    setSelectedMesh,
    reportInspection,
    pointerLockAvailable,
    locked,
    setLocked,
    paneTracks,
    markReady,
    reportAnimations,
    fail,
  };
}
