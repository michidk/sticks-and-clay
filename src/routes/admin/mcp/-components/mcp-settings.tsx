import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { json, request } from "@/lib/client";
import { Activity, Bot, Check, ChevronLeft, ChevronRight, Clipboard, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Tool = { name: string; title: string; description: string; scope: string };
type Audit = {
  events: { id: number; event: string; outcome: string; clientId: string | null; toolName: string | null; createdAt: string }[];
  total: number; page: number; pageSize: number;
};
type State = {
  configured: boolean; endpoint: string | null; configurationError: string | null;
  policy: { enabled: boolean; disabledTools: string[] };
  tools: Tool[];
  clients: { id: string; name: string; revokedAt: string | null; createdAt: string; activeTokenCount: number; scopes: string[] }[];
  audit: Audit;
};

const groups = [
  ["sticks-and-clay:read", "Read", "Read projects and assets"],
  ["sticks-and-clay:write", "Create and change", "Spends AI budget and runs Blender"],
  ["sticks-and-clay:admin", "Manage", "Models, settings and clients"],
] as const;
const when = (value: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function McpSettings() {
  const [state, setState] = useState<State | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [disabled, setDisabled] = useState(new Set<string>());
  const [audit, setAudit] = useState<Audit | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const next = await request<State>("admin/mcp");
      setState(next); setEnabled(next.policy.enabled);
      setDisabled(new Set(next.policy.disabledTools)); setAudit(next.audit);
    } catch (cause) { setError((cause as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  const clients = useMemo(() => state?.clients.filter((client) => showRevoked || !client.revokedAt) ?? [], [state, showRevoked]);
  if (!state) return error
    ? <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>
    : <Card className="panel max-w-5xl" aria-label="Loading AI access"><Skeleton className="mb-3 h-6 w-48" /><Skeleton className="h-40 w-full" /></Card>;

  async function act(task: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); setMessage(done); await load(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const save = () => act(() => request("admin/mcp/policy", json({ enabled, disabledTools: [...disabled] }, "PUT")),
    "AI access saved. New requests use it immediately.");
  const revoke = (id: string, name: string) => {
    if (window.confirm(`Revoke access for “${name}”? Its tokens stop working immediately.`))
      void act(() => request("admin/mcp/revoke", json({ clientId: id })), `${name} was revoked.`);
  };
  const toggle = (name: string, on: boolean) => setDisabled((current) => {
    const next = new Set(current); if (on) next.delete(name); else next.add(name); return next;
  });
  async function copy() {
    if (!state?.endpoint) return;
    await navigator.clipboard.writeText(state.endpoint);
    setCopied(true); window.setTimeout(() => setCopied(false), 2000);
  }
  async function page(next: number) {
    try { setAudit(await request<Audit>(`admin/mcp/audit?page=${next}`)); }
    catch (cause) { setError((cause as Error).message); }
  }

  const revokedCount = state.clients.filter((client) => client.revokedAt).length;
  const pages = audit ? Math.max(1, Math.ceil(audit.total / audit.pageSize)) : 1;
  const stats = [
    [Bot, "Server", !state.configured ? "Not configured" : enabled ? "Available" : "Paused"],
    [KeyRound, "Clients", String(state.clients.filter((client) => !client.revokedAt).length)],
    [ShieldCheck, "Enabled tools", `${state.tools.length - disabled.size}/${state.tools.length}`],
  ] as const;

  return (
    <div className="settings-stack">
      {error && <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert className="border-[#d3e0bd] bg-[#e5efcf] text-[#466630]"><AlertDescription className="text-inherit">{message}</AlertDescription></Alert>}

      <div className="grid gap-3 md:grid-cols-3">
        {stats.map(([Icon, label, value]) => (
          <Card key={label} className="panel flex-row items-center gap-3 p-4 shadow-none">
            <Icon className="text-primary" size={22} aria-hidden="true" />
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>
          </Card>
        ))}
      </div>

      <Card className="panel settings-section">
        <div className="settings-section-heading">
          <h2>Connection</h2>
          <p>Add this URL as a custom connector in ChatGPT, or to Claude Code and Codex, and choose OAuth. You approve each client in the browser.</p>
        </div>
        {state.endpoint ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-4 py-3 text-sm">{state.endpoint}</code>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}{copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
        ) : <Alert variant="destructive"><AlertDescription>MCP is not configured: {state.configurationError}</AlertDescription></Alert>}
        <label htmlFor="mcp-enabled" className="mt-4 flex items-center justify-between gap-4 rounded-lg border p-4">
          <span>
            <strong className="block">Enable MCP access</strong>
            <span className="block text-sm text-muted-foreground">Pausing rejects every MCP and OAuth request without deleting clients or history.</span>
          </span>
          <Switch id="mcp-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </label>
      </Card>

      <section aria-labelledby="mcp-tools">
        <div className="mb-3">
          <h2 id="mcp-tools" className="text-lg font-semibold">Available tools</h2>
          <p className="text-sm text-muted-foreground">Disabled tools disappear from MCP discovery. OAuth scopes are a second, per-client boundary.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {groups.map(([scope, title, note]) => (
            <Card key={scope} className="panel settings-section">
              <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><Badge variant="outline">{note}</Badge></div>
              <div className="divide-y">
                {state.tools.filter((tool) => tool.scope === scope).map((tool) => (
                  <label key={tool.name} htmlFor={`tool-${tool.name}`} className="flex items-start justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{tool.title}</span>
                      <code className="block truncate text-xs text-primary">{tool.name}</code>
                      <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground" title={tool.description}>{tool.description}</span>
                    </span>
                    <Switch id={`tool-${tool.name}`} checked={!disabled.has(tool.name)} onCheckedChange={(on) => toggle(tool.name, on)} />
                  </label>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <Button type="button" className="mt-4" disabled={busy} onClick={() => void save()}>Save AI access</Button>
      </section>

      <section aria-labelledby="mcp-clients">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="mcp-clients" className="text-lg font-semibold">Connected clients</h2>
            <p className="text-sm text-muted-foreground">Revoking a client invalidates its access and refresh tokens immediately.</p>
          </div>
          {revokedCount > 0 && <label htmlFor="mcp-revoked" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch id="mcp-revoked" checked={showRevoked} onCheckedChange={setShowRevoked} />Show {revokedCount} revoked
          </label>}
        </div>
        <Card className="panel overflow-hidden shadow-none">
          {clients.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{state.clients.length ? "Every client is revoked." : "No MCP clients have connected yet."}</p> : (
            <ul className="divide-y">
              {clients.map((client) => (
                <li key={client.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{client.name}</span>
                  {client.scopes.map((scope) => <Badge key={scope} variant="outline">{scope.replace("sticks-and-clay:", "")}</Badge>)}
                  <Badge variant={client.revokedAt ? "secondary" : "default"}>{client.revokedAt ? "Revoked" : `${client.activeTokenCount} token${client.activeTokenCount === 1 ? "" : "s"}`}</Badge>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{when(client.createdAt)}</span>
                  {!client.revokedAt && <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => revoke(client.id, client.name)}><Trash2 size={15} aria-hidden="true" />Revoke</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

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
