export const REVIEW_VIEWS = [
  "front",
  "rear",
  "detail",
  "left",
  "right",
  "top",
  "bottom",
] as const;
export function judgeImageLabels(images: string[], hasTarget: boolean) {
  return (
    images
      .map(
        (key, i) =>
          `Image ${i + 1}: actual render — ${key
            .split("/")
            .pop()
            ?.replace(/\.png$/, "")}`,
      )
      .join("\n") +
    (hasTarget
      ? `\nImage ${images.length + 1}: concept visual target. User references follow.`
      : "\nUser references follow the actual renders; no concept target supplied.")
  );
}
