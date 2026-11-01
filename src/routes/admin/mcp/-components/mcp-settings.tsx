import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { json, request } from "@/lib/client";
import { Activity, Check, ChevronLeft, ChevronRight, Clipboard } from "lucide-react";
import { useEffect, useState } from "react";

type Tool = { name: string; title: string; description: string; level: string };
type Audit = {
  events: { id: number; event: string; outcome: string; toolName: string | null; createdAt: string }[];
  total: number; page: number; pageSize: number;
};
type State = {
  configured: boolean; endpoint: string | null; configurationError: string | null;
  policy: { enabled: boolean; disabledTools: string[] };
  tools: Tool[];
  audit: Audit;
};

// Each level allows its own tools plus everything below it.
const levels = [
  ["off", "Off", "Reject every MCP request. History is kept."],
  ["read", "Read only", "Assistants can look at projects, assets, renders and costs, but change nothing."],
  ["write", "Read and create", "Also create and generate assets. Spends AI budget and runs Blender."],
  ["admin", "Full access", "Also change models and settings."],
] as const;
type Level = (typeof levels)[number][0];
const order = ["read", "write", "admin"];
const toolLevel = (tool: Tool) => tool.level;
function levelOf(state: State): Level {
  if (!state.policy.enabled) return "off";
  const on = state.tools.filter((tool) => !state.policy.disabledTools.includes(tool.name)).map(toolLevel);
  return ([...order].reverse().find((name) => on.includes(name)) ?? "read") as Level;
}
const when = (value: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function McpSettings() {
  const [state, setState] = useState<State | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const next = await request<State>("mcp-access");
      setState(next); setAudit(next.audit);
    } catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  if (!state) return error
    ? <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>
    : <Card className="panel max-w-5xl" aria-label="Loading MCP"><Skeleton className="mb-3 h-6 w-48" /><Skeleton className="h-40 w-full" /></Card>;

  async function act(task: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); setMessage(done); await load(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const choose = (level: Level) => act(() => request("mcp-access/policy", json({
    enabled: level !== "off",
    disabledTools: state.tools.filter((tool) => order.indexOf(toolLevel(tool)) > order.indexOf(level)).map((tool) => tool.name),
  }, "PUT")), level === "off" ? "MCP is off." : "Access updated. New requests use it immediately.");
  async function copy() {
    if (!state?.endpoint) return;
    await navigator.clipboard.writeText(state.endpoint);
    setCopied(true); window.setTimeout(() => setCopied(false), 2000);
  }
  async function page(next: number) {
    try { setAudit(await request<Audit>(`mcp-access/audit?page=${next}`)); }
    catch (cause) { setError((cause as Error).message); }
  }

  const pages = audit ? Math.max(1, Math.ceil(audit.total / audit.pageSize)) : 1;
  const level = levelOf(state);

  return (
    <div className="settings-stack">
      {error && <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert className="border-[#d3e0bd] bg-[#e5efcf] text-[#466630]"><AlertDescription className="text-inherit">{message}</AlertDescription></Alert>}

      <Card className="panel settings-section">
        <div className="settings-section-heading">
          <h2>Connection</h2>
          <p>Add this URL to Claude Code, Codex or another MCP client (Streamable HTTP, protocol 2026-07-28). There is no sign-in: reach it only over localhost, a firewalled network or a private VPN.</p>
        </div>
        {state.endpoint ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-4 py-3 text-sm">{state.endpoint}</code>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}{copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
        ) : <Alert variant="destructive"><AlertDescription>MCP is not configured: {state.configurationError}</AlertDescription></Alert>}
      </Card>

      <Card className="panel settings-section" role="radiogroup" aria-labelledby="mcp-access">
        <div className="settings-section-heading">
          <h2 id="mcp-access">What assistants can do</h2>
          <p>One setting for every connected assistant. {level !== "off" && `${state.tools.filter((tool) => order.indexOf(toolLevel(tool)) <= order.indexOf(level)).length} of ${state.tools.length} tools are available.`}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {levels.map(([value, title, note]) => (
            <button key={value} type="button" role="radio" aria-checked={level === value} disabled={busy} onClick={() => level !== value && void choose(value)}
              className={cn("rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60",
                level === value && "border-primary bg-primary/5 ring-1 ring-primary")}>
              <span className="flex items-center justify-between font-semibold">{title}{level === value && <Check size={16} className="text-primary" aria-hidden="true" />}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
            </button>
          ))}
        </div>
      </Card>

      <section aria-labelledby="mcp-activity">
        <h2 id="mcp-activity" className="mb-3 flex items-center gap-2 text-lg font-semibold"><Activity className="text-primary" size={20} aria-hidden="true" />Recent activity</h2>
        <Card className="panel overflow-hidden shadow-none">
          {!audit?.total ? <p className="p-5 text-sm text-muted-foreground">No MCP activity yet.</p> : <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">Tool</th><th className="px-4 py-3">Outcome</th></tr>
                </thead>
                <tbody className="divide-y">
                  {audit.events.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{when(event.createdAt)}</td>
                      <td className="px-4 py-3 capitalize">{event.event.replaceAll("_", " ")}</td>
                      <td className="px-4 py-3 font-mono text-xs">{event.toolName ?? "—"}</td>
                      <td className="px-4 py-3"><Badge variant={event.outcome === "success" ? "default" : "destructive"}>{event.outcome}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
              <p aria-live="polite" className="text-xs text-muted-foreground">{audit.page * audit.pageSize + 1}–{Math.min(audit.total, (audit.page + 1) * audit.pageSize)} of {audit.total}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={audit.page === 0} onClick={() => void page(audit.page - 1)}><ChevronLeft size={15} aria-hidden="true" />Newer</Button>
                <Button type="button" variant="outline" size="sm" disabled={audit.page + 1 >= pages} onClick={() => void page(audit.page + 1)}>Older<ChevronRight size={15} aria-hidden="true" /></Button>
              </div>
            </div>}
          </>}
        </Card>
      </section>
    </div>
  );
}
