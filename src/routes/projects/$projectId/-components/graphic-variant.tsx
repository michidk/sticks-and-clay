import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { request, json } from "@/lib/client";
export function GraphicVariant({
  model,
  sourceRunId,
  onSaved,
}: {
  model: any;
  sourceRunId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(model.name + " variant"),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(
        `models/${model.id}/branch`,
        json({ kind: "fork", sourceRunId, name, prompt, judgeIterations: 2 }),
      );
      setOpen(false);
      void onSaved().catch(() => {
        setError(
          "Variant queued, but refreshing the list failed. Reload to see it.",
        );
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={!sourceRunId}
        onClick={() => setOpen(true)}
      >
        New variant
      </Button>
      {!open && error && <p role="status">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New variant</DialogTitle>
            <DialogDescription>
              Edits this graphic into a new one. The original is kept. Paid
              generation request.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Label htmlFor={`variant-name-${model.id}`}>Name</Label>
            <Input
              id={`variant-name-${model.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
            <Label htmlFor={`variant-prompt-${model.id}`}>
              Requested change
            </Label>
            <MarkdownTextarea
              id={`variant-prompt-${model.id}`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              minLength={3}
              maxLength={12000}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy}>
                {busy ? "Queuing…" : "Generate variant"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
