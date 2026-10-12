"use client";

import {
  Box,
  Camera,
  ChevronDown,
  CloudSun,
  Copy,
  Download,
  Footprints,
  Gauge,
  Grid2X2,
  Layers3,
  LayoutGrid,
  ListTree,
  Pause,
  Play,
  Rotate3D,
  RotateCcw,
  RotateCw,
  ScanSearch,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ViewerLighting, ViewerMode, ViewerShading, ViewerViewCube } from "./model-viewer";
import { useOptionalViewerRuntime } from "./model-viewer-context";
import { DropdownMenuContent } from "./viewer-popups";
import { ViewerControlButton as Button } from "./viewer-ui";
import "./model-viewer.css";

const shadingLabels: Record<ViewerShading, string> = {
  realistic: "Realistic",
  solid: "Solid",
  normals: "Normals",
  wireframe: "Wireframe",
};

export function ModelViewerToolbar({
  className,
  onKeyDown,
  ref,
  placement = "top",
  ...props
}: ComponentProps<"div"> & { placement?: "top" | "animation" | "static" }) {
  const elementRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => elementRef.current!, []);
  const runtime = useOptionalViewerRuntime();
  const reportToolbar = runtime?.reportToolbar;
  const viewerRef = runtime?.viewerRef;
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || !reportToolbar || !viewerRef || placement !== "top") return;
    const measure = () => {
      const root = viewerRef.current;
      if (!root) return;
      const rect = element.getBoundingClientRect();
      reportToolbar(element, Math.ceil(rect.bottom - root.getBoundingClientRect().top + 12));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (viewerRef.current) observer.observe(viewerRef.current);
    measure();
    return () => {
      observer.disconnect();
      reportToolbar(element, null);
    };
  }, [reportToolbar, viewerRef, placement, className, props.style]);
  return (
    <div
      ref={elementRef}
      data-slot="model-viewer-toolbar"
      role="toolbar"
      aria-label="3D viewer controls"
      className={cn(
        "viewer-toolbar",
        placement === "top" && "viewer-toolbar-top",
        placement === "animation" && "viewer-animation-controls",
        className,
      )}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        // Ignore events from portaled menus and editable controls.
        const target = event.target as HTMLElement;
        if (!event.currentTarget.contains(target) || !target.closest("button")) return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        const current = buttons.indexOf(target.closest("button")!);
        if (current < 0 || buttons.length === 0) return;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next].focus();
      }}
    />
  );
}

export function ModelViewerToolbarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: This groups toolbar commands, not form inputs.
    <div
      data-slot="model-viewer-toolbar-group"
      role="group"
      className={cn(
        "viewer-toolbar-group rounded-lg border bg-popover p-1 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

export type ModelViewerToolbarButtonProps = ComponentProps<typeof Button> & {
  label: string;
  active?: boolean;
  icon?: ReactNode;
};

export function ModelViewerToolbarButton({
  label,
  active,
  icon,
  children,
  ...props
}: ModelViewerToolbarButtonProps) {
  return (
    <Button
      data-slot="model-viewer-toolbar-button"
      data-state={active === undefined ? undefined : active ? "on" : "off"}
      size="icon-sm"
      variant={active ? "secondary" : "ghost"}
      aria-label={label}
      aria-pressed={active}
      tooltip={label}
      {...props}
    >
      {children ?? icon}
    </Button>
  );
}

export type ModelViewerControlsProps = Omit<ComponentProps<"div">, "onReset"> & {
  mode: ViewerMode;
  onModeChange: (mode: ViewerMode) => void;
  shading: ViewerShading;
  onShadingChange: (shading: ViewerShading) => void;
  lighting: ViewerLighting;
  onLightingChange: (lighting: ViewerLighting) => void;
  grid: boolean;
  onGridChange: (visible: boolean) => void;
  floor?: boolean;
  onFloorChange?: (visible: boolean) => void;
  autoRotate?: boolean;
  onAutoRotateChange?: (rotating: boolean) => void;
  projection: "perspective" | "orthographic";
  onProjectionChange: (projection: "perspective" | "orthographic") => void;
  viewCube: ViewerViewCube | false;
  onViewCubeChange: (viewCube: ViewerViewCube | false) => void;
  inspectorOpen: boolean;
  onInspectorChange: (open: boolean) => void;
  onReset: () => void;
  captureDisabled?: boolean;
  onCapture: (action: "copy" | "download") => void;
};

/** The default controls, also usable outside ModelViewer with controlled state. */
export function ModelViewerControls({
  mode,
  onModeChange,
  shading,
  onShadingChange,
  lighting,
  onLightingChange,
  grid,
  onGridChange,
  floor = false,
  onFloorChange,
  autoRotate = false,
  onAutoRotateChange,
  projection,
  onProjectionChange,
  viewCube,
  onViewCubeChange,
  inspectorOpen,
  onInspectorChange,
  onReset,
  captureDisabled,
  onCapture,
  ...props
}: ModelViewerControlsProps) {
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  return (
    <ModelViewerToolbar {...props}>
      <ModelViewerToolbarGroup aria-label="Shading">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="viewer-shading-trigger"
                aria-label={`Shading: ${shading}`}
              >
                {shadingLabels[shading]}
                <ChevronDown />
              </Button>
            }
          />
          <DropdownMenuContent align="start" sideOffset={6} className="min-w-40">
            <DropdownMenuRadioGroup
              aria-label="Shading"
              value={shading}
              onValueChange={onShadingChange}
            >
              {(["realistic", "solid", "normals", "wireframe"] as const).map((option) => (
                <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                  {shadingLabels[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ModelViewerToolbarGroup>
      <ModelViewerToolbarGroup aria-label="Interaction mode">
        <ModelViewerToolbarButton
          icon={<Rotate3D />}
          label="Orbit camera"
          active={mode === "orbit"}
          onClick={() => onModeChange("orbit")}
        />
        <ModelViewerToolbarButton
          icon={<LayoutGrid />}
          label="Four-view split"
          active={mode === "split"}
          onClick={() => onModeChange("split")}
        />
        <ModelViewerToolbarButton
          icon={<Footprints />}
          label="Fly camera"
          active={mode === "firstPerson"}
          onClick={() => onModeChange("firstPerson")}
        />
        {onAutoRotateChange && (
          <ModelViewerToolbarButton
            icon={<RotateCw />}
            label="Rotate automatically"
            active={autoRotate}
            disabled={mode !== "orbit"}
            onClick={() => onAutoRotateChange(!autoRotate)}
          />
        )}
      </ModelViewerToolbarGroup>
      <ModelViewerToolbarGroup aria-label="Scene options">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Lighting: ${lighting}`}
                tooltip="Lighting"
              >
                <CloudSun />
              </Button>
            }
          />
          <DropdownMenuContent className="min-w-40">
            <DropdownMenuRadioGroup
              aria-label="Lighting"
              value={lighting}
              onValueChange={onLightingChange}
            >
              {(["day", "night", "outside"] as const).map((value) => (
                <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                  {value === "outside"
                    ? "Outside sky"
                    : value === "day"
                      ? "Day studio"
                      : "Night studio"}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ModelViewerToolbarButton
          icon={<Grid2X2 />}
          label="Show grid"
          active={grid}
          onClick={() => onGridChange(!grid)}
        />
        {onFloorChange && (
          <ModelViewerToolbarButton
            icon={<Layers3 />}
            label="Show floor"
            active={floor}
            onClick={() => onFloorChange(!floor)}
          />
        )}
        <ModelViewerToolbarButton
          icon={<ScanSearch />}
          label="Orthographic view"
          active={projection === "orthographic"}
          onClick={() =>
            onProjectionChange(projection === "orthographic" ? "perspective" : "orthographic")
          }
        />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button type="button" size="icon-sm" variant="ghost" aria-label="View cube options">
                <Box />
              </Button>
            }
          />
          <DropdownMenuContent className="min-w-40">
            <DropdownMenuRadioGroup
              aria-label="View cube"
              value={viewCube}
              onValueChange={onViewCubeChange}
            >
              {([false, "drei", "asset-studio"] as const).map((value) => (
                <DropdownMenuRadioItem key={String(value)} value={value} closeOnClick>
                  {value === false ? "Off" : value === "drei" ? "Drei cube" : "Asset Studio"}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ModelViewerToolbarButton
          icon={<ListTree />}
          label="Inspect model"
          active={inspectorOpen}
          onClick={() => onInspectorChange(!inspectorOpen)}
        />
        <ModelViewerToolbarButton icon={<RotateCcw />} label="Reset view" onClick={onReset} />
        <DropdownMenu modal={false} open={captureMenuOpen} onOpenChange={setCaptureMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant={captureMenuOpen ? "secondary" : "ghost"}
                aria-label="Screenshot options"
                title="Screenshot options"
                disabled={captureDisabled}
              >
                <Camera />
              </Button>
            }
          />
          <DropdownMenuContent align="end" sideOffset={8} className="min-w-52">
            <div className="flex items-center justify-between border-b px-2 py-1.5 text-xs font-medium">
              Capture view <span className="text-muted-foreground">PNG</span>
            </div>
            <DropdownMenuItem onClick={() => void onCapture("copy")}>
              <Copy /> Copy to clipboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void onCapture("download")}>
              <Download /> Download image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ModelViewerToolbarGroup>
    </ModelViewerToolbar>
  );
}

const animationSpeeds = [0.5, 1, 1.5, 2];

export type ModelViewerAnimationControlsProps = ComponentProps<"div"> & {
  clips: string[];
  animation: string | null;
  onAnimationChange: (clip: string) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onRestart: () => void;
};

export function ModelViewerAnimationControls({
  clips,
  animation,
  onAnimationChange,
  playing,
  onPlayingChange,
  speed,
  onSpeedChange,
  onRestart,
  className,
  ...props
}: ModelViewerAnimationControlsProps) {
  return (
    <ModelViewerToolbar
      placement="animation"
      data-slot="model-viewer-animation-controls"
      aria-label="Animation controls"
      className={cn("rounded-lg border bg-popover p-1 text-popover-foreground", className)}
      {...props}
    >
      <ModelViewerToolbarButton
        icon={playing ? <Pause /> : <Play />}
        label={playing ? "Pause animation" : "Play animation"}
        active={playing}
        onClick={() => onPlayingChange(!playing)}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button type="button" size="sm" variant="ghost" className="viewer-animation-name">
              <span className="truncate">{animation ?? "No animation"}</span>
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-52">
          <DropdownMenuRadioGroup
            aria-label="Animation clip"
            value={animation}
            onValueChange={onAnimationChange}
          >
            {clips.map((name) => (
              <DropdownMenuRadioItem key={name} value={name} closeOnClick>
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ModelViewerToolbarButton
        icon={<RotateCcw />}
        label="Restart animation"
        onClick={onRestart}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Animation speed ${speed}×`}
        title={`Animation speed ${speed}×`}
        onClick={() =>
          onSpeedChange(
            animationSpeeds[(animationSpeeds.indexOf(speed) + 1) % animationSpeeds.length] ?? 1,
          )
        }
      >
        <Gauge />
        <span className="tabular-nums">{speed}×</span>
      </Button>
    </ModelViewerToolbar>
  );
}
