"use client";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ViewerMode } from "./model-viewer-types";

/** Browser interaction capabilities and layout measurements, independent of the model. */
export function useViewerInteractions(
  mode: ViewerMode,
  setMode: (mode: ViewerMode) => void,
  setLocked: Dispatch<SetStateAction<boolean>>,
) {
  const [pointerLockAvailable, setPointerLockAvailable] = useState(true);
  const [resetToken, setResetToken] = useState(0);
  const [animationResetToken, setAnimationResetToken] = useState(0);
  const [toolbarOffset, setToolbarOffset] = useState(0);
  const toolbarMeasurements = useRef(new Map<HTMLElement, number>());
  const reportToolbar = useCallback((element: HTMLElement, offset: number | null) => {
    if (offset === null) toolbarMeasurements.current.delete(element);
    else toolbarMeasurements.current.set(element, offset);
    setToolbarOffset(Math.max(0, ...toolbarMeasurements.current.values()));
  }, []);
  useEffect(() => {
    const rejectLock = () => {
      setPointerLockAvailable(false);
      setLocked(false);
    };
    document.addEventListener("pointerlockerror", rejectLock);
    return () => document.removeEventListener("pointerlockerror", rejectLock);
  }, [setLocked]);
  useEffect(() => {
    setPointerLockAvailable("requestPointerLock" in HTMLElement.prototype);
  }, []);

  function changeMode(next: ViewerMode) {
    if (next === mode) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setMode(next);
  }

  return {
    pointerLockAvailable,
    resetToken,
    animationResetToken,
    toolbarOffset,
    reportToolbar,
    changeMode,
    resetView: () => setResetToken((value) => value + 1),
    restartAnimation: () => setAnimationResetToken((value) => value + 1),
  };
}
