"use client";

import { type ComputeFunction, createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { Scene } from "three";

export function ScissorView({
  track,
  index,
  clearColor,
  children,
}: {
  track: RefObject<HTMLDivElement | null>;
  index: number;
  clearColor: string;
  children: ReactNode;
}) {
  const [scene] = useState(() => new Scene());
  const [size, setSize] = useState({ width: 1, height: 1, top: 0, left: 0 });

  useLayoutEffect(() => {
    let frame = 0;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const element = track.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width &&
        current.height === rect.height &&
        current.top === rect.top &&
        current.left === rect.left
          ? current
          : {
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left,
            },
      );
    };
    // Canvas and its DOM tracks commit in separate React roots. The R3F
    // layout effect can run before the DOM ref has been attached.
    const observeTrack = () => {
      const element = track.current;
      if (!element) {
        frame = requestAnimationFrame(observeTrack);
        return;
      }
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(element);
    };
    observeTrack();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [track]);

  const compute = useCallback<ComputeFunction>(
    (event, state) => {
      const rect = track.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      if (!(event.target instanceof Node) || !track.current?.contains(event.target)) {
        state.pointer.set(10000, 10000);
        state.raycaster.setFromCamera(state.pointer, state.camera);
        return;
      }
      state.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
    [track],
  );

  return createPortal(
    <ScissorRenderer track={track} size={size} index={index} clearColor={clearColor}>
      {children}
    </ScissorRenderer>,
    scene,
    { events: { compute, priority: index }, size },
  );
}

export function RedrawAfterResize() {
  const dpr = useThree((state) => state.viewport.dpr);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    // Changing pixel ratio clears WebGL's drawing buffer, even when the scene is idle.
    const frame = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(frame);
  }, [dpr, size.width, size.height, invalidate]);
  return null;
}

function ScissorRenderer({
  track,
  size,
  index,
  clearColor,
  children,
}: {
  track: RefObject<HTMLDivElement | null>;
  size: { width: number; height: number; top: number; left: number };
  index: number;
  clearColor: string;
  children: ReactNode;
}) {
  const set = useThree((state) => state.set);
  useLayoutEffect(() => {
    // R3F portals refresh injected props when the parent store changes, not
    // necessarily when the track is measured. Keep this pane's size current
    // without depending on unrelated root renders or camera interactions.
    set({ size });
  }, [set, size]);

  useFrame((state) => {
    const element = track.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const canvasRect = state.gl.domElement.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > canvasRect.left &&
      rect.left < canvasRect.right &&
      rect.bottom > canvasRect.top &&
      rect.top < canvasRect.bottom;
    if (!visible) return;

    if (index === 1) {
      state.gl.setScissorTest(false);
      state.gl.setClearColor(clearColor, 1);
      state.gl.clear(true, true, true);
    }

    const left = rect.left - canvasRect.left;
    const bottom = canvasRect.bottom - rect.bottom;
    const autoClear = state.gl.autoClear;
    state.gl.autoClear = false;
    state.gl.setViewport(left, bottom, rect.width, rect.height);
    state.gl.setScissor(left, bottom, rect.width, rect.height);
    state.gl.setScissorTest(true);
    state.gl.clear(false, true, true);
    state.gl.render(state.scene, state.camera);
    state.gl.setScissorTest(false);
    state.gl.autoClear = autoClear;
  }, index);
  return (
    <>
      {children}
      <group onPointerOver={() => undefined} />
    </>
  );
}
