import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
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
        json({ kind: "fork", sourceRunId, name, prompt, judgeIterations: 0 }),
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
        Create variant
      </Button>
      {!open && error && <p role="status">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Graphic variant</DialogTitle>
            <DialogDescription>
              The selected graphic becomes an image-edit reference. A new
              variant preserves the original.
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
            <Textarea
              id={`variant-prompt-${model.id}`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              minLength={3}
              maxLength={12000}
            />
            <Button disabled={busy}>
              {busy ? "Queuing…" : "Generate variant"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
