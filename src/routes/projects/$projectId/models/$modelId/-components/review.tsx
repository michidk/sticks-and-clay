import { reviewImageNumbers } from "../-lib/review-images";
import { AssetImage } from "@/components/asset-image";
import { useLightbox } from "@/components/image-lightbox";
import { renderGallery } from "./media";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleAlert, ClipboardCheck } from "lucide-react";
import type { Review } from "../-lib/model";

/** Map judge priorities onto the shared status badge colors. */
export function priorityClass(priority: string) {
  const value = priority.toLowerCase();
  if (/critical|blocker|severe/.test(value)) return "failed";
  if (/major|high/.test(value)) return "warning";
  return "";
}

export function ReviewNotes({
  review,
  renders = [],
}: {
  review?: Review;
  renders?: string[];
}) {
  const openLightbox = useLightbox();
  const gallery = renderGallery(renders);
  if (!review)
    return (
      <div className="model-detail-empty">
        <ClipboardCheck size={30} />
        <h3>No review recorded</h3>
        <p>
          This build has no judge feedback yet. A build without judging will
          not receive a judge score.
        </p>
      </div>
    );
  const findings = review.improvements || [];
  const severities = Object.entries(
    findings.reduce<Record<string, number>>((counts, item) => {
      counts[item.priority] = (counts[item.priority] || 0) + 1;
      return counts;
    }, {}),
  );
  return (
    <div
      className={"review-notes " + (review.passed ? "is-passed" : "is-changes")}
    >
      <header className="review-verdict">
        <div className="review-score">
          <strong>{review.score}</strong>
          <span>/ 100</span>
        </div>
        <div>
          <h3>
            {review.passed ? (
              <CheckCircle2 size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            {review.passed ? "Review passed" : "Changes requested"}
          </h3>
          <div className="review-severities">
            <span>
              {findings.length} finding{findings.length === 1 ? "" : "s"}
            </span>
            {severities.map(([priority, count]) => (
              <Badge
                key={priority}
                variant="secondary"
                className={"badge " + priorityClass(priority)}
              >
                {count} {priority}
              </Badge>
            ))}
          </div>
        </div>
      </header>
      <p className="review-summary">
        {review.summary
          .split(/(?<=[.!?])\s+/)
          .slice(0, 2)
          .join(" ")}
      </p>
      {!!findings.length && (
        <ol className="review-findings" aria-label="Review findings">
          {findings.map((item, index) => {
            const numbers = renders.length
              ? reviewImageNumbers(item.view || "", renders.length)
              : [];
            return (
              <li key={index}>
                <div className="review-finding-head">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <Badge
                    variant="secondary"
                    className={"badge " + priorityClass(item.priority)}
                  >
                    {item.priority}
                  </Badge>
                </div>
                <h4>{item.issue}</h4>
                <p>{item.action}</p>
                {(item.view || numbers.length > 0) && (
                  <div className="review-finding-where">
                    {numbers.length > 0 && (
                      <div className="review-thumbs">
                        {numbers.map((number) => (
                          <button
                            type="button"
                            key={number}
                            aria-label={`View render ${number} full size`}
                            onClick={() => openLightbox(gallery, number - 1)}
                          >
                            <AssetImage
                              src={gallery[number - 1].src}
                              alt=""
                              loading="lazy"
                            />
                            <span aria-hidden="true">{number}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {item.view && <p>{item.view}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {review.passed && !findings.length && (
        <p className="model-review-passed">
          <CheckCircle2 size={16} /> No further changes requested.
        </p>
      )}
      <details className="full-review">
        <summary>Full review</summary>
        <p>{review.summary}</p>
      </details>
    </div>
  );
}
