import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

/** Start a reviewed model from an existing GLB or Blender file. */
export function ImportModel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request(`projects/${projectId}/import`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      setOpen(false);
      await navigate({
        to: "/projects/$projectId/models/$modelId",
        params: { projectId, modelId: result.id },
        search: { view: "3d", section: "review" },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload size={17} /> Import model
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="setup-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Import a model</DialogTitle>
            <DialogDescription>
              Start a reviewed model from a GLB or Blender file. The original
              file is kept; the builder revises a copy against the approved
              design.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="setup-form">
            <div className="setup-fields">
              <div className="grid gap-2">
                <Label htmlFor="import-file">Source file</Label>
                <Input id="import-file" name="file" type="file" accept=".glb,.blend" required disabled={busy} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="import-name">Model name</Label>
                <Input id="import-name" name="name" maxLength={100} required disabled={busy} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="import-prompt">Requested changes</Label>
                <Textarea
                  id="import-prompt"
                  name="prompt"
                  minLength={3}
                  maxLength={12000}
                  rows={4}
                  required
                  disabled={busy}
                  placeholder="What should the builder change or check?"
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter className="setup-footer">
              <DialogClose asChild>
                <Button variant="outline" type="button" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy}>
                {busy && <LoaderCircle size={17} className="spin" />}
                {busy ? "Importing…" : "Import and revise"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
