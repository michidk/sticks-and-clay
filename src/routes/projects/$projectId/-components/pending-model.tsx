import {
  Boxes,
  Clock3,
  LoaderCircle,
  CircleAlert,
  Image as ImageIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/progress";
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
  const graphic = assetType === "graphic";
  const Icon = failed
    ? CircleAlert
    : batch.status === "planning"
      ? LoaderCircle
      : Clock3;
  return (
    <Card className="model-card pending-model">
      <div className="model-cover">
        <div className="pending-art">
          <div className="pending-cube">
            {graphic ? (
              <ImageIcon size={48} strokeWidth={1} />
            ) : (
              <Boxes size={48} strokeWidth={1} />
            )}
          </div>
          <span>
            {failed
              ? "Needs attention"
              : batch.status === "planning"
                ? graphic
                  ? "Planning the composition"
                  : "Finding its form"
                : "A new idea is in line"}
          </span>
        </div>
        <Badge variant="secondary" className={"badge " + batch.status}>
          <Icon
            size={12}
            className={batch.status === "planning" ? "spin" : ""}
          />
          {batch.status === "planning"
            ? "Planning"
            : failed
              ? "Failed"
              : "Queued"}
        </Badge>
      </div>
      <div className="project-body">
        <h3>
          {placeholder
            ? `Upcoming ${graphic ? "graphic" : "model"}${
                batch.count > 1 ? ` ${index + 1}` : ""
              }`
            : "Generation needs attention"}
        </h3>
        <p>
          {batch.prompt ||
            `A ${graphic ? "graphic" : "model"} inspired by your project design.`}
        </p>
        <div className="pending-status">
          {failed ? (
            <p role="alert">
              {batch.error || "Generation stopped. Resume to continue."}
            </p>
          ) : (
            <>
              <Progress
                value={batch.status === "queued" ? 0 : 20}
                label={
                  batch.status === "queued"
                    ? "Waiting for the planner"
                    : `Defining the ${graphic ? "graphic" : "model"} brief`
                }
              />
              <small>
                The {graphic ? "graphic" : "model"} name and preview will
                appear here.
              </small>
            </>
          )}
        </div>
        <div className="pending-footer">
          {failed ? (
            <Button variant="outline" disabled={busy} onClick={onResume}>
              Resume generation
            </Button>
          ) : (
            <span>
              <Icon
                size={14}
                className={batch.status === "planning" ? "spin" : ""}
              />
              Updates automatically
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
