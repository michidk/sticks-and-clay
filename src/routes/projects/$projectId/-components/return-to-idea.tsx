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
import { json, request } from "@/lib/client";

/** Move the same asset back to Ideas while keeping all saved versions. */
export function ReturnToIdea({
  id, name, onDone,
}: {
  id: string;
  name: string;
  noun: "model" | "graphic" | "asset";
  versions?: number;
  /** False while the asset is still generating, which the server would refuse to delete. */
  canDelete?: boolean;
  onDone: (result: { id: string; title: string; deleted: boolean }) => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string; title: string; deleted: boolean }>(
        `asset-versions/${id}/idea`, json({}),
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
        onClick={() => { setError(""); setOpen(true); }}>
        <Lightbulb size={15} />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Return {name} to ideas?</DialogTitle>
            <DialogDescription>
              Moves this asset to Ideas so you can edit its brief and settings. All saved versions and their history remain available.
            </DialogDescription>
          </DialogHeader>
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
