"use client";

import {
  Center,
  Environment,
  Grid,
  Lightformer,
  OrthographicCamera,
  PerformanceMonitor,
  PerspectiveCamera,
  PointerLockControls,
  Preload,
} from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { FileWarning } from "lucide-react";
import {
  Component,
  type ComponentProps,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Group, Object3D } from "three";
import type { GLTFLoader } from "three-stdlib";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { frameBounds, type ModelInspection } from "./model-inspection";
import type { ViewerCameraStore } from "./model-viewer-camera";
import { viewerBackgroundColor } from "./model-viewer-colors";
import { useViewerRuntime } from "./model-viewer-context";
import { ModelViewerOrientationControls } from "./model-viewer-orientation";
import {
  type ModelViewerProps,
  splitPanes,
  type ViewerCameraPreset,
  type ViewerCameraState,
  type ViewerLighting,
  type ViewerMode,
  type ViewerShading,
  type ViewerViewCube,
  type ViewFace,
} from "./model-viewer-types";
import { OutsideSky } from "./outside-sky";
import { CameraRig, DragLook, FirstPersonMovement, FitStaticCamera } from "./scene-camera";
import { SceneObject } from "./scene-model";
import { RedrawAfterResize, ScissorView } from "./scene-renderer";
import { ViewCube, type ViewCubePosition } from "./view-cube";
import { ViewerLoader } from "./viewer-loader";
import { ViewerControlButton } from "./viewer-ui";
import "./model-viewer.css";

class ViewerErrorBoundary extends Component<
  {
    children: ReactNode;
    fallback?: ModelViewerProps["errorFallback"];
    onError?: (error: Error) => void;
    retry?: () => void;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const custom =
      typeof this.props.fallback === "function"
        ? this.props.fallback(this.state.error)
        : this.props.fallback;
    if (this.props.fallback !== undefined && custom == null) return null;
    return (
      <div className="viewer-error-wrap">
        {this.props.fallback !== undefined ? (
          custom
        ) : (
          <Alert className="max-w-sm p-5">
            <FileWarning className="text-muted-foreground" aria-hidden="true" />
            <AlertTitle>Unable to load model</AlertTitle>
            <AlertDescription>
              <p>Check that the model is available and is a valid GLTF or GLB file.</p>
              {this.props.retry && (
                <ViewerControlButton variant="outline" size="sm" onClick={this.props.retry}>
                  Retry loading model
                </ViewerControlButton>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }
}

export function ModelViewerScene({
  className,
  children,
  sceneContent,
  ...props
}: ComponentProps<"div"> & { sceneContent?: ReactNode }) {
  const {
    viewerRef,
    canvasRef,
    enableCapture,
    setCaptureReady,
    viewerKey,
    cameraStore,
    toolbarOffset,
    setSceneMounted,
    src,
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
    loadingFallback,
    showFileName,
    errorFallback,
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
    setLocked,
    paneTracks,
    markReady,
    reportAnimations,
    fail,
    showRetry,
    retry,
    retryToken,
    renderingPaused,
  } = useViewerRuntime();
  useEffect(() => {
    setSceneMounted(true);
    return () => {
      setSceneMounted(false);
      canvasRef.current = null;
    };
  }, [setSceneMounted, canvasRef]);
  const panes = mode === "split" ? splitPanes : [{}];
  return (
    <div data-slot="model-viewer-scene" className={cn("viewer-stage", className)} {...props}>
      {poster && !loaded && (
        <img className="viewer-poster" src={poster} alt="" aria-hidden="true" />
      )}
      <ViewerErrorBoundary
        key={`${src ?? "demo"}:${mode}:${retryToken}`}
        fallback={errorFallback}
        onError={fail}
        retry={showRetry && src ? retry : undefined}
      >
        <div className="viewer-scenes">
          {panes.map((pane, index) => {
            const paneKey = `${viewerKey}-pane-${index}`;
            return (
              <div
                className={cn(
                  "viewer-scene",
                  index === 0 ? "viewer-scene-primary" : "viewer-scene-secondary",
                )}
                key={`${mode}-${pane.face ?? "primary"}`}
              >
                <div ref={paneTracks[index]} className="viewer-view" data-viewer-pane={paneKey} />
                {showUi && mode === "split" && (
                  <span className="viewer-pane-label">{pane.label}</span>
                )}
              </div>
            );
          })}
        </div>
        <Canvas
          key={String(enableCapture)}
          className="viewer-canvas"
          shadows={floor}
          dpr={quality}
          frameloop={renderingPaused ? "never" : effectiveAutoRotate ? "always" : "demand"}
          gl={{
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: enableCapture,
            powerPreference: "high-performance",
          }}
          eventSource={viewerRef}
          onPointerMissed={(event) => {
            if (event.target instanceof Element && event.target.closest("[data-viewer-pane]")) {
              setSelectedMesh(null);
            }
          }}
          onCreated={({ gl }) => {
            canvasRef.current = gl.domElement;
            setCaptureReady(gl.getContext().getContextAttributes()?.preserveDrawingBuffer === true);
            gl.setClearAlpha(0);
          }}
        >
          <RedrawAfterResize />
          <PerformanceMonitor
            onChange={({ factor }) => {
              setQuality(1 + factor);
              onPerformanceChange?.(factor);
            }}
          />
          {panes.map((pane, index) => {
            const paneKey = `${viewerKey}-pane-${index}`;
            return (
              <ScissorView
                key={`${mode}-${pane.face ?? "primary"}`}
                track={paneTracks[index]}
                index={index + 1}
                clearColor={viewerBackgroundColor(lighting)}
              >
                <ViewerScene
                  lighting={lighting}
                  shading={shading}
                  grid={grid}
                  floor={floor}
                  floorColor={floorColor}
                  src={src}
                  cubes={cubes}
                  mode={mode}
                  face={pane.face}
                  cameraPreset={pane.face ?? cameraPreset}
                  resetToken={resetToken}
                  autoRotate={index === 0 && effectiveAutoRotate}
                  autoRotateSpeed={autoRotateSpeed}
                  showOrientation={index === 0 && showOrientation && mode !== "split"}
                  viewCube={viewCube}
                  viewCubePosition={viewCubePosition}
                  viewCubeMargin={viewCubeMargin}
                  toolbarOffset={toolbarOffset}
                  projection={projection}
                  onInspect={index === 0 ? reportInspection : undefined}
                  selectedMesh={selectedMesh}
                  onSelectMesh={setSelectedMesh}
                  pointerLockAvailable={pointerLockAvailable}
                  paneSelector={`[data-viewer-pane="${paneKey}"]`}
                  environment={environment}
                  animation={effectiveAnimation}
                  animationPlaying={effectiveAnimationPlaying}
                  animationSpeed={animationSpeed}
                  animationResetToken={animationResetToken}
                  loopAnimation={loopAnimation}
                  useDraco={useDraco}
                  useMeshopt={useMeshopt}
                  extendLoader={extendLoader}
                  onReady={() => markReady(index)}
                  onAnimations={reportAnimations}
                  onCameraChange={index === 0 ? onCameraChange : undefined}
                  cameraStore={index === 0 ? cameraStore : undefined}
                  sceneContent={index === 0 ? sceneContent : undefined}
                  onLockChange={index === 0 ? setLocked : undefined}
                />
              </ScissorView>
            );
          })}
          <Preload all />
        </Canvas>
      </ViewerErrorBoundary>

      <ModelViewerOrientationControls />

      {status === "loading" && (
        <ViewerLoader
          fallback={loadingFallback}
          poster={Boolean(poster)}
          showFileName={showFileName}
          src={src}
        />
      )}

      {children}
    </div>
  );
}

function ViewerScene({
  lighting,
  shading,
  grid,
  floor,
  floorColor,
  src,
  cubes,
  mode,
  face,
  cameraPreset,
  resetToken,
  autoRotate,
  autoRotateSpeed,
  showOrientation,
  viewCube,
  viewCubePosition,
  viewCubeMargin,
  toolbarOffset,
  projection,
  onInspect,
  selectedMesh,
  onSelectMesh,
  pointerLockAvailable,
  paneSelector,
  environment,
  animation,
  animationPlaying,
  animationSpeed,
  animationResetToken,
  loopAnimation,
  useDraco,
  useMeshopt,
  extendLoader,
  onReady,
  onAnimations,
  onCameraChange,
  cameraStore,
  sceneContent,
  onLockChange,
}: {
  lighting: ViewerLighting;
  shading: ViewerShading;
  grid: boolean;
  floor: boolean;
  floorColor?: string;
  src?: string;
  cubes: boolean;
  mode: ViewerMode;
  face?: ViewFace;
  cameraPreset: ViewerCameraPreset;
  resetToken: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  showOrientation: boolean;
  viewCube: ViewerViewCube | false;
  viewCubePosition: ViewCubePosition;
  viewCubeMargin?: [number, number];
  toolbarOffset: number;
  projection: "perspective" | "orthographic";
  onInspect?: (value: ModelInspection) => void;
  selectedMesh: string | null;
  onSelectMesh: (id: string | null) => void;
  pointerLockAvailable: boolean;
  paneSelector: string;
  environment: boolean;
  animation: string | null;
  animationPlaying: boolean;
  animationSpeed: number;
  animationResetToken: number;
  loopAnimation: boolean;
  useDraco: boolean | string;
  useMeshopt: boolean;
  extendLoader?: (loader: GLTFLoader) => void;
  onReady: () => void;
  onAnimations: (names: string[]) => void;
  onCameraChange?: (state: ViewerCameraState) => void;
  cameraStore?: ViewerCameraStore;
  sceneContent?: ReactNode;
  onLockChange?: (locked: boolean) => void;
}) {
  const contentRef = useRef<Group | null>(null);
  const paneWidth = useThree((state) => state.size.width);
  const cubeMargin: [number, number] = viewCubeMargin ?? [
    64,
    paneWidth <= 680 && viewCubePosition.startsWith("top-")
      ? Math.max(64, toolbarOffset + 64)
      : 64,
  ];
  const [fitVersion, setFitVersion] = useState(0);
  const [gridScale, setGridScale] = useState(1);
  const handleCentered = useCallback(({ container }: { container: Object3D }) => {
    // Include the animation envelope, and keep grid density relative to the asset.
    setGridScale(frameBounds(container, 1).radius / 2);
    setFitVersion((value) => value + 1);
  }, []);
  const background = viewerBackgroundColor(lighting);

  return (
    <>
      {projection === "orthographic" ? (
        <OrthographicCamera makeDefault position={[3, 3, 3]} near={0.001} far={1000} />
      ) : (
        <PerspectiveCamera makeDefault position={[3, 3, 3]} fov={42} near={0.01} far={1000} />
      )}
      <color attach="background" args={[background]} />
      {lighting === "outside" && <OutsideSky />}
      <ambientLight intensity={lighting === "night" ? 0.3 : 0.48} />
      <directionalLight
        position={[5 * gridScale, 9 * gridScale, 6 * gridScale]}
        intensity={lighting === "night" ? 1.05 : lighting === "outside" ? 2 : 1.7}
        color={lighting === "night" ? "#bdd5ff" : "#fff7e6"}
        castShadow={floor}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16 * gridScale}
        shadow-camera-right={16 * gridScale}
        shadow-camera-top={16 * gridScale}
        shadow-camera-bottom={-16 * gridScale}
        shadow-camera-near={0.1 * gridScale}
        shadow-camera-far={40 * gridScale}
        shadow-normalBias={0.02 * gridScale}
      />
      <directionalLight
        position={[-4, 4, -6]}
        intensity={lighting === "night" ? 1.4 : 0.45}
        color={lighting === "night" ? "#688db3" : "#dcebdc"}
      />
      {environment &&
        (lighting === "outside" ? (
          <Environment resolution={128} frames={1} background={false} environmentIntensity={0.8}>
            <OutsideSky />
          </Environment>
        ) : (
          <StudioEnvironment key={lighting} lighting={lighting} />
        ))}
      {floor && (
        <>
          <mesh
            name="Viewer floor"
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002 * gridScale, 0]}
          >
            <planeGeometry args={[2000 * gridScale, 2000 * gridScale]} />
            <meshBasicMaterial color={floorColor ?? background} toneMapped={false} />
          </mesh>
          <mesh
            name="Viewer floor shadows"
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.001 * gridScale, 0]}
            receiveShadow
          >
            <planeGeometry args={[2000 * gridScale, 2000 * gridScale]} />
            <shadowMaterial
              transparent
              opacity={lighting === "night" ? 0.5 : 0.28}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
      {grid && (
        <Grid
          infiniteGrid
          fadeFrom={0}
          fadeDistance={18 * gridScale}
          fadeStrength={1.6}
          cellSize={0.25 * gridScale}
          sectionSize={gridScale}
          cellThickness={0.45}
          sectionThickness={1.15}
          cellColor={lighting === "day" ? "#b3b3b3" : "#404040"}
          sectionColor={lighting === "day" ? "#808080" : "#737373"}
          position={[0, 0.002 * gridScale, 0]}
        />
      )}
      <Suspense fallback={null}>
        <Center ref={contentRef} top precise onCentered={handleCentered}>
          <SceneObject
            src={src}
            cubes={cubes}
            shading={shading}
            animation={animation}
            animationPlaying={animationPlaying}
            animationSpeed={animationSpeed}
            animationResetToken={animationResetToken}
            loopAnimation={loopAnimation}
            useDraco={useDraco}
            useMeshopt={useMeshopt}
            extendLoader={extendLoader}
            onReady={onReady}
            onAnimations={onAnimations}
            onInspect={onInspect}
            selectedMesh={selectedMesh}
            onSelectMesh={onSelectMesh}
          />
        </Center>
      </Suspense>
      {mode === "firstPerson" && !face ? (
        <>
          <FitStaticCamera
            objectRef={contentRef}
            fitVersion={fitVersion}
            preset={cameraPreset}
            resetToken={resetToken}
          />
          {pointerLockAvailable ? (
            <PointerLockControls
              makeDefault
              selector={paneSelector}
              onLock={() => onLockChange?.(true)}
              onUnlock={() => onLockChange?.(false)}
            />
          ) : (
            <DragLook selector={paneSelector} />
          )}
          <FirstPersonMovement requirePointerLock={pointerLockAvailable} selector={paneSelector} />
        </>
      ) : (
        <>
          <CameraRig
            lighting={lighting}
            fixed={Boolean(face)}
            paneSelector={paneSelector}
            objectRef={contentRef}
            fitVersion={fitVersion}
            preset={cameraPreset}
            resetToken={resetToken}
            autoRotate={autoRotate}
            autoRotateSpeed={autoRotateSpeed}
            onCameraChange={onCameraChange}
            cameraStore={mode === "orbit" ? cameraStore : undefined}
          />
          {mode === "orbit" && sceneContent}
          {showOrientation && viewCube && (
            <ViewCube
              variant={viewCube}
              position={viewCubePosition}
              margin={cubeMargin}
              renderPriority={2}
            />
          )}
        </>
      )}
    </>
  );
}

function StudioEnvironment({ lighting }: { lighting: ViewerLighting }) {
  const night = lighting === "night";
  return (
    <Environment
      resolution={128}
      frames={1}
      background={false}
      environmentIntensity={night ? 0.7 : 0.9}
    >
      <Lightformer
        form="rect"
        intensity={night ? 2.4 : 3.2}
        color={night ? "#91b8ef" : "#fff4dc"}
        position={[0, 5, 5]}
        scale={[8, 3, 1]}
      />
      <Lightformer
        form="rect"
        intensity={night ? 1.8 : 2}
        color={night ? "#5f81a9" : "#dcebdc"}
        position={[-5, 2, -3]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[5, 3, 1]}
      />
      <Lightformer
        form="ring"
        intensity={night ? 1.2 : 1.6}
        color={night ? "#d9e8ff" : "#ffffff"}
        position={[4, 1, -4]}
        scale={2.5}
      />
    </Environment>
  );
}
