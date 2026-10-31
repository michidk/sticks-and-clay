import { RenameDialog } from "@/components/rename";
import { useState } from "react";
import { Archive, ArchiveRestore, LoaderCircle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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

/** Project visibility and permanent deletion, with explicit confirmation. */
export function ProjectActionsMenu({
  project, onChanged, onDeleted, className,
}: {
  project: { id: string; name: string; archivedAt?: string | null };
  onChanged: () => unknown;
  onDeleted: () => unknown;
  className?: string;
}) {
  const [renaming, setRenaming] = useState(false);
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
          <DropdownMenuItem disabled={busy} onSelect={() => setRenaming(true)}><Pencil size={15} /> Rename project…</DropdownMenuItem>
          <DropdownMenuItem disabled={busy}
            onSelect={() => void run(
              () => request(`projects/${project.id}/archive`, json({ archived: !archived })), onChanged)}>
            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {archived ? "Unarchive project" : "Archive project"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} className="text-destructive focus:text-destructive" onSelect={() => { setError(""); setConfirming(true); }}>
            <Trash2 size={15} /> Delete project…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && !confirming && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {renaming && <RenameDialog kind="project" name={project.name} endpoint={`projects/${project.id}`} onSaved={onChanged} onClose={() => setRenaming(false)} />}
      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the project, all assets and versions, generated files,
              references, design history and recorded AI requests. Any generation in progress
              will be stopped first. Files shared with other projects are kept. This cannot be undone.
              Archive the project instead to keep its resources.
            </DialogDescription>
          </DialogHeader>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button variant="destructive" disabled={busy}
              onClick={() => void run(async () => {
                let pending = true;
                while (pending) {
                  const result = await request<{ pending: boolean }>(`projects/${project.id}`, { method: "DELETE" });
                  pending = result.pending;
                  if (pending) await new Promise((resolve) => setTimeout(resolve, 1000));
                }
              }, onDeleted)}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
              {busy ? "Deleting project…" : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
