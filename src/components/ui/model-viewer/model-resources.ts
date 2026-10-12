import type { Material, Mesh, Object3D, SkinnedMesh, Texture } from "three";

type Resource = { dispose: () => void };
const users = new WeakMap<Resource, number>();

/** Release GPU allocations after the last mounted clone stops using them.
 * Cached Three objects and image sources remain reusable on a later mount.
 */
export function retainModelResources(model: Object3D) {
  const resources = new Set<Resource>();
  function materialResources(material: Material) {
    resources.add(material);
    for (const value of Object.values(material)) {
      if ((value as Texture | null)?.isTexture) resources.add(value as Texture);
    }
  }
  model.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      materialResources(material);
    const skinned = object as SkinnedMesh;
    if (skinned.isSkinnedMesh) resources.add(skinned.skeleton);
  });
  for (const resource of resources) users.set(resource, (users.get(resource) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const resource of resources) users.set(resource, users.get(resource)! - 1);
    // React Strict Mode and mode changes can release and acquire in one commit.
    // Wait for all mounts before deciding whether shared resources are unused.
    queueMicrotask(() => {
      for (const resource of resources) {
        if (users.get(resource) !== 0) continue;
        users.delete(resource);
        resource.dispose();
      }
    });
  };
}
