"use client";

// Keep this entry independent of the eager barrel: no Three/R3F runtime imports.
import { Component, lazy, type ReactNode, Suspense } from "react";
import { cn } from "@/lib/utils";
import type { ModelViewerProps } from "./model-viewer-types";
import { ViewerLoader } from "./viewer-loader";
import "./model-viewer.css";

export type { ModelViewerSkeletonProps } from "./model-viewer-skeleton";
export { ModelViewerSkeleton } from "./model-viewer-skeleton";

const Viewer = lazy(() =>
  import("./model-viewer").then((module) => ({ default: module.ModelViewer })),
);

/**
 * Loads the renderer chunk only when mounted. Use this entry for optional embeds.
 * `loadingFallback` and `poster` cover the chunk download and model loading alike.
 */
export function ModelViewer(props: ModelViewerProps) {
  const { className, height, style, poster, loadingFallback, showFileName = false, src } = props;
  return (
    <ImportErrorBoundary
      className={className}
      height={height}
      style={style}
      onError={props.onError}
    >
      <Suspense
        fallback={
          <div
            data-slot="model-viewer-lazy"
            className={cn("model-viewer", className)}
            style={{ height, ...style }}
          >
            {poster && <img className="viewer-poster" src={poster} alt="" aria-hidden="true" />}
            <ViewerLoader
              fallback={loadingFallback}
              poster={Boolean(poster)}
              showFileName={showFileName}
              src={src}
            />
          </div>
        }
      >
        <Viewer {...props} />
      </Suspense>
    </ImportErrorBoundary>
  );
}

// This boundary lives outside the downloaded module, so it can handle a failed
// chunk request. Reloading also recovers stale chunk URLs after a deployment;
// remounting React.lazy alone would reuse its cached rejection.
class ImportErrorBoundary extends Component<
  Pick<ModelViewerProps, "className" | "height" | "style" | "onError"> & { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { className, height, style } = this.props;
    return (
      <div
        data-slot="model-viewer-lazy"
        className={cn("model-viewer", className)}
        style={{ height, ...style }}
      >
        <div className="viewer-loader" role="alert">
          <span>Unable to load the viewer.</span>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export type { ModelViewerProps } from "./model-viewer-types";
