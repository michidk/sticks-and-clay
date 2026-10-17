import { useState } from "react";
import { Lightbulb, LoaderCircle } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { json, request } from "@/lib/client";

/** Turn a generated asset back into a new idea, optionally deleting the asset in the same step. */
export function ReturnToIdea({
  id, name, noun, versions = 1, canDelete = true, onDone,
}: {
  id: string;
  name: string;
  noun: "model" | "graphic";
  versions?: number;
  /** False while the asset is still generating, which the server would refuse to delete. */
  canDelete?: boolean;
  onDone: (result: { id: string; title: string; deleted: boolean }) => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [deleteModel, setDeleteModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string; title: string; deleted: boolean }>(
        `models/${id}/idea`, json({ deleteModel: deleteModel && canDelete }),
      );
      setOpen(false);
      await onDone(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Return ${name} to ideas`} title="Return to ideas"
        onClick={() => { setError(""); setDeleteModel(false); setOpen(true); }}>
        <Lightbulb size={15} />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Return {name} to ideas?</DialogTitle>
            <DialogDescription>
              Creates a new idea with the brief and settings this {noun} was started from, so you can edit
              and start it again. The {noun} stays in the collection unless you delete it below.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <div className="flex items-center gap-2">
              <input id={`return-delete-${id}`} type="checkbox" className="workshop-checkbox" checked={deleteModel && canDelete}
                disabled={busy || !canDelete} onChange={(event) => setDeleteModel(event.target.checked)} />
              <Label htmlFor={`return-delete-${id}`}>
                Also delete this {noun}{versions > 1 ? ` and its ${versions} versions` : ""}
              </Label>
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              {canDelete
                ? "Deleting cannot be undone. Its AI requests stay in Activity, so recorded costs do not change."
                : `Deleting is available once this ${noun} has finished generating.`}
            </p>
          </div>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button disabled={busy} onClick={() => void submit()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Lightbulb size={15} />} {busy ? "Returning…" : "Return to ideas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
