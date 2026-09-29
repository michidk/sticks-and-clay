import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Bounds,
  Clone,
  GizmoHelper,
  GizmoViewcube,
  OrbitControls,
  PointerLockControls,
  useBounds,
  useGLTF,
} from "@react-three/drei";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Camera,
  Copy,
  Download,
  Grid2X2,
  Maximize2,
  Moon,
  MousePointer2,
  Rotate3D,
  Sun,
  View,
  Footprints,
} from "lucide-react";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ViewerSkeleton } from "@/components/loading";
import { cn } from "@/lib/utils";

export type ViewerMode = "orbit" | "object" | "firstPerson";
export type ViewerLighting = "day" | "night";

/** A self-contained GLB lightbox. Set showUi=false for a clean embedded preview. */
export interface ModelViewerProps {
  src?: string;
  alt?: string;
  className?: string;
  height?: CSSProperties["height"];
  mode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
  lighting?: ViewerLighting;
  onLightingChange?: (lighting: ViewerLighting) => void;
  showGround?: boolean;
  showGrid?: boolean;
  showCubes?: boolean;
  showUi?: boolean;
  showOrientation?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

type Direction = { id: number; yaw: number; pitch: number };

class ViewerErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
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
    if (this.state.error)
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Could not display this model: {this.state.error.message}
          </AlertDescription>
        </Alert>
      );
    return this.props.children;
  }
}

export function ModelViewer({
  src,
  alt = "3D model",
  className,
  height,
  mode: requestedMode,
  onModeChange,
  lighting: requestedLighting,
  onLightingChange,
  showGround: requestedGround = true,
  showGrid: requestedGrid = false,
  showCubes: requestedCubes,
  showUi = true,
  showOrientation = showUi,
  autoRotate = false,
  autoRotateSpeed = 0.15,
  onLoad,
  onError,
}: ModelViewerProps) {
  const [mode, setMode] = useState<ViewerMode>(requestedMode ?? "orbit");
  const viewerKey = useId();
  const [lighting, setLighting] = useState<ViewerLighting>(requestedLighting ?? "day");
  const [ground, setGround] = useState(requestedGround);
  const [grid, setGrid] = useState(requestedGrid);
  const [cubes, setCubes] = useState(requestedCubes ?? !src);
  const [loaded, setLoaded] = useState(!src);
  const [viewerError, setViewerError] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locked, setLocked] = useState(false);
  const [pointerLockAvailable, setPointerLockAvailable] = useState(true);
  const [resetToken, setResetToken] = useState(0);
  const [direction, setDirection] = useState<Direction>({ id: 0, yaw: 0, pitch: 0 });

  useEffect(() => { if (requestedMode) setMode(requestedMode); }, [requestedMode]);
  useEffect(() => { if (requestedLighting) setLighting(requestedLighting); }, [requestedLighting]);
  useEffect(() => setGround(requestedGround), [requestedGround]);
  useEffect(() => setGrid(requestedGrid), [requestedGrid]);
  useEffect(() => setCubes(requestedCubes ?? !src), [requestedCubes, src]);
  useEffect(() => { setLoaded(!src); setViewerError(false); setCaptureFeedback(null); }, [src]);
  useEffect(() => setLocked(false), [mode]);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);
  useEffect(() => {
    const policy = (document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy;
    setPointerLockAvailable(policy?.allowsFeature("pointer-lock") !== false);
  }, []);

  const ready = useCallback(() => { setLoaded(true); onLoad?.(); }, [onLoad]);
  const fail = useCallback((error: Error) => { setLoaded(true); setViewerError(true); onError?.(error); }, [onError]);
  function reportCapture(message: string, error = false) {
    setCaptureFeedback({ message, error });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setCaptureFeedback(null), 4500);
  }
  async function capture(action: "copy" | "download") {
    const canvas = canvasRef.current;
    if (!canvas || !loaded || viewerError) return;
    try {
      if (action === "copy" && (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")) {
        throw new Error("Image clipboard access is unavailable in this browser. Use Download PNG instead.");
      }
      const image = new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The viewer could not create a PNG.")), "image/png");
      });
      if (action === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
        reportCapture("Screenshot copied. Paste it into another app.");
      } else {
        const blob = await image;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${alt.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "model-view"}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        reportCapture("Screenshot downloaded as PNG.");
      }
    } catch (error) {
      reportCapture(error instanceof Error ? error.message : "Could not capture this screenshot.", true);
    }
  }
  function changeMode(next: ViewerMode) {
    if (next === mode) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setMode(next);
    onModeChange?.(next);
    if (next !== "firstPerson") setResetToken((n) => n + 1);
  }
  function changeLighting(next: ViewerLighting) {
    setLighting(next);
    onLightingChange?.(next);
  }
  function nudge(yaw: number, pitch: number) {
    setDirection((value) => ({ id: value.id + 1, yaw, pitch }));
  }

  return (
    <div
      className={cn("viewer model-lightbox", lighting === "night" && "is-night", className)}
      style={{ height }}
      data-loaded={loaded}
      data-viewer-mode={mode}
      data-viewer-key={viewerKey}
      aria-label={alt}
      role="group"
    >
      <ViewerErrorBoundary key={src ?? "cubes"} onError={fail}>
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [2.6, 1.9, 2.6], fov: 42, near: 0.01, far: 1000 }}
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: showUi, powerPreference: "high-performance" }}
          onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
          style={{ cursor: mode === "object" ? "grab" : mode === "firstPerson" ? "crosshair" : "move" }}
        >
          <color attach="background" args={[lighting === "day" ? "#e9ede8" : "#17232e"]} />
          <fog attach="fog" args={[lighting === "day" ? "#e9ede8" : "#17232e", 24, 90]} />
          <ambientLight intensity={lighting === "day" ? 1.8 : 0.9} />
          <hemisphereLight args={lighting === "day" ? ["#ffffff", "#a3ad97", 2.2] : ["#aac7f5", "#17232e", 1.3]} />
          <directionalLight
            position={[5, 9, 6]}
            intensity={lighting === "day" ? 3.2 : 1.5}
            color={lighting === "day" ? "#fff7e6" : "#bdd5ff"}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-left={-8}
            shadow-camera-right={8}
            shadow-camera-top={8}
            shadow-camera-bottom={-8}
          />
          <directionalLight position={[-4, 4, -6]} intensity={lighting === "day" ? 1.4 : 2.2} color={lighting === "day" ? "#dcebdc" : "#688db3"} />
          {ground && (
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
              <planeGeometry args={[200, 200]} />
              <meshStandardMaterial color={lighting === "day" ? "#e5ebe2" : "#202e37"} roughness={1} />
            </mesh>
          )}
          {grid && <gridHelper args={[20, 20, lighting === "day" ? "#92a98e" : "#5c8095", lighting === "day" ? "#c8d5c5" : "#344c59"]} position={[0, ground ? -0.01 : 0, 0]} />}
          <Suspense fallback={null}>
            <Bounds fit clip margin={1.45}>
              <FitOnRequest token={resetToken} />
              <SceneObject
                src={src}
                cubes={cubes}
                mode={mode}
                autoRotate={autoRotate}
                autoRotateSpeed={autoRotateSpeed}
                onReady={ready}
              />
            </Bounds>
          </Suspense>
          {mode === "firstPerson" ? (
            <>
              {pointerLockAvailable ? (
                <PointerLockControls makeDefault selector={`[data-viewer-key="${viewerKey}"] canvas`} onLock={() => setLocked(true)} onUnlock={() => setLocked(false)} />
              ) : <DragLook />}
              <FirstPersonMovement requirePointerLock={pointerLockAvailable} />
            </>
          ) : (
            <>
              <OrbitControls
                makeDefault
                enableDamping
                enablePan={mode === "orbit"}
                enableRotate={mode === "orbit"}
                minDistance={0.15}
                maxDistance={80}
                autoRotate={mode === "orbit" && autoRotate}
                autoRotateSpeed={autoRotateSpeed * 3}
              />
              <CameraNudge direction={direction} />
              {showOrientation && (
                <GizmoHelper alignment="top-right" margin={[62, 62]}>
                  <GizmoViewcube
                    color={lighting === "day" ? "#f7f8f1" : "#263846"}
                    textColor={lighting === "day" ? "#284e3c" : "#dce9e3"}
                    strokeColor={lighting === "day" ? "#92a98e" : "#7099ae"}
                    hoverColor={lighting === "day" ? "#dce7b7" : "#405f72"}
                  />
                </GizmoHelper>
              )}
            </>
          )}
        </Canvas>
      </ViewerErrorBoundary>
      {!loaded && <ViewerSkeleton overlay />}
      {showUi && (
        <>
          <div className="viewer-toolbar" role="toolbar" aria-label="3D viewer controls">
            <div className="viewer-toolbar-group" aria-label="Interaction mode">
              <ViewerButton icon={<Rotate3D />} label="Orbit camera" active={mode === "orbit"} onClick={() => changeMode("orbit")} />
              <ViewerButton icon={<MousePointer2 />} label="Rotate object" active={mode === "object"} onClick={() => changeMode("object")} />
              <ViewerButton icon={<Footprints />} label="First-person movement" active={mode === "firstPerson"} onClick={() => changeMode("firstPerson")} />
            </div>
            <div className="viewer-toolbar-group" aria-label="Scene options">
              <ViewerButton icon={lighting === "day" ? <Sun /> : <Moon />} label={lighting === "day" ? "Switch to night" : "Switch to day"} active={lighting === "night"} onClick={() => changeLighting(lighting === "day" ? "night" : "day")} />
              <ViewerButton icon={<View />} label="Show ground" active={ground} onClick={() => setGround(!ground)} />
              <ViewerButton icon={<Grid2X2 />} label="Show grid" active={grid} onClick={() => setGrid(!grid)} />
              <ViewerButton icon={<Box />} label="Show sample cubes" active={cubes} onClick={() => setCubes(!cubes)} />
              <ViewerButton icon={<Maximize2 />} label="Fit model in view" onClick={() => setResetToken((n) => n + 1)} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Screenshot options" title="Screenshot options" disabled={!loaded || viewerError}>
                    <Camera />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void capture("copy")}><Copy /> Copy image</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void capture("download")}><Download /> Download PNG</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {mode !== "firstPerson" && showOrientation && (
            <div className="viewer-direction" aria-label="View direction">
              <ViewerButton icon={<ArrowUp />} label="Tilt view up" onClick={() => nudge(0, -Math.PI / 8)} />
              <div>
                <ViewerButton icon={<ArrowLeft />} label="Rotate view left" onClick={() => nudge(-Math.PI / 4, 0)} />
                <ViewerButton icon={<ArrowRight />} label="Rotate view right" onClick={() => nudge(Math.PI / 4, 0)} />
              </div>
              <ViewerButton icon={<ArrowDown />} label="Tilt view down" onClick={() => nudge(0, Math.PI / 8)} />
            </div>
          )}
          <div className="viewer-help" role={captureFeedback?.error ? "alert" : "status"}>
            {captureFeedback?.message ?? (mode === "firstPerson"
              ? pointerLockAvailable
                ? locked ? "WASD / arrows to move · Esc to release" : "Click the scene to look around · WASD to move"
                : "Drag to look · WASD / arrows to move"
              : mode === "object" ? "Drag the model to rotate · Scroll to zoom" : "Drag to orbit · Scroll to zoom")}
          </div>
        </>
      )}
    </div>
  );
}

function ViewerButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <Button type="button" size="icon-sm" variant={active ? "secondary" : "ghost"} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>{icon}</Button>;
}

function SceneObject({ src, cubes, mode, autoRotate, autoRotateSpeed, onReady }: {
  src?: string; cubes: boolean; mode: ViewerMode; autoRotate: boolean; autoRotateSpeed: number; onReady: () => void;
}) {
  const group = useRef<{ rotation: { x: number; y: number } } | null>(null);
  const dragging = useRef(false);
  useEffect(() => { if (!src) onReady(); }, [src, onReady]);
  useFrame((_, delta) => {
    if (mode === "object" && autoRotate && !dragging.current && group.current)
      group.current.rotation.y += Math.min(delta, 0.05) * autoRotateSpeed;
  });
  function startDrag(event: ThreeEvent<PointerEvent>) {
    if (mode !== "object") return;
    event.stopPropagation();
    dragging.current = true;
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }
  function drag(event: ThreeEvent<PointerEvent>) {
    if (!dragging.current || !group.current) return;
    event.stopPropagation();
    group.current.rotation.y += event.nativeEvent.movementX * 0.008;
    group.current.rotation.x = Math.max(-1.1, Math.min(1.1, group.current.rotation.x + event.nativeEvent.movementY * 0.008));
  }
  function stopDrag(event: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return;
    dragging.current = false;
    (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
  }
  return <group ref={node => { group.current = node; }} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
    {src && <LoadedModel src={src} onReady={onReady} />}
    {cubes && <>
      <mesh castShadow receiveShadow position={[-1.4, 0.42, 0]}><boxGeometry args={[0.8, 0.8, 0.8]} /><meshStandardMaterial color="#9bae85" roughness={0.7} /></mesh>
      <mesh castShadow receiveShadow position={[1.3, 0.3, -0.5]} rotation={[0, 0.3, 0]}><boxGeometry args={[0.6, 0.6, 0.6]} /><meshStandardMaterial color="#c3a383" roughness={0.7} /></mesh>
      <mesh castShadow receiveShadow position={[0, 0.22, 1.1]} rotation={[0, -0.3, 0]}><boxGeometry args={[0.44, 0.44, 0.44]} /><meshStandardMaterial color="#7f9f9d" roughness={0.7} /></mesh>
    </>}
  </group>;
}

function LoadedModel({ src, onReady }: { src: string; onReady: () => void }) {
  const gltf = useGLTF(src);
  useEffect(() => onReady(), [gltf, onReady]);
  return <Clone object={gltf.scene} castShadow receiveShadow />;
}

function FitOnRequest({ token }: { token: number }) {
  const bounds = useBounds();
  useEffect(() => { if (token > 0) bounds.refresh().fit(); }, [token, bounds]);
  return null;
}

function CameraNudge({ direction }: { direction: Direction }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!direction.id || !controls || !("target" in controls)) return;
    const target = controls.target as { x: number; y: number; z: number };
    const x = camera.position.x - target.x;
    const y = camera.position.y - target.y;
    const z = camera.position.z - target.z;
    const radius = Math.max(0.01, Math.hypot(x, y, z));
    const yaw = Math.atan2(x, z) + direction.yaw;
    const polar = Math.max(0.05, Math.min(Math.PI - 0.05, Math.acos(y / radius) + direction.pitch));
    camera.position.set(target.x + radius * Math.sin(polar) * Math.sin(yaw), target.y + radius * Math.cos(polar), target.z + radius * Math.sin(polar) * Math.cos(yaw));
    camera.lookAt(target.x, target.y, target.z);
    if ("update" in controls && typeof controls.update === "function") controls.update();
  }, [camera, controls, direction]);
  return null;
}

function DragLook() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    let dragging = false;
    camera.rotation.reorder("YXZ");
    canvas.tabIndex = 0;
    function down(event: PointerEvent) {
      if (event.button !== 0) return;
      dragging = true;
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
    }
    function move(event: PointerEvent) {
      if (!dragging) return;
      camera.rotation.y -= event.movementX * 0.002;
      camera.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camera.rotation.x - event.movementY * 0.002));
    }
    function up(event: PointerEvent) {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [camera, gl]);
  return null;
}

function FirstPersonMovement({ requirePointerLock }: { requirePointerLock: boolean }) {
  const { camera, gl } = useThree();
  const pressed = useRef(new Set<string>());
  const walkingHeight = useRef(camera.position.y);
  useEffect(() => {
    walkingHeight.current = camera.position.y;
    function down(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (!requirePointerLock && event.target !== gl.domElement) return;
      pressed.current.add(event.code);
      if ((document.pointerLockElement || !requirePointerLock) && event.code.startsWith("Arrow")) event.preventDefault();
    }
    function up(event: KeyboardEvent) { pressed.current.delete(event.code); }
    function blur() { pressed.current.clear(); }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [camera, gl, requirePointerLock]);
  useFrame((_, delta) => {
    if (requirePointerLock ? !document.pointerLockElement : document.activeElement !== gl.domElement) return;
    const speed = Math.min(delta, 0.05) * 2.2;
    const keys = pressed.current;
    const forward = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown"));
    const sideways = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    if (!forward && !sideways) return;
    const scale = forward && sideways ? Math.SQRT1_2 : 1;
    camera.translateZ(-forward * speed * scale);
    camera.translateX(sideways * speed * scale);
    camera.position.y = walkingHeight.current;
  });
  return null;
}
