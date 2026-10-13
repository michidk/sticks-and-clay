import { NodeIO, type GLTF } from "@gltf-transform/core";

export type MeshEvidence = {
  name: string;
  node: number;
  mesh: number;
  vertices: number[][];
  faces: number[][];
  faceRefs: { primitive: number; triangle: number }[];
  uvBindings: {
    material: number;
    slot: string;
    texCoord: number;
    faces: number[];
    uv: number[][][] | null;
  }[];
  topology: Record<string, { count: number; faces: number[] }>;
};

/** Decode accessor data directly. No Blender import/validation or geometry repair. */
export async function extractMeshes(bytes: Uint8Array) {
  const io = new NodeIO();
  const source = await io.binaryToJSON(bytes);
  const json = source.json;
  if (
    [...(json.buffers || []), ...(json.images || [])].some(
      (r) => r.uri && !r.uri.startsWith("@"),
    )
  )
    throw new Error("URI resources are not supported by analysis");
  // Material extensions do not change topology. Other extensions can change the
  // decoded geometry/instances and must not silently produce incomplete evidence.
  const unsupported = (json.extensionsUsed || []).filter(
    (e) => !e.startsWith("KHR_materials_") && e !== "KHR_texture_transform",
  );
  if (unsupported.length)
    throw new Error(
      `Unsupported geometry extensions: ${unsupported.join(", ")}`,
    );
  const document = await io.readJSON(source);
  const root = document.getRoot();
  const objects: MeshEvidence[] = [],
    unavailable: string[] = [];
  const scene = root.getDefaultScene() || root.listScenes()[0];
  if (!scene) return { objects, unavailable: ["No scene to inspect"] };
  const active = new Set<ReturnType<typeof root.listNodes>[number]>();
  scene.traverse((node) => active.add(node));
  for (const [nodeIndex, node] of root.listNodes().entries()) {
    const mesh = node.getMesh();
    if (!mesh || !active.has(node)) continue;
    if (
      node.getSkin() ||
      mesh.listPrimitives().some((p) => p.listTargets().length)
    ) {
      unavailable.push(
        `${node.getName()}: posed/skinned/morph geometry not inspected`,
      );
      continue;
    }
    const m = node.getWorldMatrix();
    const mirrored =
      m[0] * (m[5] * m[10] - m[6] * m[9]) -
        m[4] * (m[1] * m[10] - m[2] * m[9]) +
        m[8] * (m[1] * m[6] - m[2] * m[5]) <
      0;
    const obj: MeshEvidence = {
      name: node.getName() || `Node ${nodeIndex}`,
      node: nodeIndex,
      mesh: root.listMeshes().indexOf(mesh),
      vertices: [],
      faces: [],
      faceRefs: [],
      uvBindings: [],
      topology: {},
    };
    for (const [primitive, p] of mesh.listPrimitives().entries()) {
      const positions = p.getAttribute("POSITION");
      if (p.getMode() !== 4 || !positions) {
        unavailable.push(
          `${obj.name}/${primitive}: non-triangle or missing positions`,
        );
        continue;
      }
      const offset = obj.vertices.length;
      for (let i = 0; i < positions.getCount(); i++) {
        const [x, y, z] = positions.getElement(i, [0, 0, 0]);
        obj.vertices.push([
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
      }
      const indices = p.getIndices(),
        count = indices?.getCount() ?? positions.getCount();
      if (count % 3)
        throw new Error("Triangle index count is not divisible by three");
      const faces: number[] = [];
      for (let i = 0; i < count; i += 3) {
        const face = (mirrored ? [0, 2, 1] : [0, 1, 2]).map((k) =>
          indices ? indices.getScalar(i + k) : i + k,
        );
        if (
          face.some(
            (v) => !Number.isInteger(v) || v < 0 || v >= positions.getCount(),
          )
        )
          throw new Error("Triangle index out of bounds");
        faces.push(obj.faces.length);
        obj.faces.push(face.map((v) => v + offset));
        obj.faceRefs.push({ primitive, triangle: i / 3 });
      }
      const material = root.listMaterials().indexOf(p.getMaterial()!);
      const definition = json.materials?.[material];
      // TextureInfo objects include the actual per-slot UV binding, including
      // extension slots and KHR_texture_transform's texCoord override.
      const visit = (value: unknown, slot: string) => {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          const path = slot ? `${slot}.${key}` : key;
          if (
            key.endsWith("Texture") &&
            child &&
            typeof child === "object" &&
            "index" in child
          ) {
            const info = child as GLTF.ITextureInfo;
            const transform = info.extensions?.KHR_texture_transform as
              { texCoord?: number } | undefined;
            const texCoord = transform?.texCoord ?? info.texCoord ?? 0;
            const uv = p.getAttribute(`TEXCOORD_${texCoord}`);
            obj.uvBindings.push({
              material,
              slot: path,
              texCoord,
              faces,
              uv: uv
                ? faces.map((f) =>
                    obj.faces[f].map((v) => uv.getElement(v - offset, [])),
                  )
                : null,
            });
          } else visit(child, path);
        }
      };
      visit(definition, "");
    }
    objects.push(obj);
  }
  return { objects, unavailable };
}
