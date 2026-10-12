"use client";

import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import {
  type Group,
  type OrthographicCamera as ThreeOrthographicCamera,
  type PerspectiveCamera as ThreePerspectiveCamera,
  Vector3,
} from "three";
import { frameBounds } from "./model-inspection";
import type { ViewerCameraStore } from "./model-viewer-camera";
import type { ViewerCameraPreset, ViewerCameraState, ViewerLighting } from "./model-viewer-types";

const presetVectors: Record<ViewerCameraPreset, [number, number, number]> = {
  isometric: [2.6, 1.9, -2.6],
  front: [0, 0, 1],
  right: [1, 0, 0],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  top: [0.001, 1, 0.001],
  bottom: [0.001, -1, 0.001],
};

export function CameraRig({
  lighting,
  objectRef,
  fitVersion,
  preset,
  resetToken,
  autoRotate,
  autoRotateSpeed,
  onCameraChange,
  cameraStore,
  paneSelector,
  fixed,
}: {
  lighting: ViewerLighting;
  fixed: boolean;
  paneSelector: string;
  objectRef: RefObject<Group | null>;
  fitVersion: number;
  preset: ViewerCameraPreset;
  resetToken: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
  onCameraChange?: (state: ViewerCameraState) => void;
  cameraStore?: ViewerCameraStore;
}) {
  const controls = useRef<CameraControlsImpl | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree(
    (state) => state.camera as ThreePerspectiveCamera | ThreeOrthographicCamera,
  );
  const size = useThree((state) => state.size);

  const frameObject = useCallback(
    (transition: boolean) => {
      const object = objectRef.current;
      if (!object || !controls.current) return;
      const { center, radius, distance, near, far } = frameBounds(
        object,
        size.width / size.height,
        "fov" in camera ? camera.fov : 42,
      );
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
      if ("isOrthographicCamera" in camera)
        void controls.current.zoomTo(Math.min(size.width, size.height) / (radius * 2.3), false);
      const direction = new Vector3(
        ...(lighting === "outside" && preset === "isometric"
          ? ([1.7, 0.5, 1.7] as const)
          : presetVectors[preset]),
      ).normalize();
      const position = center.clone().add(direction.multiplyScalar(distance));
      controls.current.minDistance = radius * 0.05;
      controls.current.maxDistance = distance * 10;
      void controls.current.setLookAt(
        position.x,
        position.y,
        position.z,
        center.x,
        center.y,
        center.z,
        transition,
      );
      if (!transition) controls.current.saveState();
    },
    [camera, lighting, objectRef, preset, size.width, size.height],
  );

  useEffect(() => {
    frameObject(false);
  }, [fitVersion, frameObject, size.width, size.height]);
  useEffect(() => {
    if (resetToken > 0) frameObject(true);
  }, [resetToken, frameObject]);

  useEffect(() => {
    if (!cameraStore) return;
    cameraStore.register((view, transition) => {
      void controls.current?.setLookAt(...view.position, ...view.target, transition);
      // Imperative commands do not cause a React render. Wake the demand loop
      // so controls apply the new position and publish the live camera view.
      invalidate();
    });
    const current = controls.current;
    if (current)
      cameraStore.publish({
        position: current.getPosition(new Vector3()).toArray(),
        target: current.getTarget(new Vector3()).toArray(),
      });
    return () => cameraStore.register(null);
  }, [cameraStore, invalidate]);

  useFrame((_, delta) => {
    if (autoRotate && controls.current)
      void controls.current.rotate(autoRotateSpeed * delta, 0, false);
  });

  function readCamera(): ViewerCameraState | null {
    if (!controls.current) return null;
    const position = controls.current.getPosition(new Vector3());
    const target = controls.current.getTarget(new Vector3());
    return { position: position.toArray(), target: target.toArray() };
  }

  function reportLiveCamera() {
    const view = readCamera();
    if (view) cameraStore?.publish(view);
  }

  function reportCamera() {
    const view = readCamera();
    if (view) onCameraChange?.(view);
  }

  const actions = CameraControlsImpl.ACTION;
  const orthographic = "isOrthographicCamera" in camera;
  return (
    <CameraControls
      ref={controls}
      domElement={document.querySelector<HTMLElement>(paneSelector) ?? undefined}
      makeDefault
      smoothTime={0.25}
      dollyToCursor
      onChange={reportLiveCamera}
      onRest={reportCamera}
      azimuthRotateSpeed={fixed ? 0 : 1}
      polarRotateSpeed={fixed ? 0 : 1}
      mouseButtons={{
        left: fixed ? actions.TRUCK : actions.ROTATE,
        right: actions.TRUCK,
        middle: orthographic ? actions.ZOOM : actions.DOLLY,
        wheel: orthographic ? actions.ZOOM : actions.DOLLY,
      }}
      touches={{
        one: fixed ? actions.TOUCH_TRUCK : actions.TOUCH_ROTATE,
        two: orthographic ? actions.TOUCH_ZOOM_TRUCK : actions.TOUCH_DOLLY_TRUCK,
        three: actions.TOUCH_TRUCK,
      }}
    />
  );
}

export function FitStaticCamera({
  objectRef,
  fitVersion,
  preset,
  resetToken,
}: {
  objectRef: RefObject<Group | null>;
  fitVersion: number;
  preset: ViewerCameraPreset;
  resetToken: number;
}) {
  const camera = useThree(
    (state) => state.camera as ThreePerspectiveCamera | ThreeOrthographicCamera,
  );
  const size = useThree((state) => state.size);
  useEffect(() => {
    const object = objectRef.current;
    if (!object) return;
    const { center, radius, distance, near, far } = frameBounds(
      object,
      size.width / size.height,
      "fov" in camera ? camera.fov : 42,
    );
    const direction = new Vector3(...presetVectors[preset]).normalize();
    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near = near;
    camera.far = far;
    if ("isOrthographicCamera" in camera)
      camera.zoom = Math.min(size.width, size.height) / (radius * 2.3);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [camera, fitVersion, objectRef, preset, resetToken, size.width, size.height]);
  return null;
}

export function DragLook({ selector }: { selector: string }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return;
    let dragging = false;
    camera.rotation.reorder("YXZ");
    target.tabIndex = 0;
    const down = (event: globalThis.PointerEvent) => {
      if (event.button === 0) {
        dragging = true;
        target.focus();
        target.setPointerCapture(event.pointerId);
      }
    };
    const move = (event: globalThis.PointerEvent) => {
      if (!dragging) return;
      camera.rotation.y -= event.movementX * 0.002;
      camera.rotation.x = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, camera.rotation.x - event.movementY * 0.002),
      );
      invalidate();
    };
    const up = (event: globalThis.PointerEvent) => {
      dragging = false;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    target.addEventListener("pointerdown", down);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    return () => {
      target.removeEventListener("pointerdown", down);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
  }, [camera, invalidate, selector]);
  return null;
}

export function FirstPersonMovement({
  requirePointerLock,
  selector,
}: {
  requirePointerLock: boolean;
  selector: string;
}) {
  const { camera, gl, invalidate } = useThree();
  const pressed = useRef(new Set<string>());
  useEffect(() => {
    const target = document.querySelector<HTMLElement>(selector);
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]"))
        return;
      if (!requirePointerLock && event.target !== target) return;
      if (requirePointerLock && document.pointerLockElement !== gl.domElement) return;
      pressed.current.add(event.code);
      invalidate();
      if (
        (document.pointerLockElement || !requirePointerLock) &&
        (event.code.startsWith("Arrow") || event.code === "Space")
      )
        event.preventDefault();
    };
    const up = (event: KeyboardEvent) => pressed.current.delete(event.code);
    const blur = () => pressed.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [requirePointerLock, selector, gl, invalidate]);
  useFrame((_, delta) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (
      requirePointerLock
        ? document.pointerLockElement !== gl.domElement
        : document.activeElement !== target
    )
      return;
    const speed = Math.min(delta, 0.05) * 2.2;
    const keys = pressed.current;
    const forward =
      Number(keys.has("KeyW") || keys.has("ArrowUp")) -
      Number(keys.has("KeyS") || keys.has("ArrowDown"));
    const sideways =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const vertical =
      Number(keys.has("Space") || keys.has("KeyE")) -
      Number(keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyQ"));
    if (!forward && !sideways && !vertical) return;
    const scale = 1 / Math.hypot(forward, sideways, vertical);
    camera.translateZ(-forward * speed * scale);
    camera.translateX(sideways * speed * scale);
    camera.position.y += vertical * speed * scale;
    invalidate();
  });
  return null;
}
