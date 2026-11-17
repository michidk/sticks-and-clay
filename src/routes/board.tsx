import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Board } from "@/components/board";
import { CardsSkeleton } from "@/components/loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/client";
import type { BoardProject } from "@/lib/board-data";

export const Route = createFileRoute("/board")({
  validateSearch: z.object({ projectId: z.string().uuid().optional().catch(undefined) }),
  component: GlobalBoard,
});
function GlobalBoard() {
  const [entries, setEntries] = useState<BoardProject[] | null>(null);
  const { projectId } = Route.useSearch();
  const navigate = Route.useNavigate();
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
  const filtered = entries?.filter((entry) => !projectId || entry.project.id === projectId) ?? [];
  return <main>
    <section className="page-header">
      <div><h1>Board</h1><p className="muted">Ideas, versions and reviews across your projects.</p></div>
      <div className="page-actions board-filter"><Label htmlFor="board-project">Project</Label>
        <Select value={projectId ?? "all"} onValueChange={(value) => void navigate({ search: { projectId: value === "all" ? undefined : value } })}><SelectTrigger id="board-project"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {entries?.map(({ project }) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
        </SelectContent></Select>
      </div>
    </section>
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button variant="ghost" size="sm" onClick={() => refresh().catch((error) => setError(error instanceof Error ? error.message : "Could not load the board"))}>Retry</Button></AlertDescription></Alert>}
    {!entries && !error ? <CardsSkeleton label="Loading board" count={5} covers={false} /> : <Board projects={filtered} showProjects onRefresh={refresh} />}
    {entries && !entries.length && <Empty className="empty">
      <EmptyHeader>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>Create a project to start adding assets.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button variant="outline" asChild><Link to="/projects">Go to projects</Link></Button></EmptyContent>
    </Empty>}
  </main>;
}
