import { useState } from "react";
import { Archive, ArchiveRestore, LoaderCircle, MoreHorizontal, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { json, request } from "@/lib/client";

/** Archive or unarchive any project; delete only while nothing has been generated. */
export function ProjectActionsMenu({
  project, canDelete, onChanged, onDeleted, className,
}: {
  project: { id: string; name: string; archivedAt?: string | null };
  canDelete: boolean;
  onChanged: () => unknown;
  onDeleted: () => unknown;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const archived = Boolean(project.archivedAt);
  async function run(action: () => Promise<unknown>, done: () => unknown) {
    setBusy(true);
    setError("");
    try {
      await action();
      await done();
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon-sm" className={className}
            aria-label={`Actions for ${project.name}`}>
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={busy}
            onSelect={() => void run(
              () => request(`projects/${project.id}/archive`, json({ archived: !archived })), onChanged)}>
            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {archived ? "Unarchive project" : "Archive project"}
          </DropdownMenuItem>
          {canDelete && (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setError(""); setConfirming(true); }}>
              <Trash2 size={15} /> Delete project…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              This removes the project, its brief, design history and the AI requests recorded
              while setting it up. It cannot be undone. Projects with generated work can only be archived.
            </DialogDescription>
          </DialogHeader>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button variant="destructive" disabled={busy}
              onClick={() => void run(() => request(`projects/${project.id}`, { method: "DELETE" }), onDeleted)}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
