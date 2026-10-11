export type ReviewImage = { path: string; label: string; sha256?: string };
export type ReviewEnvelope = {
  buildId: string;
  current: ReviewImage[];
  previous?: ReviewImage[];
  references?: ReviewImage[];
  script?: string;
  parameters: unknown;
  technical: unknown;
  findings: unknown;
};

/** One ordering contract for image transport and the labels seen by a judge. */
export function reviewEvidence(envelope: ReviewEnvelope) {
  const groups = [
    ["current output", envelope.current],
    ["previous output", envelope.previous || []],
    ["reference only", envelope.references || []],
  ] as const;
  const images: string[] = [],
    labels: string[] = [];
  for (const [kind, entries] of groups)
    for (const entry of entries) {
      images.push(entry.path);
      labels.push(
        `Image ${images.length}: ${entry.label} (${kind})${entry.sha256 ? `; sha256=${entry.sha256}` : ""}.`,
      );
    }
  return {
    ...envelope,
    images,
    labels: `Build ${envelope.buildId}.\n${labels.join("\n")}`,
  };
}
