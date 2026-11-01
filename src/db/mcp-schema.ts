import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  serial,
  boolean,
} from "drizzle-orm/pg-core";

const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const mcpAuditEvents = pgTable(
  "mcp_audit_events",
  {
    id: serial("id").primaryKey(),
    event: text("event").notNull(),
    outcome: text("outcome").notNull(),
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
