DROP TABLE "oauth_authorization_codes" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_clients" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_consent_transactions" CASCADE;--> statement-breakpoint
DROP TABLE "oauth_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_audit_events" DROP COLUMN "client_id";