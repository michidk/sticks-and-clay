"use client";
import { type RefObject, useEffect, useState } from "react";

/** True while the viewer is scrolled out of view or the page is hidden. */
export function useViewerHidden(viewerRef: RefObject<HTMLElement | null>) {
  const [inViewport, setInViewport] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => setInViewport(entry.isIntersecting));
    if (viewerRef.current) observer?.observe(viewerRef.current);
    return () => {
      document.removeEventListener("visibilitychange", update);
      observer?.disconnect();
    };
  }, [viewerRef]);
  return !inViewport || !pageVisible;
}

export function useReducedMotion(enabled: boolean) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setReduced(false);
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [enabled]);
  return reduced;
}
