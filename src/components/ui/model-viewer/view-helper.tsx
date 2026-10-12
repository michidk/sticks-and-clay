import { useGizmoContext } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { type PointerEvent, useEffect, useMemo, useState } from "react";
import { CanvasTexture, Vector3 } from "three";

const axes = [
  { color: "#ff4967", position: [1, 0, 0] as const, rotation: [0, 0, 0] as const },
  { color: "#7ee052", position: [0, 1, 0] as const, rotation: [0, 0, Math.PI / 2] as const },
  { color: "#4a83ff", position: [0, 0, 1] as const, rotation: [0, -Math.PI / 2, 0] as const },
] as const;

export function ViewHelper() {
  return (
    <group scale={40}>
      {axes.map((axis) => (
        <group key={axis.color} rotation={axis.rotation}>
          <mesh position={[0.4, 0, 0]}>
            <boxGeometry args={[0.8, 0.04, 0.04]} />
            <meshBasicMaterial color={axis.color} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {axes.map((axis) => (
        <AxisPoint key={`positive-${axis.color}`} color={axis.color} position={axis.position} />
      ))}
      {axes.map((axis) => (
        <AxisPoint
          key={`negative-${axis.color}`}
          color="#252525"
          opacity={0.25}
          position={axis.position.map((value) => -value) as [number, number, number]}
        />
      ))}
    </group>
  );
}

function AxisPoint({
  color,
  opacity = 1,
  position,
}: {
  color: string;
  opacity?: number;
  position: readonly [number, number, number];
}) {
  const gl = useThree((state) => state.gl);
  const { tweenCamera } = useGizmoContext();
  const [hovered, setHovered] = useState(false);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context?.beginPath();
    context?.arc(32, 32, 18, 0, Math.PI * 2);
    if (context) context.fillStyle = color;
    context?.fill();
    const result = new CanvasTexture(canvas);
    result.anisotropy = gl.capabilities.getMaxAnisotropy() || 1;
    return result;
  }, [color, gl]);

  useEffect(() => () => texture.dispose(), [texture]);

  function activate(event: PointerEvent) {
    event.stopPropagation();
    tweenCamera(new Vector3(...position));
  }

  return (
    <sprite
      position={position}
      scale={hovered ? 1.05 : 0.82}
      onPointerDown={activate}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(false);
      }}
    >
      <spriteMaterial
        map={texture}
        alphaTest={0.15}
        opacity={opacity}
        transparent
        toneMapped={false}
      />
    </sprite>
  );
}
