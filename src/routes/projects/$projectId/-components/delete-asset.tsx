import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
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
import { request } from "@/lib/client";

/** Delete a generated asset, with its iterations, behind a confirmation. Its AI request records and costs stay. */
export function DeleteAsset({
  id, name, versions = 1, disabled, onDeleted,
}: {
  id: string;
  name: string;
  versions?: number;
  disabled?: boolean;
  onDeleted: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await request(`models/${id}`, { method: "DELETE" });
      setOpen(false);
      await onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${name}`} disabled={disabled}
        onClick={() => { setError(""); setOpen(true); }}>
        <Trash2 size={15} />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              {versions > 1 ? `This removes the asset and its ${versions} versions from the collection. ` : "This removes the asset from the collection. "}
              Its AI requests stay in Activity, so recorded costs do not change. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />} {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
