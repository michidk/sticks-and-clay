import { useState, type FormEvent } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { json, request } from "@/lib/client";

type RenameProps = {
  kind: "project" | "asset";
  name: string;
  endpoint: string;
  onSaved: () => unknown;
};

export function RenameDialog({ kind, name, endpoint, onSaved, onClose }: RenameProps & { onClose: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(endpoint, json({ name: value.trim() }, "PATCH"));
      await onSaved();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not rename ${kind}`);
    } finally {
      setBusy(false);
    }
  }
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
    <DialogContent showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>Rename {kind}</DialogTitle>
        <DialogDescription className="break-words">Choose a new name for {name}.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rename-name">Name</Label>
          <Input id="rename-name" name="name" value={value} onChange={(event) => setValue(event.target.value)} required maxLength={100} disabled={busy} autoFocus onFocus={(event) => event.target.select()} />
        </div>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Cancel</Button></DialogClose>
          <Button type="submit" disabled={busy || !value.trim()}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? "Saving…" : "Save name"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function RenameButton(props: RenameProps) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={`Rename ${props.kind} ${props.name}`} title={`Rename ${props.kind}`} onClick={() => setOpen(true)}><Pencil size={15} /></Button>
    {open && <RenameDialog {...props} onClose={() => setOpen(false)} />}
  </>;
}
