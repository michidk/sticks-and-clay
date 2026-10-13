import { OAuthException } from "@jmondi/oauth2-server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  mcpAuditEvents,
  oauthAuthorizationCodes,
  oauthClients,
  oauthTokens,
  oauthConsentTransactions,
} from "../../../db/mcp-schema";

export type StoredOAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
  revokedAt: Date | null;
};

export type StoredAuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
};

export type StoredOAuthToken = {
  accessTokenId: string;
  clientId: string;
  scopes: string[];
  accessTokenExpiresAt: Date;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: Date | null;
  originatingAuthorizationCode?: string;
  originatingAuthorizationCodeHash?: string | null;
  revokedAt: Date | null;
};

export type OAuthAuditEvent = {
  event: string;
  outcome: "success" | "failure" | "denied";
  clientId?: string;
  toolName?: string;
};

export interface OAuthStore {
  createClient(client: Omit<StoredOAuthClient, "revokedAt">): Promise<void>;
  getClient(id: string): Promise<StoredOAuthClient | null>;
  listClients(): Promise<StoredOAuthClient[]>;
  revokeClient(id: string): Promise<void>;
  saveConsentTransaction(token: string, expiresAt: Date): Promise<void>;
  consumeConsentTransaction(token: string): Promise<boolean>;
  saveAuthorizationCode(code: StoredAuthorizationCode): Promise<void>;
  getAuthorizationCode(
    rawCode: string,
  ): Promise<StoredAuthorizationCode | null>;
  revokeAuthorizationCode(rawCode: string): Promise<void>;
  consumeAuthorizationCode(rawCode: string): Promise<boolean>;
  saveAccessToken(token: StoredOAuthToken): Promise<void>;
  attachRefreshToken(
    accessTokenId: string,
    rawRefreshToken: string,
    expiresAt: Date,
  ): Promise<void>;
  getByRefreshToken(rawRefreshToken: string): Promise<StoredOAuthToken | null>;
  getByAccessToken(accessTokenId: string): Promise<StoredOAuthToken | null>;
  getActiveAccessToken(accessTokenId: string): Promise<StoredOAuthToken | null>;
  revokeToken(accessTokenId: string): Promise<void>;
  consumeRefreshToken(accessTokenId: string): Promise<boolean>;
  revokeTokenFamily(authorizationCodeHash: string): Promise<void>;
  revokeDescendants(rawAuthorizationCode: string): Promise<void>;
  audit(event: OAuthAuditEvent): Promise<void>;
}

export function hashOAuthSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class DrizzleOAuthStore implements OAuthStore {
  async createClient(client: Omit<StoredOAuthClient, "revokedAt">) {
    await db.insert(oauthClients).values({
      id: client.id,
      name: client.name,
      redirectUris: client.redirectUris,
    });
  }

  async getClient(id: string) {
    const [row] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, id));
    return row ?? null;
  }

  async listClients() {
    return db.select().from(oauthClients);
  }

  async revokeClient(id: string) {
    await db.transaction(async (tx) => {
      const revokedAt = new Date();
      await tx
        .update(oauthClients)
        .set({ revokedAt })
        .where(eq(oauthClients.id, id));
      await tx
        .update(oauthAuthorizationCodes)
        .set({ revokedAt })
        .where(eq(oauthAuthorizationCodes.clientId, id));
      await tx
        .update(oauthTokens)
        .set({ revokedAt })
        .where(eq(oauthTokens.clientId, id));
    });
  }

  async saveConsentTransaction(token: string, expiresAt: Date) {
    await db
      .insert(oauthConsentTransactions)
      .values({ tokenHash: hashOAuthSecret(token), expiresAt });
  }

  async consumeConsentTransaction(token: string) {
    const rows = await db
      .update(oauthConsentTransactions)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oauthConsentTransactions.tokenHash, hashOAuthSecret(token)),
          isNull(oauthConsentTransactions.consumedAt),
          gt(oauthConsentTransactions.expiresAt, new Date()),
        ),
      )
      .returning({ tokenHash: oauthConsentTransactions.tokenHash });
    return rows.length === 1;
  }

  async saveAuthorizationCode(code: StoredAuthorizationCode) {
    await db.insert(oauthAuthorizationCodes).values({
      codeHash: hashOAuthSecret(code.code),
      clientId: code.clientId,
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      scopes: code.scopes,
      expiresAt: code.expiresAt,
      revokedAt: code.revokedAt,
    });
  }

  async getAuthorizationCode(rawCode: string) {
    const [row] = await db
      .select()
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.codeHash, hashOAuthSecret(rawCode)));
    return row ? { ...row, code: rawCode } : null;
  }

  async revokeAuthorizationCode(rawCode: string) {
    await db
      .update(oauthAuthorizationCodes)
      .set({ revokedAt: new Date() })
      .where(eq(oauthAuthorizationCodes.codeHash, hashOAuthSecret(rawCode)));
  }

  async consumeAuthorizationCode(rawCode: string) {
    const rows = await db
      .update(oauthAuthorizationCodes)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthAuthorizationCodes.codeHash, hashOAuthSecret(rawCode)),
          isNull(oauthAuthorizationCodes.revokedAt),
          gt(oauthAuthorizationCodes.expiresAt, new Date()),
        ),
      )
      .returning({ codeHash: oauthAuthorizationCodes.codeHash });
    return rows.length === 1;
  }

  async saveAccessToken(token: StoredOAuthToken) {
    const familyHash =
      token.originatingAuthorizationCodeHash ??
      (token.originatingAuthorizationCode
        ? hashOAuthSecret(token.originatingAuthorizationCode)
        : null);
    await db.transaction(async (tx) => {
      const [client] = await tx
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.id, token.clientId))
        .for("update");
      if (!client || client.revokedAt) throw OAuthException.invalidClient();
      if (familyHash) {
        const [family] = await tx
          .select()
          .from(oauthAuthorizationCodes)
          .where(eq(oauthAuthorizationCodes.codeHash, familyHash))
          .for("update");
        if (!family || family.compromisedAt)
          throw OAuthException.invalidGrant(
            "The authorization grant was revoked after replay",
          );
      }
      await tx.insert(oauthTokens).values({
        accessTokenId: token.accessTokenId,
        clientId: token.clientId,
        scopes: token.scopes,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenHash: token.refreshToken
          ? hashOAuthSecret(token.refreshToken)
          : null,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        originatingAuthorizationCodeHash: familyHash,
        revokedAt: token.revokedAt,
      });
    });
  }

  async attachRefreshToken(
    accessTokenId: string,
    rawRefreshToken: string,
    expiresAt: Date,
  ) {
    await db
      .update(oauthTokens)
      .set({
        refreshTokenHash: hashOAuthSecret(rawRefreshToken),
        refreshTokenExpiresAt: expiresAt,
      })
      .where(eq(oauthTokens.accessTokenId, accessTokenId));
  }

  private async tokenWhere(
    where: ReturnType<typeof eq>,
    rawRefreshToken?: string,
  ) {
    const [row] = await db.select().from(oauthTokens).where(where);
    if (!row) return null;
    return {
      ...row,
      refreshToken: rawRefreshToken,
      originatingAuthorizationCodeHash: row.originatingAuthorizationCodeHash,
    };
  }

  getByRefreshToken(rawRefreshToken: string) {
    return this.tokenWhere(
      eq(oauthTokens.refreshTokenHash, hashOAuthSecret(rawRefreshToken)),
      rawRefreshToken,
    );
  }

  getByAccessToken(accessTokenId: string) {
    return this.tokenWhere(eq(oauthTokens.accessTokenId, accessTokenId));
  }

  async getActiveAccessToken(accessTokenId: string) {
    const [row] = await db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.accessTokenId, accessTokenId),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.accessTokenExpiresAt, new Date()),
        ),
      );
    return row
      ? {
          ...row,
          originatingAuthorizationCodeHash:
            row.originatingAuthorizationCodeHash,
        }
      : null;
  }

  async revokeToken(accessTokenId: string) {
    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.accessTokenId, accessTokenId));
  }

  async consumeRefreshToken(accessTokenId: string) {
    const rows = await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthTokens.accessTokenId, accessTokenId),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.refreshTokenExpiresAt, new Date()),
        ),
      )
      .returning({ id: oauthTokens.accessTokenId });
    return rows.length === 1;
  }

  async revokeTokenFamily(authorizationCodeHash: string) {
    await db.transaction(async (tx) => {
      const revokedAt = new Date();
      // The family lock also excludes token issuance after replay was detected.
      await tx
        .update(oauthAuthorizationCodes)
        .set({ compromisedAt: revokedAt })
        .where(eq(oauthAuthorizationCodes.codeHash, authorizationCodeHash));
      await tx
        .update(oauthTokens)
        .set({ revokedAt })
        .where(
          eq(
            oauthTokens.originatingAuthorizationCodeHash,
            authorizationCodeHash,
          ),
        );
    });
  }

  async revokeDescendants(rawAuthorizationCode: string) {
    return this.revokeTokenFamily(hashOAuthSecret(rawAuthorizationCode));
  }

  async audit(event: OAuthAuditEvent) {
    await db.insert(mcpAuditEvents).values(event);
  }
}
