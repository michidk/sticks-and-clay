type TriangleArtifacts = {
  handover?: {
    cleanup?: {
      status?: string;
      triangles?: { before: number; after: number };
    };
  };
  metrics?: { triangles?: number };
};

export function triangleCounts(artifacts?: TriangleArtifacts) {
  const processed = artifacts?.handover?.cleanup?.triangles;
  if (
    processed &&
    Number.isFinite(processed.before) &&
    Number.isFinite(processed.after)
  )
    return processed;
  const published = artifacts?.metrics?.triangles;
  return Number.isFinite(published) ? { after: published! } : undefined;
}

export function TriangleCount({
  artifacts,
  suffix = false,
  legend = false,
}: {
  artifacts?: TriangleArtifacts;
  suffix?: boolean;
  legend?: boolean;
}) {
  const counts = triangleCounts(artifacts);
  if (!counts) return <>—</>;
  const hasOriginal = "before" in counts;
  const value = hasOriginal
    ? `${counts.before.toLocaleString()} → ${counts.after.toLocaleString()}`
    : counts.after.toLocaleString();
  return (
    <>
      <span
        aria-label={
          hasOriginal
            ? `${counts.before.toLocaleString()} original triangles, ${counts.after.toLocaleString()} published triangles`
            : `${counts.after.toLocaleString()} triangles`
        }
      >
        {value}
        {suffix ? " tris" : ""}
      </span>
      {legend && hasOriginal && <small>original → published</small>}
    </>
  );
}
