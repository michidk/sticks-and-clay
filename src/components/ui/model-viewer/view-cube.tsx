"use client";

import { GizmoHelper, GizmoViewcube } from "@react-three/drei";
import type { ComponentProps } from "react";
import { ViewHelper } from "./view-helper";

export type ViewCubePosition = NonNullable<ComponentProps<typeof GizmoHelper>["alignment"]>;
export type ViewCubeProps = {
  variant?: "drei" | "asset-studio";
  position?: ViewCubePosition;
  margin?: [number, number];
  renderPriority?: number;
};

/** Compose inside an R3F Canvas with default camera controls. */
export function ViewCube({
  variant = "asset-studio",
  position = "top-right",
  margin = [64, 64],
  renderPriority = 1,
}: ViewCubeProps) {
  return (
    <GizmoHelper alignment={position} margin={margin} renderPriority={renderPriority}>
      {variant === "drei" ? <GizmoViewcube /> : <ViewHelper />}
    </GizmoHelper>
  );
}
