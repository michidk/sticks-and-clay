import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Progress, StatusBadge } from "@/components/status";

export function ProjectSetup({
  project,
  error,
  retrying,
  onRetry,
}: {
  project: {
    name: string;
    description: string;
    status: string;
    progress: number;
    phase: string;
    error?: string | null;
    assetType?: "model" | "graphic";
  };
  error: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const failed = project.status === "failed" || Boolean(project.error);
  return (
    <main className="project-overview">
      <Breadcrumbs
        items={[
          { label: "Projects", link: { to: "/" } },
          { label: project.name },
        ]}
      />
      <section className="page-header">
        <div>
          <h1>{project.name}</h1>
          <div className="page-meta">
            <StatusBadge status={failed ? "failed" : project.status} />
            <span>
              {project.assetType === "graphic" ? "Graphics" : "3D assets"}
            </span>
          </div>
        </div>
      </section>
      <Card className="panel max-w-3xl" aria-live="polite">
        <h2>
          {failed ? "Design generation failed" : "Generating the design reference"}
        </h2>
        <p className="muted">
          {failed
            ? "The brief is saved. Retry to generate the design reference."
            : "The design reference is written from the brief and references. Review and approve it before generating assets."}
        </p>
        {!failed && (
          <Progress
            value={project.progress}
            label={project.phase || "Preparing"}
            status={project.status}
          />
        )}
        {(error || project.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || project.error}</AlertDescription>
          </Alert>
        )}
        {failed && (
          <Button variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying && <LoaderCircle size={16} className="spin" />}
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
        {project.description && (
          <div className="mt-8 border-t pt-6">
            <h3>Brief</h3>
            <p className="whitespace-pre-wrap">{project.description}</p>
          </div>
        )}
      </Card>
    </main>
  );
}
