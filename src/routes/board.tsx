import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Board } from "@/components/board";
import { CardsSkeleton } from "@/components/loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/client";
import type { BoardProject } from "@/lib/board-data";

export const Route = createFileRoute("/board")({ component: GlobalBoard });
function GlobalBoard() {
  const [entries, setEntries] = useState<BoardProject[] | null>(null);
  const [projectId, setProjectId] = useState("all");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const data = await request<{ projects: BoardProject[] }>("board");
    setEntries(data.projects);
    setError("");
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await request<{ projects: BoardProject[] }>("board");
        if (active) { setEntries(data.projects); setError(""); }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "Could not load the board"); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const filtered = entries?.filter((entry) => projectId === "all" || entry.project.id === projectId) ?? [];
  return <main>
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div><h1>Asset board</h1><p className="muted">Ideas, versions and reviews across your projects.</p></div>
      <div className="grid gap-2 min-w-52"><Label htmlFor="board-project">Project</Label>
        <Select value={projectId} onValueChange={setProjectId}><SelectTrigger id="board-project"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {entries?.map(({ project }) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
        </SelectContent></Select>
      </div>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button variant="ghost" size="sm" onClick={() => refresh().catch((error) => setError(error instanceof Error ? error.message : "Could not load the board"))}>Retry</Button></AlertDescription></Alert>}
    {!entries && !error ? <CardsSkeleton label="Loading asset board" count={5} covers={false} /> : <Board projects={filtered} showProjects onRefresh={refresh} />}
    {entries && !entries.length && <p className="muted mt-4">Create a project to start adding assets.</p>}
  </main>;
}
