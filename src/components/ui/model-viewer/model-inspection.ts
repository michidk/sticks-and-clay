import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  type Material,
  type Mesh,
  type Object3D,
  Sphere,
  type Texture,
  Vector3,
} from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";

const sampled = new WeakSet<Object3D>();

/** Cache a conservative sampled envelope without changing the loader's shared pose. */
export function prepareAnimationBounds(root: Object3D, clips: AnimationClip[]) {
  if (sampled.has(root) || clips.length === 0) return;
  sampled.add(root);
  root.updateMatrixWorld(true);
  const copy = clone(root);
  copy.updateMatrixWorld(true);
  const mixer = new AnimationMixer(copy);
  const box = new Box3().setFromObject(copy, true);
  for (const clip of clips) {
    const action = mixer.clipAction(clip).play();
    for (let sample = 0; sample <= 16; sample++) {
      mixer.setTime((clip.duration * sample) / 16);
      copy.updateMatrixWorld(true);
      box.union(new Box3().setFromObject(copy, true));
    }
    action.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(copy);
  copy.updateMatrixWorld(true);
  box.applyMatrix4(copy.matrixWorld.clone().invert());
  root.userData.viewerAnimationBounds = [box.min.toArray(), box.max.toArray()];
}

export type ModelInspection = {
  dimensions: [number, number, number];
  triangles: number;
  materials: number;
  textures: number;
  nodes: { id: string; name: string; type: string; depth: number; mesh: boolean }[];
};

export function inspectModel(root: Object3D): ModelInspection {
  root.updateWorldMatrix(true, true);
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  let triangles = 0;
  const nodes: ModelInspection["nodes"] = [];
  function visit(object: Object3D, path: string, depth: number) {
    object.userData.viewerNodeId = path;
    const mesh = object as Mesh;
    nodes.push({
      id: path,
      name: object.name || object.type,
      type: object.type,
      depth,
      mesh: Boolean(mesh.isMesh),
    });
    if (mesh.isMesh) {
      triangles +=
        ((mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3) *
        ((mesh as Mesh & { count?: number }).count ?? 1);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    }
    object.children.forEach((child, index) => visit(child, `${path}/${index}`, depth + 1));
  }
  visit(root, "0", 0);
  return {
    dimensions: new Box3().setFromObject(root, true).getSize(new Vector3()).toArray(),
    triangles: Math.round(triangles),
    materials: materials.size,
    textures: textures.size,
    nodes,
  };
}

export function frameBounds(object: Object3D, aspect: number, fov = 42) {
  object.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(object, true);
  object.traverse((node) => {
    const bounds = node.userData.viewerAnimationBounds as [number[], number[]] | undefined;
    if (bounds)
      box.union(
        new Box3(
          new Vector3().fromArray(bounds[0]),
          new Vector3().fromArray(bounds[1]),
        ).applyMatrix4(node.matrixWorld),
      );
  });
  const sphere = box.getBoundingSphere(new Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 0.001;
  const center = box.isEmpty() ? new Vector3() : sphere.center;
  const halfFov = (fov * Math.PI) / 360;
  const limitingAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * Math.max(aspect, 0.001)));
  const distance = (radius / Math.sin(limitingAngle)) * 1.15;
  return {
    center,
    radius,
    distance,
    near: Math.max(radius / 1000, 1e-8),
    far: distance + radius * 100,
  };
}
