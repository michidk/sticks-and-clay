"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useExpandedViewerFocus } from "./use-expanded-viewer-focus";
import type { ReportFeedback } from "./use-viewer-feedback";

/** Native fullscreen with an in-page expanded fallback when the browser refuses entry. */
export function useViewerFullscreen(
  viewerRef: RefObject<HTMLDivElement | null>,
  report: ReportFeedback,
) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const update = () => {
      const active = document.fullscreenElement === viewerRef.current;
      setIsFullscreen(active);
      if (active) setIsExpanded(false);
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [viewerRef]);

  useExpandedViewerFocus(viewerRef, isExpanded, returnFocus, () => setIsExpanded(false));

  async function toggleFullscreen() {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    const viewer = viewerRef.current;
    if (viewer && document.fullscreenElement === viewer) {
      // A failed exit leaves native fullscreen active; never stack the fallback on top of it.
      try {
        await document.exitFullscreen();
      } catch {
        report("Could not exit fullscreen. Press Escape to leave it.", true);
      }
      return;
    }
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!document.fullscreenEnabled || !viewer) throw new Error("Fullscreen unavailable");
      await viewer.requestFullscreen();
    } catch {
      if (document.fullscreenElement !== viewer) setIsExpanded(true);
    }
  }

  return { fullscreen: isFullscreen || isExpanded, isExpanded, toggleFullscreen };
}
