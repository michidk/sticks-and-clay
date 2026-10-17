import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { json, request } from "@/lib/client";
import { useCallback, useEffect, useState } from "react";

type McpState = {
  endpoint: string | null;
  configurationError: string | null;
  clients: { id: string; name: string; redirectUris: string[]; revokedAt: string | null; createdAt: string }[];
  audit: { id: number; event: string; outcome: string; clientId: string | null; toolName: string | null; createdAt: string }[];
};

export function AiAccess() {
  const [state, setState] = useState<McpState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => request<McpState>("admin/mcp").then(setState).catch((cause) => setError(cause.message)), []);
  useEffect(() => { void load(); }, [load]);

  async function revoke(clientId: string) {
    setError("");
    try { await request("admin/mcp/revoke", json({ clientId })); await load(); }
    catch (cause) { setError((cause as Error).message); }
  }

  if (!state && !error) return <Card className="panel settings-section"><Skeleton className="h-24 w-full" /></Card>;
  const names = new Map(state?.clients.map((client) => [client.id, client.name]));
  return (
    <Card className="panel settings-section">
      <div className="settings-section-heading">
        <h2>AI access</h2>
        <p>Connect ChatGPT, Claude or Codex to this workshop over MCP. Each client is approved with browser OAuth and can be revoked here.</p>
      </div>
      {error && <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>}
      {state?.configurationError && <Alert variant="destructive"><AlertDescription>MCP is not configured: {state.configurationError}</AlertDescription></Alert>}
      {state?.endpoint && <>
        <p>Server URL (paste into ChatGPT's connector settings, or use it with <code>codex mcp add sticks-and-clay --url …</code>):</p>
        <code className="block break-all">{state.endpoint}</code>
        <h3>Connected clients</h3>
        {state.clients.length === 0 && <p>No clients have connected yet.</p>}
        <ul>
          {state.clients.map((client) => (
            <li key={client.id} className="flex items-center justify-between gap-3 py-1">
              <span>{client.name} <small>· {new Date(client.createdAt).toLocaleString()}</small></span>
              {client.revokedAt
                ? <Badge variant="secondary">Revoked</Badge>
                : <Button type="button" variant="outline" size="sm" onClick={() => revoke(client.id)}>Revoke</Button>}
            </li>
          ))}
        </ul>
        <h3>Recent activity</h3>
        {state.audit.length === 0 && <p>No activity yet.</p>}
        <ul>
          {state.audit.map((event) => (
            <li key={event.id}><small>
              {new Date(event.createdAt).toLocaleString()} · {event.toolName ?? event.event} · {event.outcome}
              {event.clientId && ` · ${names.get(event.clientId) ?? "unknown client"}`}
            </small></li>
          ))}
        </ul>
      </>}
    </Card>
  );
}
