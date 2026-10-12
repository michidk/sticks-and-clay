import { BackSide } from "three";

const vertexShader = `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;

const fragmentShader = `
  varying vec3 vDirection;
  void main() {
    float elevation = clamp(vDirection.y, 0.0, 1.0);
    vec3 horizon = vec3(0.859, 0.914, 0.933);
    vec3 zenith = vec3(0.31, 0.58, 0.84);
    vec3 color = mix(horizon, zenith, pow(elevation, 0.7));
    vec3 sun = normalize(vec3(0.65, 0.6, -0.25));
    float halo = pow(max(dot(normalize(vDirection), sun), 0.0), 64.0);
    color = mix(color, vec3(1.0, 0.95, 0.78), halo * 0.4);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Self-contained daylight sky: no remote HDRI or asset request. */
export function OutsideSky() {
  return (
    <mesh scale={900} frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        depthTest={false}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  );
}
