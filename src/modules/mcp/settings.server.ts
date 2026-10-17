import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { mcpAuditEvents, mcpSettings, oauthClients, oauthTokens } from "../../db/schema";
import { getMcpConfig } from "./auth/config.server";
import { DrizzleOAuthStore } from "./auth/oauth-store.server";
import { studioToolCatalog } from "./tools.server";

export type McpPolicy = { enabled: boolean; disabledTools: string[] };
export const defaultMcpPolicy: McpPolicy = { enabled: true, disabledTools: [] };
export const AUDIT_PAGE_SIZE = 25;

export const mcpPolicyInput = z.object({
  enabled: z.boolean(),
  disabledTools: z.array(z.string().max(100)).max(200),
});

export async function loadMcpPolicy(): Promise<McpPolicy> {
  const [row] = await db.select().from(mcpSettings).where(eq(mcpSettings.id, "instance"));
  return row ? { enabled: row.enabled, disabledTools: row.disabledTools } : defaultMcpPolicy;
}

export async function saveMcpPolicy(input: unknown) {
  const parsed = mcpPolicyInput.parse(input);
  const known = new Set(studioToolCatalog().map((tool) => tool.name));
  const policy = { enabled: parsed.enabled, disabledTools: parsed.disabledTools.filter((name) => known.has(name)) };
  await db.insert(mcpSettings).values({ id: "instance", ...policy })
    .onConflictDoUpdate({ target: mcpSettings.id, set: { ...policy, updatedAt: new Date() } });
  return policy;
}

export async function revokeMcpClient(clientId: string) {
  await new DrizzleOAuthStore().revokeClient(clientId);
  await new DrizzleOAuthStore().audit({ event: "client_revoked", outcome: "success", clientId });
}

// Every tool call is audited, so the table is paged instead of tailing a fixed window.
export async function loadMcpAuditPage(page = 0) {
  const safePage = Math.max(0, Math.floor(page));
  const [events, [totals]] = await Promise.all([
    db.select().from(mcpAuditEvents).orderBy(desc(mcpAuditEvents.createdAt), desc(mcpAuditEvents.id))
      .limit(AUDIT_PAGE_SIZE).offset(safePage * AUDIT_PAGE_SIZE),
    db.select({ total: count() }).from(mcpAuditEvents),
  ]);
  return { events, total: Number(totals?.total ?? 0), page: safePage, pageSize: AUDIT_PAGE_SIZE };
}

export async function loadMcpAdminState(request: Request) {
  let endpoint: string | null = null;
  let configurationError: string | null = null;
  try { endpoint = getMcpConfig(request).serverUrl.href; }
  catch (error) { configurationError = (error as Error).message; }
  const [policy, clients, tokens, audit] = await Promise.all([
    loadMcpPolicy(),
    db.select().from(oauthClients).orderBy(desc(oauthClients.createdAt)),
    db.select({ clientId: oauthTokens.clientId, scopes: oauthTokens.scopes }).from(oauthTokens)
      .where(and(isNull(oauthTokens.revokedAt), gt(oauthTokens.accessTokenExpiresAt, new Date()))),
    loadMcpAuditPage(0),
  ]);
  const active = new Map<string, { count: number; scopes: Set<string> }>();
  for (const token of tokens) {
    const entry = active.get(token.clientId) ?? { count: 0, scopes: new Set<string>() };
    entry.count += 1;
    token.scopes.forEach((scope) => entry.scopes.add(scope));
    active.set(token.clientId, entry);
  }
  return {
    configured: endpoint !== null, endpoint, configurationError, policy,
    tools: studioToolCatalog(),
    clients: clients.map((client) => ({
      id: client.id, name: client.name, revokedAt: client.revokedAt, createdAt: client.createdAt,
      activeTokenCount: active.get(client.id)?.count ?? 0, scopes: [...(active.get(client.id)?.scopes ?? [])],
    })),
    audit,
  };
}
