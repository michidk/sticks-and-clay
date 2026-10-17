import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  serial,
  boolean,
} from "drizzle-orm/pg-core";

const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: created(),
});

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    compromisedAt: timestamp("compromised_at", { withTimezone: true }),
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: created(),
  },
  (table) => [index("oauth_authorization_codes_client_idx").on(table.clientId)],
);

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    accessTokenId: text("access_token_id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshTokenHash: text("refresh_token_hash"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    originatingAuthorizationCodeHash: text(
      "originating_authorization_code_hash",
    ),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: created(),
  },
  (table) => [
    uniqueIndex("oauth_tokens_refresh_token_hash_idx").on(
      table.refreshTokenHash,
    ),
    index("oauth_tokens_client_idx").on(table.clientId),
    index("oauth_tokens_authorization_code_idx").on(
      table.originatingAuthorizationCodeHash,
    ),
  ],
);

export const oauthConsentTransactions = pgTable("oauth_consent_transactions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const mcpAuditEvents = pgTable(
  "mcp_audit_events",
  {
    id: serial("id").primaryKey(),
    event: text("event").notNull(),
    outcome: text("outcome").notNull(),
    clientId: text("client_id"),
    toolName: text("tool_name"),
    createdAt: created(),
  },
  (table) => [index("mcp_audit_events_created_at_idx").on(table.createdAt)],
);

export const mcpSettings = pgTable("mcp_settings", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  disabledTools: jsonb("disabled_tools").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
