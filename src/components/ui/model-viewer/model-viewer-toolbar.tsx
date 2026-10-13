"use client";

import {
  Box,
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
  SlidersHorizontal,
  Paintbrush,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
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
  return (
    <ModelViewerToolbar {...props}>
      <ModelViewerToolbarGroup aria-label="Model review">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="viewer-menu-trigger"
                aria-label={`Shading: ${shadingLabels[shading]}`}
              >
                <Paintbrush />
                <span className="viewer-control-label">{shadingLabels[shading]}</span>
                <ChevronDown className="viewer-control-label" />
              </Button>
            }
          />
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="viewer-options-menu min-w-44"
          >
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
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant={mode === "orbit" ? "ghost" : "secondary"}
                size="sm"
                className="viewer-menu-trigger"
                aria-label="Camera options"
              >
                {mode === "split" ? (
                  <LayoutGrid />
                ) : mode === "firstPerson" ? (
                  <Footprints />
                ) : (
                  <Rotate3D />
                )}
                <span className="viewer-control-label">
                  {mode === "split" ? "Four views" : mode === "firstPerson" ? "Fly" : "Orbit"}
                </span>
                <ChevronDown className="viewer-control-label" />
              </Button>
            }
          />
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="viewer-options-menu min-w-52"
          >
            <DropdownMenuRadioGroup
              aria-label="Camera mode"
              value={mode}
              onValueChange={onModeChange}
            >
              <DropdownMenuRadioItem value="orbit" closeOnClick>
                <Rotate3D /> Orbit camera
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="split" closeOnClick>
                <LayoutGrid /> Four-view split
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="firstPerson" closeOnClick>
                <Footprints /> Fly camera
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <div role="separator" className="my-1 border-t" />
            <DropdownMenuCheckboxItem
              checked={projection === "orthographic"}
              onCheckedChange={(checked) =>
                onProjectionChange(checked ? "orthographic" : "perspective")
              }
            >
              <ScanSearch /> Orthographic view
            </DropdownMenuCheckboxItem>
            {onAutoRotateChange && (
              <DropdownMenuCheckboxItem
                checked={autoRotate}
                disabled={mode !== "orbit"}
                onCheckedChange={onAutoRotateChange}
              >
                <RotateCw /> Rotate automatically
              </DropdownMenuCheckboxItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <ModelViewerToolbarButton
          icon={<ListTree />}
          label="Inspect model"
          active={inspectorOpen}
          onClick={() => onInspectorChange(!inspectorOpen)}
        />
        <ModelViewerToolbarButton icon={<RotateCcw />} label="Reset view" onClick={onReset} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Viewer options">
                <SlidersHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end" sideOffset={6} className="viewer-options-menu min-w-56">
            <div className="px-1.5 py-1.5 text-xs font-medium text-muted-foreground">Lighting</div>
            <DropdownMenuRadioGroup
              aria-label="Lighting"
              value={lighting}
              onValueChange={onLightingChange}
            >
              <DropdownMenuRadioItem value="day" closeOnClick>
                <CloudSun /> Day studio
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="night" closeOnClick>
                <CloudSun /> Night studio
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="outside" closeOnClick>
                <CloudSun /> Outside sky
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <div role="separator" className="my-1 border-t" />
            <DropdownMenuCheckboxItem checked={grid} onCheckedChange={onGridChange}>
              <Grid2X2 /> Show grid
            </DropdownMenuCheckboxItem>
            {onFloorChange && (
              <DropdownMenuCheckboxItem checked={floor} onCheckedChange={onFloorChange}>
                <Layers3 /> Show floor
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuCheckboxItem
              checked={viewCube !== false}
              onCheckedChange={(checked) => onViewCubeChange(checked ? "asset-studio" : false)}
            >
              <Box /> Orientation helper
            </DropdownMenuCheckboxItem>
            <div role="separator" className="my-1 border-t" />
            <div className="px-1.5 py-1.5 text-xs font-medium text-muted-foreground">
              Screenshot · PNG
            </div>
            <DropdownMenuItem disabled={captureDisabled} onClick={() => void onCapture("download")}>
              <Download /> Download image
            </DropdownMenuItem>
            <DropdownMenuItem disabled={captureDisabled} onClick={() => void onCapture("copy")}>
              <Copy /> Copy to clipboard
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
