"use client";
import { useEffect, useRef } from "react";
import type { ModelViewerRootProps } from "./model-viewer-types";
import { useControlledState } from "./use-controlled-state";

/** Owns controlled/default/onChange preferences and consumes their DOM-ineligible props. */
export function useViewerPreferences({
  mode: controlledMode,
  defaultMode = "orbit",
  onModeChange,
  lighting: controlledLighting,
  defaultLighting = "day",
  onLightingChange,
  shading: controlledShading,
  defaultShading = "realistic",
  onShadingChange,
  showGrid: controlledGrid,
  defaultShowGrid = false,
  onGridChange,
  showFloor: controlledFloor,
  defaultShowFloor = false,
  onFloorChange,
  viewCube: controlledViewCube,
  defaultViewCube = "asset-studio",
  onViewCubeChange,
  projection: controlledProjection,
  defaultProjection = "perspective",
  onProjectionChange,
  showInspector,
  inspectorOpen: controlledInspectorOpen,
  defaultInspectorOpen = false,
  onInspectorOpenChange,
  autoRotate: controlledAutoRotate,
  defaultAutoRotate = false,
  onAutoRotateChange,
  cameraPreset: controlledCameraPreset,
  defaultCameraPreset = "isometric",
  onCameraPresetChange,
  animation: controlledAnimation,
  defaultAnimation = null,
  onAnimationChange,
  animationPlaying: controlledAnimationPlaying,
  defaultAnimationPlaying = false,
  onAnimationPlayingChange,
  animationSpeed: controlledAnimationSpeed,
  defaultAnimationSpeed = 1,
  onAnimationSpeedChange,
  ...props
}: ModelViewerRootProps) {
  const { src } = props;
  const [mode, setMode] = useControlledState(controlledMode, defaultMode, onModeChange);

  const [viewCube, setViewCube] = useControlledState(
    controlledViewCube,
    defaultViewCube,
    onViewCubeChange,
  );

  const [projection, setProjection] = useControlledState(
    controlledProjection,
    defaultProjection,
    onProjectionChange,
  );

  const [inspectorOpen, setInspectorOpen] = useControlledState(
    controlledInspectorOpen,
    showInspector ?? defaultInspectorOpen,
    onInspectorOpenChange,
  );

  const [lighting, setLighting] = useControlledState(
    controlledLighting,
    defaultLighting,
    onLightingChange,
  );

  const [shading, setShading] = useControlledState(
    controlledShading,
    defaultShading,
    onShadingChange,
  );

  const [grid, setGrid] = useControlledState(controlledGrid, defaultShowGrid, onGridChange);

  const [floor, setFloor] = useControlledState(controlledFloor, defaultShowFloor, onFloorChange);

  const [autoRotate, setAutoRotate] = useControlledState(
    controlledAutoRotate,
    defaultAutoRotate,
    onAutoRotateChange,
  );

  const [cameraPreset, setCameraPreset] = useControlledState(
    controlledCameraPreset,
    defaultCameraPreset,
    onCameraPresetChange,
  );

  const [animation, setAnimation, resetAnimation] = useControlledState<string | null>(
    controlledAnimation,
    defaultAnimation,
    onAnimationChange,
  );

  const [animationPlaying, setAnimationPlaying] = useControlledState(
    controlledAnimationPlaying,
    defaultAnimationPlaying,
    onAnimationPlayingChange,
  );

  const [animationSpeed, setAnimationSpeed] = useControlledState(
    controlledAnimationSpeed,
    defaultAnimationSpeed,
    onAnimationSpeedChange,
  );

  const previousAnimationSrc = useRef(src);
  useEffect(() => {
    if (previousAnimationSrc.current === src) return;
    previousAnimationSrc.current = src;
    if (controlledAnimation === undefined) resetAnimation(defaultAnimation);
  }, [src, defaultAnimation, controlledAnimation, resetAnimation]);

  useEffect(() => {
    if (showInspector !== undefined && controlledInspectorOpen === undefined)
      setInspectorOpen(showInspector);
  }, [showInspector, controlledInspectorOpen, setInspectorOpen]);

  return {
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
    props,
  };
}
