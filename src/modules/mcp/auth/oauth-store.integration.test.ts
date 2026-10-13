import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  oauthClients,
  oauthAuthorizationCodes,
  oauthTokens,
  oauthConsentTransactions,
} from "../../../db/mcp-schema";
import { DrizzleOAuthStore, hashOAuthSecret } from "./oauth-store.server";

describe.skipIf(process.env.TEST_DATABASE !== "1")(
  "durable OAuth store",
  () => {
    const store = new DrizzleOAuthStore();
    let clientId: string;
    let code: string;
    let consent: string;
    const future = () => new Date(Date.now() + 600_000);
    beforeEach(async () => {
      clientId = randomUUID();
      code = randomUUID();
      consent = randomUUID();
      await store.createClient({
        id: clientId,
        name: "OAuth integration fixture",
        redirectUris: ["http://127.0.0.1/callback"],
      });
      await store.saveAuthorizationCode({
        code,
        clientId,
        redirectUri: "http://127.0.0.1/callback",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        scopes: ["sticks-and-clay:read"],
        expiresAt: future(),
        revokedAt: null,
      });
    });
    afterEach(async () => {
      await db.delete(oauthClients).where(eq(oauthClients.id, clientId));
      await db
        .delete(oauthConsentTransactions)
        .where(
          eq(oauthConsentTransactions.tokenHash, hashOAuthSecret(consent)),
        );
    });

    test("secrets persist only as hashes and consent/code/refresh consume atomically", async () => {
      const [savedCode] = await db
        .select()
        .from(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.clientId, clientId));
      expect(savedCode?.codeHash).toBe(hashOAuthSecret(code));
      await store.saveConsentTransaction(consent, future());
      expect(
        (
          await Promise.all([
            store.consumeConsentTransaction(consent),
            store.consumeConsentTransaction(consent),
          ])
        ).sort(),
      ).toEqual([false, true]);
      expect(
        (
          await Promise.all([
            store.consumeAuthorizationCode(code),
            store.consumeAuthorizationCode(code),
          ])
        ).sort(),
      ).toEqual([false, true]);
      const accessTokenId = randomUUID();
      const refresh = randomUUID();
      await store.saveAccessToken({
        accessTokenId,
        clientId,
        scopes: ["sticks-and-clay:read"],
        accessTokenExpiresAt: future(),
        originatingAuthorizationCode: code,
        revokedAt: null,
      });
      await store.attachRefreshToken(accessTokenId, refresh, future());
      const [savedToken] = await db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.accessTokenId, accessTokenId));
      expect(savedToken?.refreshTokenHash).toBe(hashOAuthSecret(refresh));
      expect(savedToken?.originatingAuthorizationCodeHash).toBe(
        hashOAuthSecret(code),
      );
      expect(JSON.stringify(savedToken)).not.toContain(refresh);
      expect(
        (
          await Promise.all([
            store.consumeRefreshToken(accessTokenId),
            store.consumeRefreshToken(accessTokenId),
          ])
        ).sort(),
      ).toEqual([false, true]);
    });

    test("revoked families and clients cannot acquire late descendants", async () => {
      const accessTokenId = randomUUID();
      const grant = {
        accessTokenId,
        clientId,
        scopes: ["sticks-and-clay:read"],
        accessTokenExpiresAt: future(),
        originatingAuthorizationCode: code,
        revokedAt: null,
      };
      await Promise.allSettled([
        store.saveAccessToken(grant),
        store.revokeTokenFamily(hashOAuthSecret(code)),
      ]);
      expect(await store.getActiveAccessToken(accessTokenId)).toBeNull();
      await expect(
        store.saveAccessToken({ ...grant, accessTokenId: randomUUID() }),
      ).rejects.toThrow("revoked");
      await store.revokeClient(clientId);
      await expect(
        store.saveAccessToken({
          ...grant,
          accessTokenId: randomUUID(),
          originatingAuthorizationCode: undefined,
        }),
      ).rejects.toThrow();
      expect((await store.getClient(clientId))?.revokedAt).toBeInstanceOf(Date);
    });
  },
);
