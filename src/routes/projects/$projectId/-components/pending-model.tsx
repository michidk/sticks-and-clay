import { Boxes, Image as ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Progress, StatusBadge } from "@/components/status";
import type { PendingBatch } from "../-lib/collection";
export function PendingModel({
  batch,
  index,
  placeholder,
  busy,
  onResume,
  assetType,
}: {
  batch: PendingBatch;
  index: number;
  placeholder: boolean;
  busy: boolean;
  onResume: () => void;
  assetType: "model" | "graphic";
}) {
  const failed = batch.status === "failed";
  const noun = assetType === "graphic" ? "graphic" : "model";
  if (!placeholder) {
    return (
      <Alert variant="destructive" className="mt-6">
        <AlertTitle>Collection processing needs attention</AlertTitle>
        <AlertDescription>
          <p>Processing stopped after the {noun}s were created.</p>
          <p>{batch.prompt}</p>
          <details className="w-full min-w-0">
            <summary className="cursor-pointer">Error details</summary>
            <p className="break-all">
              {batch.error || "Generation stopped before this batch finished."}
            </p>
          </details>
          <Button variant="outline" disabled={busy} onClick={onResume}>
            Resume processing
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Card className="model-card pending-model">
      <div className="model-cover">
        <div className="abstract">
          {assetType === "graphic" ? (
            <ImageIcon size={44} strokeWidth={1} />
          ) : (
            <Boxes size={44} strokeWidth={1} />
          )}
        </div>
        <StatusBadge status={batch.status}>
          {batch.status === "planning"
            ? "Planning"
            : failed
              ? "Failed"
              : "Queued"}
        </StatusBadge>
      </div>
      <div className="project-body">
        <h3>
          {`${noun[0].toUpperCase() + noun.slice(1)}${batch.count > 1 ? ` ${index + 1} of ${batch.count}` : ""}`}
        </h3>
        <p>{batch.prompt || `Proposed by AI from the design reference.`}</p>
        {failed ? (
          <Alert variant="destructive" className="error">
            <AlertDescription>
              {batch.error || "Generation stopped before this batch finished."}
            </AlertDescription>
          </Alert>
        ) : (
          <Progress
            value={batch.status === "queued" ? 0 : 20}
            status={batch.status}
            label={
              batch.status === "queued"
                ? "Waiting for the planner"
                : `Planning the ${noun} brief`
            }
          />
        )}
        <div className="card-meta">
          <span>
            {failed ? "Resume to continue" : `Name and preview appear here`}
          </span>
        </div>
        {failed && (
          <div className="card-actions">
            <Button variant="outline" disabled={busy} onClick={onResume}>
              Resume batch
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
