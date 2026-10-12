import type { ComponentProps, CSSProperties, ReactNode } from "react";
import type { GLTFLoader } from "three-stdlib";
import type { ModelInspection } from "./model-inspection";
import type { ViewCubePosition } from "./view-cube";
import type { ViewerUiComponents } from "./viewer-ui";

export type ViewerMode = "orbit" | "split" | "firstPerson";
export type ViewerLighting = "day" | "night" | "outside";
export type ViewerShading = "realistic" | "solid" | "normals" | "wireframe";
export type ViewerViewCube = "drei" | "asset-studio";
export type ModelInspectorPosition = "left" | "right";
export type ViewerCameraPreset =
  | "isometric"
  | "front"
  | "right"
  | "back"
  | "left"
  | "top"
  | "bottom";

export type ViewerCameraState = {
  position: [number, number, number];
  target: [number, number, number];
};

export type ViewerCameraOptions = { transition?: boolean };

export type ViewerProgress = {
  /** Indeterminate, viewer-scoped loading state. Counts remain zero until a per-viewer asset manager is supplied. */
  active: boolean;
  progress: number;
  item: string;
  loaded: number;
  total: number;
};

export interface ModelViewerProps extends Omit<ComponentProps<"div">, "onLoad" | "onError"> {
  /** Compatibility escape hatch. Prefer local primitives, composition, and render. */
  components?: Partial<ViewerUiComponents>;
  src?: string;
  /** @deprecated Use aria-label (or aria-labelledby) to name the viewer. */
  alt?: string;
  className?: string;
  height?: CSSProperties["height"];
  mode?: ViewerMode;
  defaultMode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
  lighting?: ViewerLighting;
  defaultLighting?: ViewerLighting;
  onLightingChange?: (lighting: ViewerLighting) => void;
  shading?: ViewerShading;
  defaultShading?: ViewerShading;
  onShadingChange?: (shading: ViewerShading) => void;
  showGrid?: boolean;
  defaultShowGrid?: boolean;
  onGridChange?: (visible: boolean) => void;
  /** Infinite-looking ground plane that receives model shadows. */
  showFloor?: boolean;
  defaultShowFloor?: boolean;
  onFloorChange?: (visible: boolean) => void;
  /** Defaults to the current lighting mode's background/horizon color. */
  floorColor?: string;
  showCubes?: boolean;
  showUi?: boolean;
  /** Preserve the WebGL buffer for PNG capture. Defaults to showUi; enable explicitly for custom controls. */
  enableCapture?: boolean;
  showOrientation?: boolean;
  viewCube?: ViewerViewCube | false;
  defaultViewCube?: ViewerViewCube | false;
  viewCubePosition?: ViewCubePosition;
  viewCubeMargin?: [number, number];
  /** R3F nodes rendered inside the primary orbit scene, after its camera controls. */
  sceneContent?: ReactNode;
  onViewCubeChange?: (value: ViewerViewCube | false) => void;
  projection?: "perspective" | "orthographic";
  defaultProjection?: "perspective" | "orthographic";
  onProjectionChange?: (projection: "perspective" | "orthographic") => void;
  /** Legacy initial/synchronized visibility. Prefer inspectorOpen/defaultInspectorOpen. */
  showInspector?: boolean;
  inspectorOpen?: boolean;
  defaultInspectorOpen?: boolean;
  /** Side used by the built-in inspector. Defaults to right. */
  inspectorPosition?: ModelInspectorPosition;
  onInspectorOpenChange?: (open: boolean) => void;
  onInspect?: (inspection: ModelInspection) => void;
  showAnimationControls?: boolean;
  /** Controlled camera orbit around the model. Active only in orbit mode. */
  autoRotate?: boolean;
  /** Initial auto-rotation for an uncontrolled viewer. */
  defaultAutoRotate?: boolean;
  onAutoRotateChange?: (rotating: boolean) => void;
  autoRotateSpeed?: number;
  cameraPreset?: ViewerCameraPreset;
  defaultCameraPreset?: ViewerCameraPreset;
  onCameraPresetChange?: (preset: ViewerCameraPreset) => void;
  onCameraChange?: (state: ViewerCameraState) => void;
  animation?: string | null;
  defaultAnimation?: string | null;
  onAnimationChange?: (animation: string | null) => void;
  animationPlaying?: boolean;
  defaultAnimationPlaying?: boolean;
  onAnimationPlayingChange?: (playing: boolean) => void;
  animationSpeed?: number;
  defaultAnimationSpeed?: number;
  onAnimationSpeedChange?: (speed: number) => void;
  loopAnimation?: boolean;
  environment?: boolean;
  poster?: string;
  /** Display the current asset filename in the default loader. Defaults to false. */
  showFileName?: boolean;
  /** Replace loading content. Pass null to hide the loading overlay. */
  loadingFallback?: ReactNode | ((progress: ViewerProgress) => ReactNode);
  /** Replace error content. Pass null to hide the error overlay. */
  errorFallback?: ReactNode | ((error: Error) => ReactNode);
  /** Opt in to a retry button in the default error state. */
  showRetry?: boolean;
  /** Suspend rendering while outside the viewport or in a hidden tab. */
  pauseWhenHidden?: boolean;
  overlay?: ReactNode;
  /** Replace the default toolbar; null hides it. Custom controls can use useModelViewer(). */
  toolbar?: ReactNode;
  useDraco?: boolean | string;
  useMeshopt?: boolean;
  extendLoader?: (loader: GLTFLoader) => void;
  clearCacheOnUnmount?: boolean;
  respectReducedMotion?: boolean;
  onPerformanceChange?: (factor: number) => void;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

export type ModelViewerRootProps = Omit<
  ModelViewerProps,
  "toolbar" | "overlay" | "showAnimationControls" | "sceneContent" | "inspectorPosition"
>;

export interface ModelViewerState {
  mode: ViewerMode;
  setMode: (mode: ViewerMode) => void;
  lighting: ViewerLighting;
  setLighting: (lighting: ViewerLighting) => void;
  shading: ViewerShading;
  setShading: (shading: ViewerShading) => void;
  showGrid: boolean;
  setShowGrid: (visible: boolean) => void;
  showFloor: boolean;
  setShowFloor: (visible: boolean) => void;
  autoRotate: boolean;
  setAutoRotate: (rotating: boolean) => void;
  projection: "perspective" | "orthographic";
  setProjection: (projection: "perspective" | "orthographic") => void;
  viewCube: ViewerViewCube | false;
  setViewCube: (cube: ViewerViewCube | false) => void;
  cameraPreset: ViewerCameraPreset;
  setCameraPreset: (preset: ViewerCameraPreset) => void;
  resetView: () => void;
  /** Latest primary orbit camera view, or null before camera controls mount. */
  getCameraView: () => ViewerCameraState | null;
  /** Returns false when orbit controls are unavailable or the view is invalid. */
  setCameraView: (view: ViewerCameraState, options?: ViewerCameraOptions) => boolean;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  inspection: ModelInspection | null;
  selectedMesh: string | null;
  setSelectedMesh: (id: string | null) => void;
  animation: string | null;
  animationNames: string[];
  setAnimation: (clip: string | null) => void;
  animationPlaying: boolean;
  setAnimationPlaying: (playing: boolean) => void;
  animationSpeed: number;
  setAnimationSpeed: (speed: number) => void;
  restartAnimation: () => void;
  reducedMotion: boolean;
  renderingPaused: boolean;
  /** Retry a failed load of the current URL, clearing Drei's cached failure. */
  retry: () => void;
  status: "idle" | "loading" | "ready" | "error";
  canCapture: boolean;
  capture: (action: "copy" | "download") => Promise<void>;
  fullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
  feedback: { message: string; error: boolean } | null;
}
export type ViewFace = "front" | "right" | "back" | "left";

type Pane = {
  face?: ViewFace;
  label?: string;
};

export const splitPanes: Pane[] = [
  { face: "front", label: "Front" },
  { face: "right", label: "Right" },
  { face: "back", label: "Back" },
  { face: "left", label: "Left" },
];
