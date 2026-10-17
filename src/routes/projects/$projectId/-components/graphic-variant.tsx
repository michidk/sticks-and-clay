import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
/** Fork into another asset, or create a new version of this asset. */
export function GraphicVariant({
  model,
  sourceRunId,
  onSaved,
  kind = "fork",
}: {
  model: any;
  sourceRunId?: string;
  onSaved: () => Promise<unknown>;
  kind?: "fork" | "iterate";
}) {
  const iterate = kind === "iterate";
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
        `asset-versions/${model.id}/branch`,
        json({ kind, sourceRunId, ...(iterate ? {} : { name }), prompt, judgeIterations: 2 }),
      );
      setOpen(false);
      void onSaved().catch(() => {
        setError(
          `${iterate ? "Version" : "Asset"} queued, but refreshing the list failed. Reload to see it.`,
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
        size={iterate ? "sm" : undefined}
        disabled={!sourceRunId}
        onClick={() => setOpen(true)}
      >
        {iterate ? "Iterate" : "Fork asset"}
      </Button>
      {!open && error && <p role="status">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{iterate ? "Iterate" : "Fork asset"}</DialogTitle>
            <DialogDescription>
              {iterate
                ? "Creates a new version of this asset that returns to Review. The current version is kept. Paid generation request."
                : "Creates a separate asset from this saved build. The original asset and its history are kept. Paid generation request."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!iterate && <>
              <Label htmlFor={`variant-name-${model.id}`}>Name</Label>
              <Input
                id={`variant-name-${model.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </>}
            <Label htmlFor={`variant-prompt-${model.id}-${kind}`}>
              Requested change
            </Label>
            <Textarea
              id={`variant-prompt-${model.id}-${kind}`}
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
                {busy ? "Queuing…" : iterate ? "Generate version" : "Create asset"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
