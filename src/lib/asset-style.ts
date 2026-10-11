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
  const palette = examples
    .flatMap((e) => (e.style as any)?.baseColors || [])
    .filter(
      (color: unknown) =>
        Array.isArray(color) &&
        color.length >= 3 &&
        color.slice(0, 3).every(Number.isFinite),
    );
  if (
    palette.length &&
    style.baseColors.some(
      (color: number[]) =>
        Math.min(
          ...palette.map((reference: number[]) =>
            Math.max(
              ...color
                .slice(0, 3)
                .map((value, channel) => Math.abs(value - reference[channel])),
            ),
          ),
        ) >
        0.15 + variation / 200,
    )
  )
    warnings.push(
      "baseColors differ from selected examples; verify the palette in the actual renders",
    );
  const imageCounts = examples
    .map((e) => (e.style as any)?.imageCount)
    .filter(
      (count: unknown): count is number =>
        typeof count === "number" && Number.isFinite(count),
    );
  if (
    imageCounts.length &&
    Math.abs(style.imageCount - average(imageCounts)) >
      (average(imageCounts) * variation) / 100
  )
    warnings.push(
      "imageCount differs from selected examples; verify texture use is intentional",
    );
  return { status: warnings.length ? "warnings" : "measured", warnings };
}
