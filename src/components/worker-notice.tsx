import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription } from "./ui/alert";

/** Shown when queued or running work exists but the worker heartbeat is stale. */
export function WorkerNotice() {
  return (
    <Alert className="mb-4">
      <AlertDescription>
        <p>
          Generation is paused: the worker is not running, so queued and running
          work will not advance until it is started.{" "}
          <Link to="/admin/diagnostics" className="underline">
            Check diagnostics
          </Link>
          .
        </p>
      </AlertDescription>
    </Alert>
  );
}
