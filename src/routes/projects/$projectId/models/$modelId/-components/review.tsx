import { fileUrl } from "@/lib/client";
import { reviewImageNumbers } from "../-lib/review-images";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import type { Review } from "../-lib/model";

export function ReviewNotes({
  review,
  renders = [],
}: {
  review?: Review;
  renders?: string[];
}) {
  if (!review)
    return (
      <div className="model-detail-empty">
        <ClipboardCheck size={30} />
        <h3>No review recorded</h3>
        <p>
          This version has no judge feedback yet. A build without judging will
          not receive a judge score.
        </p>
      </div>
    );
  return (
    <div className="model-review-notes">
      <div className="model-review-summary">
        <div className="model-score">
          <strong>{review.score}</strong>
          <span>/ 100</span>
        </div>
        <div>
          <h3>
            {review.passed ? "Review passed" : "Changes requested"} ·{" "}
            {review.improvements?.length || 0} finding
            {review.improvements?.length === 1 ? "" : "s"}
          </h3>
          <p>
            {review.summary
              .split(/(?<=[.!?])\s+/)
              .slice(0, 2)
              .join(" ")}
          </p>
          {!!review.improvements?.length && (
            <p className="review-priorities">
              {Object.entries(
                review.improvements.reduce<Record<string, number>>(
                  (counts, item) => {
                    counts[item.priority] = (counts[item.priority] || 0) + 1;
                    return counts;
                  },
                  {},
                ),
              )
                .map(([priority, count]) => `${count} ${priority}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
      {!!review.improvements?.length && (
        <div className="model-review-items">
          {review.improvements.map((item, index) => (
            <article key={index}>
              <div className="model-review-item-meta">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Badge variant="outline">{item.priority}</Badge>
                {item.view && <span>{item.view}</span>}
              </div>
              <h4>{item.issue}</h4>
              <p>{item.action}</p>
              {!!renders.length && (
                <div className="review-render-links">
                  {reviewImageNumbers(item.view || "", renders.length).map(
                    (number) => (
                      <a
                        key={number}
                        href={fileUrl(renders[number - 1])}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open render {number} ↗
                      </a>
                    ),
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <details className="full-review">
        <summary>Full review</summary>
        <p>{review.summary}</p>
      </details>
      {review.passed && !review.improvements?.length && (
        <p className="model-review-passed">
          <CheckCircle2 size={16} /> No further changes requested.
        </p>
      )}
    </div>
  );
}
