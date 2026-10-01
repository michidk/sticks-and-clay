import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Bounds,
  Clone,
  GizmoHelper,
  OrbitControls,
  PointerLockControls,
  useBounds,
  useGLTF,
} from "@react-three/drei";
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  Grid2X2,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Moon,
  RotateCcw,
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
  type CSSProperties,
  type ReactNode,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ViewerSkeleton } from "@/components/loading";
import { cn } from "@/lib/utils";
import { EditorViewHelper } from "./editor-view-helper";
import { faceVector, type ViewFace } from "./view-cube";

export type ViewerMode = "orbit" | "split" | "firstPerson";
export type ViewerLighting = "day" | "night";
export type ViewerShading = "realistic" | "solid" | "normals" | "wireframe";

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
  shading?: ViewerShading;
  onShadingChange?: (shading: ViewerShading) => void;
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

const splitViews = [
  { label: "Right", position: [3, 0, 0] },
  { label: "Back", position: [0, 0, -3] },
  { label: "Left", position: [-3, 0, 0] },
] as const;

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
  shading: requestedShading,
  onShadingChange,
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
  const [shading, setShading] = useState<ViewerShading>(requestedShading ?? "realistic");
  const [ground, setGround] = useState(requestedGround);
  const [grid, setGrid] = useState(requestedGrid);
  const [cubes, setCubes] = useState(requestedCubes ?? !src);
  const [loaded, setLoaded] = useState(!src);
  const [viewerError, setViewerError] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const splitCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [splitReady, setSplitReady] = useState<Set<number>>(() => new Set());
  const previousSrc = useRef(src);
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locked, setLocked] = useState(false);
  const [pointerLockAvailable, setPointerLockAvailable] = useState(true);
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    if (requestedMode && requestedMode !== mode) {
      if (requestedMode === "split") setSplitReady(new Set());
      setMode(requestedMode);
    }
  }, [requestedMode]);
  useEffect(() => { if (requestedLighting) setLighting(requestedLighting); }, [requestedLighting]);
  useEffect(() => { if (requestedShading) setShading(requestedShading); }, [requestedShading]);
  useEffect(() => setGround(requestedGround), [requestedGround]);
  useEffect(() => setGrid(requestedGrid), [requestedGrid]);
  useEffect(() => setCubes(requestedCubes ?? !src), [requestedCubes, src]);
  useEffect(() => {
    setLoaded(!src); setViewerError(false); setCaptureFeedback(null);
    if (previousSrc.current !== src) setSplitReady(new Set());
    previousSrc.current = src;
  }, [src]);
  useEffect(() => setLocked(false), [mode]);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);
  useEffect(() => {
    const update = () => {
      const active = document.fullscreenElement === viewerRef.current;
      setIsFullscreen(active);
      if (active) setIsExpanded(false);
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);
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
      let source = canvas;
      if (mode === "split") {
        const [right, back, left] = splitCanvasRefs.current;
        if (!right || !back || !left || splitReady.size !== splitViews.length) throw new Error("The four views are still loading.");
        const combined = document.createElement("canvas");
        const leftWidth = Math.max(canvas.width, back.width);
        const rightWidth = Math.max(right.width, left.width);
        const topHeight = Math.max(canvas.height, right.height);
        combined.width = leftWidth + rightWidth;
        combined.height = topHeight + Math.max(back.height, left.height);
        const context = combined.getContext("2d");
        if (!context) throw new Error("The viewer could not combine the four views.");
        context.drawImage(canvas, 0, 0);
        context.drawImage(right, leftWidth, 0);
        context.drawImage(back, 0, topHeight);
        context.drawImage(left, leftWidth, topHeight);
        source = combined;
      }
      const image = new Promise<Blob>((resolve, reject) => {
        source.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The viewer could not create a PNG.")), "image/png");
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
    setLoaded(!src);
    canvasRef.current = null;
    if (next === "split") { setSplitReady(new Set()); splitCanvasRefs.current = []; }
    setMode(next);
    onModeChange?.(next);
    if (mode === "firstPerson" && next !== "firstPerson") setResetToken((n) => n + 1);
  }
  function changeLighting(next: ViewerLighting) {
    setLighting(next);
    onLightingChange?.(next);
  }
  function changeShading(next: ViewerShading) {
    setShading(next);
    onShadingChange?.(next);
  }
  async function toggleFullscreen() {
    if (isExpanded) { setIsExpanded(false); return; }
    try {
      if (document.fullscreenElement === viewerRef.current) { await document.exitFullscreen(); return; }
      if (!document.fullscreenEnabled || !viewerRef.current) throw new Error("Fullscreen API unavailable");
      const request = viewerRef.current.requestFullscreen();
      await Promise.race([request, new Promise<void>((resolve) => setTimeout(resolve, 700))]);
      if (document.fullscreenElement !== viewerRef.current) setIsExpanded(true);
    } catch {
      setIsExpanded(true);
    }
  }

  return (
    <div
      ref={viewerRef}
      className={cn("viewer model-lightbox", showUi && "has-ui", lighting === "night" && "is-night", isExpanded && "is-expanded", className)}
      style={{ height }}
      data-loaded={loaded}
      data-viewer-mode={mode}
      data-viewer-key={viewerKey}
      aria-label={alt}
      role="group"
    >
      <ViewerErrorBoundary key={src ?? "cubes"} onError={fail}>
        <div className="viewer-scenes">
          <div className="viewer-scene viewer-scene-primary">
        <Canvas
          key={mode === "split" ? "split-front" : "single-view"}
          shadows
          dpr={[1, 2]}
          camera={{ position: mode === "split" ? [0, 0, 3] : [2.6, 1.9, 2.6], fov: 42, near: 0.01, far: 1000 }}
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: showUi, powerPreference: "high-performance" }}
          onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
          style={{ cursor: mode === "firstPerson" ? "crosshair" : "move" }}
        >
          <ViewerScene lighting={lighting} shading={shading} ground={ground} grid={grid} src={src} cubes={cubes} resetToken={resetToken} resetFace={mode === "split" ? "front" : undefined} compact={mode === "split"} onReady={ready} />
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
                enablePan
                enableRotate
                autoRotate={mode === "orbit" && autoRotate}
                autoRotateSpeed={autoRotateSpeed * 3}
              />
              {showOrientation && mode !== "split" && (
                <GizmoHelper alignment="top-right" margin={[62, 62]}>
                  <EditorViewHelper />
                </GizmoHelper>
              )}
            </>
          )}
        </Canvas>
            {showUi && mode === "split" && <span className="viewer-pane-label">Front</span>}
          </div>
          {mode === "split" && splitViews.map((view, index) => (
            <div className="viewer-scene viewer-scene-secondary" key={view.label}>
              <Canvas
                shadows
                dpr={[1, 2]}
                camera={{ position: [...view.position], fov: 42, near: 0.01, far: 1000 }}
                gl={{ antialias: true, alpha: false, preserveDrawingBuffer: showUi, powerPreference: "high-performance" }}
                onCreated={({ gl }) => { splitCanvasRefs.current[index] = gl.domElement; }}
              >
                <ViewerScene lighting={lighting} shading={shading} ground={ground} grid={grid} src={src} cubes={cubes} resetToken={resetToken} resetFace={view.label.toLowerCase() as ViewFace} compact onReady={() => setSplitReady((ready) => ready.has(index) ? ready : new Set(ready).add(index))} />
                <OrbitControls makeDefault enableDamping enablePan enableRotate />
              </Canvas>
              {showUi && <span className="viewer-pane-label">{view.label}</span>}
            </div>
          ))}
        </div>
      </ViewerErrorBoundary>
      {!loaded && <ViewerSkeleton overlay />}
      {showUi && (
        <>
          <div className="viewer-toolbar" role="toolbar" aria-label="3D viewer controls">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="viewer-shading-trigger" aria-label={`Shading: ${shading}`}>
                  {shading}<ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="viewer-shading-menu">
                {(["realistic", "solid", "normals", "wireframe"] as const).map((option) => (
                  <DropdownMenuItem key={option} onSelect={() => changeShading(option)}>
                    <Check className={option === shading ? "is-visible" : "is-hidden"} />
                    <span>{option}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="viewer-toolbar-group" aria-label="Interaction mode">
              <ViewerButton icon={<Rotate3D />} label="Orbit camera" active={mode === "orbit"} onClick={() => changeMode("orbit")} />
              <ViewerButton icon={<LayoutGrid />} label="Four-view split" active={mode === "split"} onClick={() => changeMode("split")} />
              <ViewerButton icon={<Footprints />} label="Fly camera" active={mode === "firstPerson"} onClick={() => changeMode("firstPerson")} />
            </div>
            <div className="viewer-toolbar-group" aria-label="Scene options">
              <ViewerButton icon={lighting === "day" ? <Sun /> : <Moon />} label={lighting === "day" ? "Switch to night" : "Switch to day"} active={lighting === "night"} onClick={() => changeLighting(lighting === "day" ? "night" : "day")} />
              <ViewerButton icon={<View />} label="Show ground" active={ground} onClick={() => setGround(!ground)} />
              <ViewerButton icon={<Grid2X2 />} label="Show grid" active={grid} onClick={() => setGrid(!grid)} />
              <ViewerButton icon={<RotateCcw />} label="Reset view" onClick={() => setResetToken((n) => n + 1)} />
              <DropdownMenu open={captureMenuOpen} onOpenChange={setCaptureMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="icon-sm" variant={captureMenuOpen ? "secondary" : "ghost"} className={cn("viewer-capture-trigger", captureMenuOpen && "is-open")} aria-label="Screenshot options" title="Screenshot options" disabled={!loaded || viewerError || (mode === "split" && splitReady.size !== splitViews.length)}>
                    <Camera />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="viewer-capture-menu">
                  <div className="viewer-capture-title">Capture view <span>PNG</span></div>
                  <DropdownMenuItem onSelect={() => void capture("copy")}><Copy /> Copy to clipboard</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void capture("download")}><Download /> Download image</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="viewer-help" role={captureFeedback?.error ? "alert" : "status"}>
            {captureFeedback?.message ?? (mode === "firstPerson"
              ? pointerLockAvailable
                ? locked ? "WASD to fly · Space up · Shift down · Esc to release" : "Click scene to look · WASD to fly · Space / Shift vertically"
                : "Drag to look · WASD to fly · Space / Shift vertically"
              : mode === "split" ? "Front · Right · Back · Left — drag any view to orbit" : "Drag to orbit · Scroll to zoom")}
          </div>
          <Button type="button" size="icon-sm" variant="ghost" className="viewer-fullscreen" aria-label={isFullscreen || isExpanded ? "Exit fullscreen" : "Enter fullscreen"} title={isFullscreen || isExpanded ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>
            {isFullscreen || isExpanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </>
      )}
    </div>
  );
}

function ViewerButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <Button type="button" size="icon-sm" variant={active ? "secondary" : "ghost"} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>{icon}</Button>;
}

function ViewerScene({ lighting, shading, ground, grid, src, cubes, resetToken, resetFace, compact = false, onReady }: {
  lighting: ViewerLighting; shading: ViewerShading; ground: boolean; grid: boolean; src?: string; cubes: boolean; resetToken: number; resetFace?: ViewFace; compact?: boolean; onReady: () => void;
}) {
  return <>
    <color attach="background" args={[lighting === "day" ? "#e9ede8" : "#17232e"]} />
    <fog attach="fog" args={[lighting === "day" ? "#e9ede8" : "#17232e", 24, 90]} />
    <ambientLight intensity={lighting === "day" ? 0.8 : 0.9} />
    <hemisphereLight args={lighting === "day" ? ["#ffffff", "#a3ad97", 1.2] : ["#aac7f5", "#17232e", 1.3]} />
    <directionalLight position={[5, 9, 6]} intensity={lighting === "day" ? 2.1 : 1.5} color={lighting === "day" ? "#fff7e6" : "#bdd5ff"} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <directionalLight position={[-4, 4, -6]} intensity={lighting === "day" ? 0.7 : 2.2} color={lighting === "day" ? "#dcebdc" : "#688db3"} />
    {ground && <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}><planeGeometry args={[200, 200]} /><meshStandardMaterial color={lighting === "day" ? "#e5ebe2" : "#202e37"} roughness={1} /></mesh>}
    {grid && <gridHelper args={[20, 20, lighting === "day" ? "#92a98e" : "#5c8095", lighting === "day" ? "#c8d5c5" : "#344c59"]} position={[0, ground ? -0.01 : 0, 0]} />}
    <Suspense fallback={null}>
      <Bounds fit clip margin={compact ? 1.1 : 1.45}>
        <FitOnRequest token={resetToken} face={resetFace} />
        <SceneObject src={src} cubes={cubes} shading={shading} onReady={onReady} />
        <CameraLimits src={src} cubes={cubes} />
      </Bounds>
    </Suspense>
  </>;
}

function SceneObject({ src, cubes, shading, onReady }: { src?: string; cubes: boolean; shading: ViewerShading; onReady: () => void }) {
  useEffect(() => { if (!src) onReady(); }, [src, onReady]);
  return <group>
    {src && <LoadedModel src={src} shading={shading} onReady={onReady} />}
    {cubes && <>
      <mesh castShadow receiveShadow position={[-1.4, 0.42, 0]}><boxGeometry args={[0.8, 0.8, 0.8]} /><ViewerMaterial shading={shading} color="#9bae85" /></mesh>
      <mesh castShadow receiveShadow position={[1.3, 0.3, -0.5]} rotation={[0, 0.3, 0]}><boxGeometry args={[0.6, 0.6, 0.6]} /><ViewerMaterial shading={shading} color="#c3a383" /></mesh>
      <mesh castShadow receiveShadow position={[0, 0.22, 1.1]} rotation={[0, -0.3, 0]}><boxGeometry args={[0.44, 0.44, 0.44]} /><ViewerMaterial shading={shading} color="#7f9f9d" /></mesh>
    </>}
  </group>;
}

function CameraLimits({ src, cubes }: { src?: string; cubes: boolean }) {
  const bounds = useBounds();
  const { controls, size } = useThree();
  useEffect(() => {
    if (!controls || !("minDistance" in controls) || !("maxDistance" in controls)) return;
    bounds.refresh().fit();
    const { distance } = bounds.getSize();
    const orbit = controls as typeof controls & { minDistance: number; maxDistance: number; update: () => void };
    orbit.minDistance = Math.max(0.1, distance * 0.35);
    orbit.maxDistance = Math.max(orbit.minDistance * 2, distance * 2.5);
    orbit.update();
  }, [bounds, controls, src, cubes, size.width, size.height]);
  return null;
}

function LoadedModel({ src, shading, onReady }: { src: string; shading: ViewerShading; onReady: () => void }) {
  const gltf = useGLTF(src);
  useEffect(() => onReady(), [gltf, onReady]);
  return <Clone object={gltf.scene} castShadow receiveShadow inject={shading === "realistic" ? undefined : (object) => "material" in object ? <ViewerMaterial shading={shading} /> : null} />;
}

function ViewerMaterial({ shading, color = "#a7aaa5" }: { shading: ViewerShading; color?: string }) {
  if (shading === "normals") return <meshNormalMaterial />;
  if (shading === "wireframe") return <meshBasicMaterial color="#34483f" wireframe />;
  return <meshStandardMaterial color={color} roughness={shading === "solid" ? 0.82 : 0.7} metalness={0} />;
}

function FitOnRequest({ token, face }: { token: number; face?: ViewFace }) {
  const bounds = useBounds();
  useEffect(() => {
    if (!token && !face) return;
    // Wait until the scene and orbit controls have settled before measuring.
    const frame = requestAnimationFrame(() => {
      bounds.refresh();
      const { center, distance } = bounds.getSize();
      const vector = face ? faceVector(face, face) : [2.6, 1.9, 2.6];
      const scale = distance / Math.hypot(...vector);
      bounds.moveTo([
        center.x + vector[0] * scale,
        center.y + vector[1] * scale,
        center.z + vector[2] * scale,
      ]).lookAt({ target: [center.x, center.y, center.z] });
    });
    return () => cancelAnimationFrame(frame);
  }, [token, bounds, face]);
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
  useEffect(() => {
    function down(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (!requirePointerLock && event.target !== gl.domElement) return;
      pressed.current.add(event.code);
      if ((document.pointerLockElement || !requirePointerLock) && (event.code.startsWith("Arrow") || event.code === "Space")) event.preventDefault();
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
    const vertical = Number(keys.has("Space") || keys.has("KeyE")) - Number(keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyQ"));
    if (!forward && !sideways && !vertical) return;
    const scale = 1 / Math.hypot(forward, sideways, vertical);
    camera.translateZ(-forward * speed * scale);
    camera.translateX(sideways * speed * scale);
    camera.position.y += vertical * speed * scale;
  });
  return null;
}
