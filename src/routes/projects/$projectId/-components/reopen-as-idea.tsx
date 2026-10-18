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

/** Create a new idea from this asset's brief and settings; the asset itself is left as it is. */
export function ReopenAsIdea({
  id, name, onDone,
}: {
  id: string;
  name: string;
  onDone: (result: { id: string; title: string | null }) => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string; title: string | null }>(
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
      <Button variant="ghost" size="icon-sm" aria-label={`Reopen ${name} as a new idea`} title="Reopen as new idea"
        onClick={() => { setError(""); setOpen(true); }}>
        <Lightbulb size={15} />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle className="pr-6">Reopen {name} as a new idea?</DialogTitle>
            <DialogDescription>
              Creates a new idea from this asset’s brief, settings and references so you can edit it and generate again. This asset, its versions and any running generation stay as they are.
            </DialogDescription>
          </DialogHeader>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button disabled={busy} onClick={() => void submit()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Lightbulb size={15} />} {busy ? "Reopening…" : "Reopen as new idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
