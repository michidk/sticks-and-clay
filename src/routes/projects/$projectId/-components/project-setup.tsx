import { Link } from "@tanstack/react-router";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/progress";

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
  };
  error: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const failed = project.status === "failed" || Boolean(project.error);
  return (
    <main className="project-overview">
      <Link to="/" className="back">
        <ArrowLeft size={15} />
        All projects
      </Link>
      <div className="eyebrow">PROJECT SETUP</div>
      <h1>{project.name}</h1>
      <Card className="panel mx-auto my-8 w-full max-w-3xl" aria-live="polite">
        <h2>
          {failed
            ? "Design setup needs attention"
            : "Creating your design specs"}
        </h2>
        <p className="muted">
          {failed
            ? "Your brief is saved. Retry to finish creating your design specs."
            : "We’re turning your brief and references into a shared visual direction. You’ll review and edit the specs before generating models."}
        </p>
        {!failed && (
          <Progress
            value={project.progress}
            label={project.phase || "Preparing design specs"}
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
            {retrying ? "Restarting…" : "Retry design setup"}
          </Button>
        )}
        <div className="mt-8 border-t pt-6">
          <h3>Your brief</h3>
          <p className="whitespace-pre-wrap">{project.description}</p>
        </div>
      </Card>
    </main>
  );
}
