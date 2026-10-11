export function measureStyle(document: any) {
  const materials = document.materials || [];
  return {
    version: 1,
    baseColors: materials.map(
      (m: any) => m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1],
    ),
    roughness: materials.map(
      (m: any) => m.pbrMetallicRoughness?.roughnessFactor ?? 1,
    ),
    metallic: materials.map(
      (m: any) => m.pbrMetallicRoughness?.metallicFactor ?? 1,
    ),
    materialCount: materials.length,
    imageCount: (document.images || []).length,
    limitations: [
      "Scalar material factors only; image pixels and baked wear are not measured.",
    ],
  };
}
export function compareStyle(
  style: ReturnType<typeof measureStyle>,
  examples: Record<string, unknown>[],
  variation: number,
) {
  const warnings: string[] = [],
    average = (values: number[]) =>
      values.reduce((a, b) => a + b, 0) / values.length;
  for (const key of ["roughness", "metallic"] as const) {
    const values = examples.flatMap((e) => (e.style as any)?.[key] || []);
    if (
      values.length &&
      style[key].length &&
      Math.abs(average(values) - average(style[key])) > 0.15 + variation / 200
    )
      warnings.push(
        `${key} differs from selected examples; verify this is intentional in the actual renders`,
      );
  }
  return { status: warnings.length ? "warnings" : "measured", warnings };
}
