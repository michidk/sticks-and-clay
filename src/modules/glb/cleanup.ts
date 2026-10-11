import { NodeIO, PropertyType } from "@gltf-transform/core";
import {
  dedup,
  prune,
  reorder,
  simplifyPrimitive,
  weldPrimitive,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const MIN_SIMPLIFY_TRIANGLES = 1_000;
const SIMPLIFY_RATIO = 0.5;
const SIMPLIFY_ERROR = 0.001;

function triangleCount(document: Awaited<ReturnType<NodeIO["readBinary"]>>) {
  return document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((total, primitive) => {
      const indices = primitive.getIndices();
      return total + (indices ? indices.getCount() / 3 : 0);
    }, 0);
}

/** Best effort only. Unsupported semantics retain the original bytes. */
export async function cleanupGlb(input: Uint8Array) {
  const skipped = (reason: string) => ({
    bytes: input,
    cleanup: { status: "skipped", reason },
  });
  try {
    const buffer = Buffer.from(input);
    const json = JSON.parse(
      buffer.toString("utf8", 20, 20 + buffer.readUInt32LE(12)),
    );
    let offset = 12;
    while (offset < buffer.length) {
      const type = buffer.readUInt32LE(offset + 4);
      if (![0x4e4f534a, 0x004e4942].includes(type))
        return skipped("Unknown GLB chunk");
      offset += 8 + buffer.readUInt32LE(offset);
    }
    // No extension round-tripping assumptions; preserve animated/rigged exports verbatim.
    if (
      JSON.stringify(json).includes('"extensions":') ||
      json.extensionsUsed?.length ||
      json.extensionsRequired?.length ||
      json.animations?.length ||
      json.skins?.length ||
      json.meshes?.some((m: any) =>
        m.primitives.some((p: any) => p.targets?.length || (p.mode ?? 4) !== 4),
      )
    )
      return skipped(
        "Extensions, animation, skinning, morphs or non-triangle primitives",
      );
    if (
      [...(json.buffers || []), ...(json.images || [])].some((r: any) => r.uri)
    )
      return skipped("External or URI resources");
    const io = new NodeIO();
    const document = await io.readBinary(input);
    const trianglesBefore = triangleCount(document);
    let simplified = false;
    for (const mesh of document.getRoot().listMeshes())
      for (const primitive of mesh.listPrimitives()) {
        weldPrimitive(primitive, { overwrite: true });
        const triangles = (primitive.getIndices()?.getCount() || 0) / 3;
        if (
          triangles >= MIN_SIMPLIFY_TRIANGLES &&
          primitive.getMaterial()?.getAlphaMode() !== "BLEND"
        ) {
          await MeshoptSimplifier.ready;
          simplifyPrimitive(primitive, {
            simplifier: MeshoptSimplifier,
            ratio: SIMPLIFY_RATIO,
            error: SIMPLIFY_ERROR,
            lockBorder: true,
          });
          simplified = true;
        }
      }
    await document.transform(
      dedup({ propertyTypes: [PropertyType.ACCESSOR], keepUniqueNames: true }),
    );
    const blended = json.materials?.some((m: any) => m.alphaMode === "BLEND");
    if (!blended) {
      await MeshoptEncoder.ready;
      await document.transform(
        reorder({
          encoder: MeshoptEncoder,
          target: "performance",
          cleanup: false,
        }),
      );
    }
    // Reordering clones accessors: prune only after all geometry transforms.
    await document.transform(
      prune({
        propertyTypes: [
          PropertyType.ACCESSOR,
          PropertyType.TEXTURE,
          PropertyType.MATERIAL,
          PropertyType.BUFFER,
        ],
        keepLeaves: true,
        keepAttributes: true,
        keepIndices: true,
        keepSolidTextures: true,
        keepExtras: true,
      }),
    );
    return {
      bytes: await io.writeBinary(document),
      cleanup: {
        status: "applied",
        steps: [
          "weld-exact-vertices",
          ...(simplified ? ["simplify-large-opaque-meshes"] : []),
          "dedup-accessors",
          ...(!blended ? ["reorder-indices"] : []),
          "prune-unused-resources",
        ],
        triangles: {
          before: trianglesBefore,
          after: triangleCount(document),
        },
      },
    };
  } catch (error) {
    return skipped(
      `Cleanup unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
