import { createHash } from "node:crypto";

export class GlbHandoverError extends Error {}

export const GENERATOR = "Sticks & Clay";
const JSON_CHUNK = 0x4e4f534a;
const exporterKeys = new Set([
  "generator",
  "exporter",
  "exporterversion",
  "exportertool",
  "createdby",
  "createdwith",
  "creationtool",
  "software",
  "application",
  "blender",
]);

/** Only exporter identification in extras is removed, never functional extensions
 * or arbitrary names, user properties, attribution and license information. */
function removeExporterMarkers(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) removeExporterMarkers(item);
    return;
  }
  const object = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(object)) {
    if (
      key === "extras" &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
      const extras = child as Record<string, unknown>;
      for (const name of Object.keys(extras)) {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (exporterKeys.has(normalized) || normalized.startsWith("blender"))
          delete extras[name];
      }
      if (!Object.keys(extras).length) delete object.extras;
    } else if (key !== "extensions") removeExporterMarkers(child);
  }
}

// Ordered, deterministic handover passes. Future local processing belongs here.
const passes = [
  {
    id: "generator-marker",
    version: 1,
    apply(document: Record<string, any>) {
      removeExporterMarkers(document);
      document.asset.generator = GENERATOR;
    },
  },
] as const;

/** Rebuild the JSON chunk while preserving BIN and unknown chunks byte for byte. */
export function handoverGlb(input: Buffer) {
  const invalid = () => new GlbHandoverError("Invalid GLB at handover");
  if (
    input.length < 20 ||
    input.toString("ascii", 0, 4) !== "glTF" ||
    input.readUInt32LE(4) !== 2 ||
    input.readUInt32LE(8) !== input.length
  )
    throw invalid();
  let offset = 12,
    jsonEnd = 0;
  while (offset < input.length) {
    if (offset + 8 > input.length) throw invalid();
    const size = input.readUInt32LE(offset),
      type = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (size % 4 !== 0 || end > input.length) throw invalid();
    if (offset === 12) {
      if (type !== JSON_CHUNK) throw invalid();
      jsonEnd = end;
    } else if (type === JSON_CHUNK) throw invalid();
    offset = end;
  }
  let document: Record<string, any>;
  try {
    document = JSON.parse(input.toString("utf8", 20, jsonEnd));
  } catch {
    throw invalid();
  }
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    document.asset?.version !== "2.0"
  )
    throw invalid();
  for (const pass of passes) pass.apply(document);
  const json = Buffer.from(JSON.stringify(document), "utf8");
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const header = Buffer.from(input.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + input.length - jsonEnd, 8);
  header.writeUInt32LE(padded.length, 12);
  const bytes = Buffer.concat([header, padded, input.subarray(jsonEnd)]);
  const sha256 = (buffer: Buffer) =>
    createHash("sha256").update(buffer).digest("hex");
  return {
    bytes,
    receipt: {
      version: 1,
      generator: GENERATOR,
      steps: passes.map(({ id, version }) => ({ id, version })),
      inputSha256: sha256(input),
      outputSha256: sha256(bytes),
      inputBytes: input.length,
      outputBytes: bytes.length,
    },
  };
}
