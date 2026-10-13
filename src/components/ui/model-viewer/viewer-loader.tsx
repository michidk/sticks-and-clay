"use client";

// Shared by the scene and the lazy entry: no Three/R3F runtime imports.
import { cn } from "@/lib/utils";
import type { ModelViewerProps } from "./model-viewer-types";
import { ViewerLoaderSpinner } from "./viewer-loader-spinner";

export function ViewerLoader({
  fallback,
  poster,
  showFileName,
  src,
}: {
  fallback?: ModelViewerProps["loadingFallback"];
  poster: boolean;
  showFileName: boolean;
  src?: string;
}) {
  // Drei's useProgress observes the global loading manager, which also tracks
  // assets belonging to other viewer instances. This is intentionally
  // indeterminate until this viewer's own scene reports ready or error.
  const data = { active: true, progress: 0, item: src ?? "", loaded: 0, total: 0 };
  const custom = typeof fallback === "function" ? fallback(data) : fallback;
  if (fallback !== undefined && custom == null) return null;
  return (
    <div className={cn("viewer-loader", poster && "has-poster")} role="status" aria-live="polite">
      {fallback !== undefined ? (
        custom
      ) : (
        <>
          <ViewerLoaderSpinner />
          <span>Loading model…</span>
          {showFileName && src && <small>{fileName(src)}</small>}
        </>
      )}
    </div>
  );
}

function fileName(path: string) {
  return path.split(/[?#]/)[0].split(/[\\/]/).pop() || "Model asset";
}
