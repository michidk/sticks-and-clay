// Safe for the lazy entry: no Three/R3F runtime imports.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ModelViewerSkeletonProps = ComponentProps<"div"> & {
  /** Placeholder blocks for the top toolbar. */
  showToolbar?: boolean;
  /** Placeholder block for the view cube. */
  showViewCube?: boolean;
  /** Screen-reader text, announced by the viewer loader's status region. Pass an empty string to omit it. */
  label?: string;
};

/**
 * Viewer-shaped placeholder. Fills its nearest positioned ancestor, so it works
 * as `loadingFallback` or inside any `.model-viewer` frame.
 */
export function ModelViewerSkeleton({
  showToolbar = true,
  showViewCube = true,
  label = "Loading 3D viewer…",
  className,
  ...props
}: ModelViewerSkeletonProps) {
  return (
    <div data-slot="model-viewer-skeleton" className={cn("viewer-skeleton", className)} {...props}>
      {showToolbar && (
        <div className="viewer-skeleton-toolbar">
          <span className="viewer-skeleton-block" style={{ width: 104 }} />
          <span className="viewer-skeleton-block" style={{ width: 72 }} />
          <span className="viewer-skeleton-block" style={{ width: 36 }} />
        </div>
      )}
      {showViewCube && <span className="viewer-skeleton-block viewer-skeleton-cube" />}
      <svg className="viewer-skeleton-model" viewBox="0 0 120 120" aria-hidden="true">
        <ellipse className="viewer-skeleton-shadow" cx="60" cy="108" rx="44" ry="8" />
        <path className="viewer-skeleton-face" d="M60 14 102 36 60 58 18 36Z" />
        <path className="viewer-skeleton-face is-left" d="M18 36 60 58v46L18 82Z" />
        <path className="viewer-skeleton-face is-right" d="M102 36 60 58v46l42-22Z" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}
