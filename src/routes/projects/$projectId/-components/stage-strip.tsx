import { useEffect, useRef } from "react";
import type { BoardStage } from "@/lib/board";

export const stageHints: Record<BoardStage, string> = {
  idea: "Write the brief",
  ready: "Start generation",
  progress: "Generating",
  review: "Accept or iterate",
  done: "Ready to export",
};

/** What a stage means, shown above its list. */
export const stageMeanings: Record<BoardStage, string> = {
  idea: "The brief can still be developed. Returning an asset here keeps its versions.",
  ready: "You marked the brief ready. This does not start paid work.",
  progress: "Generation is queued, running, waiting for a visual target decision, or needs recovery.",
  review: "The latest version finished and waits for your decision.",
  done: "You accepted the finished version.",
};

/** The project workflow as left-to-right steps; the pressed step is the open view. */
export function StageStrip<Id extends string>({ steps, current, onSelect }: {
  steps: { id: Id; title: string; hint: string; count?: number; warn?: boolean }[];
  current: string;
  onSelect: (id: Id) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // On phones the strip scrolls sideways; keep the pressed step visible.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  return <div className="stage-strip" role="group" aria-label="Project workflow" ref={strip}>
    {steps.map((step) => <button type="button" key={step.id} aria-pressed={current === step.id} onClick={() => onSelect(step.id)}>
      <strong>{step.title} {!!step.count && <span className="count">{step.count}</span>}</strong>
      <small className={step.warn ? "attention" : undefined}>{step.hint}</small>
    </button>)}
  </div>;
}
