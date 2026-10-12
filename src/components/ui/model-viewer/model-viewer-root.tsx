"use client";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { ModelViewerContext } from "./model-viewer-context";
import type { ModelViewerRootProps } from "./model-viewer-types";
import { useModelViewerRuntime } from "./use-model-viewer-runtime";
import { ViewerUiProvider } from "./viewer-ui";
import "./model-viewer.css";

/** Owns state and layout only. Mount exactly one ModelViewerScene inside it. */
export function ModelViewerRoot(props: ModelViewerRootProps) {
  const runtime = useModelViewerRuntime(props);
  const { state, root, viewerRef, viewerKey, toolbarOffset } = runtime;
  return (
    <ModelViewerContext.Provider value={runtime}>
      <ViewerUiProvider components={root.components}>
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: The runtime role is group or dialog, both of which support accessible naming. */}
        <div
          ref={viewerRef}
          data-slot="model-viewer"
          data-state={state.status}
          data-rendering={state.renderingPaused ? "paused" : "active"}
          data-viewer-mode={state.mode}
          data-viewer-key={viewerKey}
          aria-label={runtime.accessibleLabel}
          aria-labelledby={runtime.ariaLabelledBy}
          className={cn(
            "model-viewer",
            toolbarOffset > 0 && "has-toolbar",
            state.lighting === "night" && "is-night",
            state.lighting === "outside" && "is-outside",
            root.isExpanded && "is-expanded",
            root.className,
          )}
          style={
            {
              "--viewer-toolbar-offset": `${toolbarOffset}px`,
              height: root.height,
              ...root.style,
            } as CSSProperties
          }
          {...root.props}
          role={root.isExpanded ? "dialog" : (root.props.role ?? "group")}
          aria-modal={root.isExpanded ? true : root.props["aria-modal"]}
          tabIndex={root.isExpanded ? -1 : root.props.tabIndex}
        >
          {root.children}
        </div>
      </ViewerUiProvider>
    </ModelViewerContext.Provider>
  );
}
