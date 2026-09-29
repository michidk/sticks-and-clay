import { NodeIO, PropertyType } from "@gltf-transform/core";
import {
  dedup,
  prune,
  reorder,
  weldPrimitive,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

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
    for (const mesh of document.getRoot().listMeshes())
      for (const primitive of mesh.listPrimitives())
        weldPrimitive(primitive, { overwrite: true });
    await document.transform(
      dedup({ propertyTypes: [PropertyType.ACCESSOR], keepUniqueNames: true }),
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
    return {
      bytes: await io.writeBinary(document),
      cleanup: {
        status: "applied",
        steps: [
          "dedup-accessors",
          "weld-exact-vertices",
          "prune-unused-resources",
          ...(!blended ? ["reorder-indices"] : []),
        ],
      },
    };
  } catch (error) {
    return skipped(
      `Cleanup unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
