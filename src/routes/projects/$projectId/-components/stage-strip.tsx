import { useEffect, useRef } from "react";
import { boardStages, boardStageTitles, type BoardStage } from "@/lib/board";

const hints: Record<BoardStage, string> = {
  idea: "Write the brief",
  ready: "Start generation",
  progress: "Generating",
  review: "Accept or iterate",
  done: "Ready to export",
};

/** The asset lifecycle as left-to-right steps; the selected step decides which assets are listed. */
export function StageStrip({ stage, counts, attention, onSelect }: {
  stage: BoardStage;
  counts: Record<BoardStage, number>;
  attention: number;
  onSelect: (stage: BoardStage) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // On phones the strip scrolls sideways; keep the pressed stage visible.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [stage]);
  return <div className="stage-strip" role="group" aria-label="Asset stages" ref={strip}>
    {boardStages.map((id) => <button type="button" key={id} aria-pressed={stage === id} onClick={() => onSelect(id)}>
      <strong>{boardStageTitles[id]} <span className="count">{counts[id]}</span></strong>
      {id === "progress" && attention
        ? <small className="attention">{attention === 1 ? "1 needs attention" : `${attention} need attention`}</small>
        : <small>{hints[id]}</small>}
    </button>)}
  </div>;
}
