import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OAuthException } from "@jmondi/oauth2-server";
import { SignJWT } from "jose";
import { MCP_SCOPE_VALUES } from "../catalog";
import { createLocalTokenVerifier, getOAuthSigningKey } from "./auth.server";
import { resolveMcpConfig } from "./config.server";
import { createOAuthHttpHandler, scopeInputName } from "./oauth-http.server";
import {
  hashOAuthSecret,
  type OAuthStore,
  type StoredOAuthClient,
  type StoredAuthorizationCode,
  type StoredOAuthToken,
  type OAuthAuditEvent,
} from "./oauth-store.server";

class MemoryOAuthStore implements OAuthStore {
  clients = new Map<string, StoredOAuthClient>();
  codes = new Map<string, StoredAuthorizationCode>();
  tokens = new Map<string, StoredOAuthToken>();
  compromised = new Set<string>();
  consents = new Map<string, { expiry: Date; consumed: boolean }>();
  audits: OAuthAuditEvent[] = [];
  async createClient(client: Omit<StoredOAuthClient, "revokedAt">) {
    this.clients.set(client.id, { ...client, revokedAt: null });
  }
  async getClient(id: string) {
    return this.clients.get(id) ?? null;
  }
  async listClients() {
    return [...this.clients.values()];
  }
  async revokeClient(id: string) {
    const client = this.clients.get(id);
    if (client) client.revokedAt = new Date();
    for (const token of this.tokens.values())
      if (token.clientId === id) token.revokedAt = new Date();
    for (const code of this.codes.values())
      if (code.clientId === id) code.revokedAt = new Date();
  }
  async saveConsentTransaction(token: string, expiry: Date) {
    this.consents.set(hashOAuthSecret(token), { expiry, consumed: false });
  }
  async consumeConsentTransaction(token: string) {
    const consent = this.consents.get(hashOAuthSecret(token));
    if (!consent || consent.consumed || consent.expiry <= new Date())
      return false;
    consent.consumed = true;
    return true;
  }
  async saveAuthorizationCode(code: StoredAuthorizationCode) {
    this.codes.set(hashOAuthSecret(code.code), structuredClone(code));
  }
  async getAuthorizationCode(code: string) {
    return this.codes.get(hashOAuthSecret(code)) ?? null;
  }
  async revokeAuthorizationCode(code: string) {
    const stored = await this.getAuthorizationCode(code);
    if (stored) stored.revokedAt = new Date();
  }
  async consumeAuthorizationCode(code: string) {
    const stored = this.codes.get(hashOAuthSecret(code));
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date())
      return false;
    stored.revokedAt = new Date();
    return true;
  }
  async saveAccessToken(token: StoredOAuthToken) {
    if (
      !this.clients.has(token.clientId) ||
      this.clients.get(token.clientId)?.revokedAt
    )
      throw OAuthException.invalidClient();
    const familyHash =
      token.originatingAuthorizationCodeHash ??
      (token.originatingAuthorizationCode
        ? hashOAuthSecret(token.originatingAuthorizationCode)
        : null);
    if (familyHash && this.compromised.has(familyHash))
      throw OAuthException.invalidGrant(
        "The authorization grant was revoked after replay",
      );
    this.tokens.set(token.accessTokenId, {
      ...structuredClone(token),
      originatingAuthorizationCodeHash: familyHash,
    });
  }
  async attachRefreshToken(id: string, refreshToken: string, expiresAt: Date) {
    const token = this.tokens.get(id);
    if (token)
      Object.assign(token, { refreshToken, refreshTokenExpiresAt: expiresAt });
  }
  async getByRefreshToken(refresh: string) {
    return (
      [...this.tokens.values()].find(
        (token) => token.refreshToken === refresh,
      ) ?? null
    );
  }
  async getByAccessToken(id: string) {
    const token = this.tokens.get(id);
    return token ? { ...token, refreshToken: undefined } : null;
  }
  async getActiveAccessToken(id: string) {
    const token = this.tokens.get(id);
    return token && !token.revokedAt && token.accessTokenExpiresAt > new Date()
      ? token
      : null;
  }
  async revokeToken(id: string) {
    const token = this.tokens.get(id);
    if (token) token.revokedAt = new Date();
  }
  async consumeRefreshToken(id: string) {
    const token = this.tokens.get(id);
    if (
      !token ||
      token.revokedAt ||
      !token.refreshTokenExpiresAt ||
      token.refreshTokenExpiresAt <= new Date()
    )
      return false;
    token.revokedAt = new Date();
    return true;
  }
  async revokeTokenFamily(hash: string) {
    this.compromised.add(hash);
    for (const token of this.tokens.values())
      if (token.originatingAuthorizationCodeHash === hash)
        token.revokedAt = new Date();
  }
  async revokeDescendants(code: string) {
    return this.revokeTokenFamily(hashOAuthSecret(code));
  }
  async audit(event: OAuthAuditEvent) {
    this.audits.push(event);
  }
}

const ownerPassword = "owner-secret-".repeat(4);
const config = resolveMcpConfig({
  MCP_PUBLIC_URL: "https://studio.example.com/api/mcp",
  MCP_OWNER_PASSWORD: ownerPassword,
});
const tokenOutput = (value: unknown) => {
  if (
    !value ||
    typeof value !== "object" ||
    !("access_token" in value) ||
    !("refresh_token" in value) ||
    typeof value.access_token !== "string" ||
    typeof value.refresh_token !== "string"
  )
    throw new Error("Missing OAuth token response");
  return { access: value.access_token, refresh: value.refresh_token };
};

async function session(ownerAuth: "password" | "hodor" = "password") {
  const config = resolveMcpConfig({
    MCP_PUBLIC_URL: "https://studio.example.com/api/mcp",
    MCP_OWNER_AUTH: ownerAuth,
    MCP_OWNER_PASSWORD: ownerPassword,
    MCP_SECRET: ownerPassword,
  });
  const store = new MemoryOAuthStore();
  const handler = createOAuthHttpHandler(config, store);
  async function send(path: string | URL, options: RequestInit = {}) {
    const response = await handler(
      new Request(new URL(path, config.issuer), {
        ...options,
        headers: {
          Host: config.serverUrl.host,
          ...(ownerAuth === "hodor" ? { "x-hodor-auth": "password" } : {}),
          ...Object.fromEntries(new Headers(options.headers)),
        },
      }),
    );
    if (!response) throw new Error("OAuth request was not handled");
    return response;
  }
  const registered = await send("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test client",
      redirect_uris: ["http://127.0.0.1:1455/callback"],
    }),
  });
  expect(registered.status).toBe(201);
  const client = [...store.clients.values()][0];
  if (!client) throw new Error("Missing registered client");
  const verifier = "v".repeat(43);
  const url = new URL("/oauth/authorize", config.issuer);
  url.search = new URLSearchParams({
    client_id: client.id,
    response_type: "code",
    redirect_uri: client.redirectUris[0] ?? "",
    scope: MCP_SCOPE_VALUES.join(" "),
    resource: config.serverUrl.toString(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "bound-state",
  }).toString();
  async function consent() {
    const page = await send(url);
    expect(page.status).toBe(200);
    expect(page.headers.get("Referrer-Policy")).toBe("same-origin");
    const html = await page.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    const cookie = page.headers.get("set-cookie")?.split(";")[0];
    if (!csrf || !cookie) throw new Error("Missing consent binding");
    return { csrf, cookie, html };
  }
  async function approve(
    binding: Awaited<ReturnType<typeof consent>>,
    fields: Record<string, string> = {},
    target = url,
    origin = config.issuer.origin,
  ) {
    return send(target, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: binding.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf: binding.csrf,
        owner_password: ownerPassword,
        decision: "approve",
        [scopeInputName("sticks-and-clay:write")]: "on",
        ...fields,
      }),
    });
  }
  async function token(body: Record<string, string>) {
    return send("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.id,
        resource: config.serverUrl.toString(),
        ...body,
      }),
    });
  }
  async function issued() {
    const approved = await approve(await consent());
    expect(approved.status).toBe(302);
    const callback = new URL(approved.headers.get("location") ?? "");
    expect(callback.searchParams.get("state")).toBe("bound-state");
    const code = callback.searchParams.get("code") ?? "";
    const response = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: client.redirectUris[0] ?? "",
    });
    expect(response.status).toBe(200);
    return { ...tokenOutput(await response.json()), code };
  }
  return {
    store,
    send,
    client,
    verifier,
    url,
    consent,
    approve,
    token,
    issued,
  };
}

describe("MCP OAuth", () => {
  test("Hodor consent uses the workshop login without another password", async () => {
    const s = await session("hodor");
    const binding = await s.consent();
    expect(binding.html).not.toContain('name="owner_password"');
    const response = await s.approve(binding, { owner_password: "" });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.has("code")).toBe(true);
  });

  test("Hodor consent rejects anonymous and public-path requests on GET and POST", async () => {
    const s = await session("hodor");
    for (const method of ["GET", "POST"]) {
      for (const admission of ["", "public", "path", "true", "Password"]) {
        const response = await s.send(s.url, {
          method,
          headers: { "x-hodor-auth": admission },
        });
        expect(response.status).toBe(401);
      }
    }
    expect((await s.send(s.url, { headers: { "x-hodor-auth": "bypass" } })).status).toBe(200);
  });

  test("Hodor still requires request-bound consent and a strong signing secret", async () => {
    expect(() => resolveMcpConfig({
      MCP_PUBLIC_URL: "https://studio.example.com/api/mcp",
      MCP_OWNER_AUTH: "hodor",
    })).toThrow("MCP_SECRET");
    expect(() => resolveMcpConfig({
      MCP_PUBLIC_URL: "https://studio.example.com/api/mcp",
      MCP_OWNER_AUTH: "invalid",
      MCP_SECRET: ownerPassword,
    })).toThrow("MCP_OWNER_AUTH");
    const s = await session("hodor");
    const binding = await s.consent();
    expect((await s.approve(binding, { csrf: "forged" })).status).toBe(403);
    expect((await s.approve(binding, {}, s.url, "https://evil.example")).status).toBe(403);
    expect((await s.approve(binding, {}, s.url, "null")).status).toBe(403);
  });

  test("configuration uses canonical HTTPS or loopback URL and strong owner credentials", () => {
    expect(config.signingSecret).toBe(ownerPassword);
    expect(() =>
      resolveMcpConfig({
        MCP_PUBLIC_URL: "http://public.example.com/api/mcp",
        MCP_OWNER_PASSWORD: ownerPassword,
      }),
    ).toThrow("HTTPS");
    expect(() =>
      resolveMcpConfig({
        MCP_PUBLIC_URL: "https://studio.example.com/api/mcp",
        MCP_OWNER_PASSWORD: "short",
      }),
    ).toThrow("32");
    expect(() =>
      resolveMcpConfig({
        MCP_PUBLIC_URL: "https://user:pass@studio.example.com/api/mcp",
        MCP_OWNER_PASSWORD: ownerPassword,
      }),
    ).toThrow("credentials");
    expect(
      resolveMcpConfig({
        MCP_PUBLIC_URL: "http://127.0.0.1:3000/api/mcp",
        MCP_OWNER_PASSWORD: ownerPassword,
      }).dangerouslyAllowInsecureUrls,
    ).toBe(true);
  });

  test("discovery and registration advertise bound resource, modern grants and scopes", async () => {
    const s = await session();
    expect(
      await (await s.send("/.well-known/oauth-authorization-server")).json(),
    ).toMatchObject({
      issuer: config.issuer.toString(),
      code_challenge_methods_supported: ["S256"],
      scopes_supported: MCP_SCOPE_VALUES,
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
    expect(
      await (
        await s.send("/.well-known/oauth-protected-resource/api/mcp")
      ).json(),
    ).toMatchObject({
      resource: config.serverUrl.toString(),
      authorization_servers: [config.issuer.toString()],
    });
    expect(
      (
        await s.send("/oauth/register", {
          method: "POST",
          body: JSON.stringify({
            redirect_uris: ["http://evil.example.com/callback"],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.send("/oauth/token", {
          method: "POST",
          body: "x".repeat(32769),
        })
      ).status,
    ).toBe(413);
    const wrongHost = await createOAuthHttpHandler(
      config,
      s.store,
    )(
      new Request("https://evil.example.com/oauth/register", {
        method: "POST",
        headers: { Host: "evil.example.com" },
      }),
    );
    expect(wrongHost?.status).toBe(403);
  });

  test("fixed loopback preview hosts keep discovery bound to the configured public URL", async () => {
    const handler = createOAuthHttpHandler(config, new MemoryOAuthStore());
    const response = await handler(new Request("http://127.0.0.1:43505/.well-known/oauth-protected-resource/api/mcp", {
      headers: { Host: "127.0.0.1:43505", "X-Forwarded-Host": "evil.example" },
    }));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ resource: config.serverUrl.toString(), authorization_servers: [config.issuer.toString()] });
    const denied = await handler(new Request("https://evil.example/.well-known/oauth-protected-resource/api/mcp", { headers: { Host: "evil.example" } }));
    expect(denied?.status).toBe(403);
  });

  test("owner password, request binding, cookie, origin and one-use consent are required", async () => {
    const s = await session();
    const binding = await s.consent();
    expect(binding.html).toContain('type="password"');
    expect(binding.html).not.toContain(ownerPassword);
    expect(binding.html).not.toContain(
      `${scopeInputName("sticks-and-clay:admin")}" checked`,
    );
    expect((await s.approve(binding, { owner_password: "" })).status).toBe(401);
    expect(
      (await s.approve(binding, { owner_password: "incorrect" })).status,
    ).toBe(401);
    expect((await s.approve(binding, { csrf: "forged" })).status).toBe(403);
    expect((await s.approve({ ...binding, cookie: "" })).status).toBe(403);
    expect(
      (await s.approve(binding, {}, s.url, "https://evil.example.com")).status,
    ).toBe(403);
    const changed = new URL(s.url);
    changed.searchParams.set("state", "changed");
    expect((await s.approve(binding, {}, changed)).status).toBe(403);
    expect((await s.approve(binding)).status).toBe(302);
    expect((await s.approve(binding)).status).toBe(403);
    expect(s.store.codes.size).toBe(1);
    expect(JSON.stringify(s.store.audits)).not.toContain(ownerPassword);
  });

  test("PKCE and resource binding guard exchange; selected scopes and audience guard access", async () => {
    const s = await session();
    const approved = await s.approve(await s.consent());
    const code =
      new URL(approved.headers.get("location") ?? "").searchParams.get(
        "code",
      ) ?? "";
    const values = {
      grant_type: "authorization_code",
      code,
      code_verifier: s.verifier,
      redirect_uri: s.client.redirectUris[0] ?? "",
    };
    expect(
      (await s.token({ ...values, code_verifier: "x".repeat(43) })).status,
    ).toBe(400);
    expect(
      (
        await s.token({
          ...values,
          resource: "https://other.example.com/api/mcp",
        })
      ).status,
    ).toBe(400);
    const response = await s.token(values);
    const tokens = tokenOutput(await response.json());
    const verified = await createLocalTokenVerifier(
      config,
      s.store,
    ).verifyAccessToken(tokens.access);
    expect(verified.scopes).toEqual([
      "sticks-and-clay:read",
      "sticks-and-clay:write",
    ]);
    expect(verified.expiresAt).toBeLessThanOrEqual(
      Math.ceil(Date.now() / 1000) + 900,
    );
    const wrongAudience = await new SignJWT({
      cid: s.client.id,
      scope: "sticks-and-clay:read",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(config.issuer.toString())
      .setAudience("https://other.example.com/api/mcp")
      .setJti([...s.store.tokens.keys()][0] ?? "")
      .setExpirationTime("15m")
      .sign(getOAuthSigningKey(config.signingSecret));
    await expect(
      createLocalTokenVerifier(config, s.store).verifyAccessToken(
        wrongAudience,
      ),
    ).rejects.toThrow("invalid");
    expect((await s.token(values)).status).toBe(400);
    await expect(
      createLocalTokenVerifier(config, s.store).verifyAccessToken(
        tokens.access,
      ),
    ).rejects.toThrow("revoked");
  });

  test("refresh rotates once; replay revokes every descendant token", async () => {
    const s = await session();
    const first = await s.issued();
    const response = await s.token({
      grant_type: "refresh_token",
      refresh_token: first.refresh,
    });
    expect(response.status).toBe(200);
    const second = tokenOutput(await response.json());
    expect(second.refresh).not.toBe(first.refresh);
    const verifier = createLocalTokenVerifier(config, s.store);
    expect((await verifier.verifyAccessToken(second.access)).scopes).toEqual([
      "sticks-and-clay:read",
      "sticks-and-clay:write",
    ]);
    await expect(verifier.verifyAccessToken(first.access)).rejects.toThrow(
      "revoked",
    );
    expect(
      (
        await s.token({
          grant_type: "refresh_token",
          refresh_token: first.refresh,
        })
      ).status,
    ).toBe(400);
    await expect(verifier.verifyAccessToken(second.access)).rejects.toThrow(
      "revoked",
    );
  });

  test("simultaneous refresh cannot mint two accepted descendants", async () => {
    const s = await session();
    const first = await s.issued();
    const responses = await Promise.all([
      s.token({ grant_type: "refresh_token", refresh_token: first.refresh }),
      s.token({ grant_type: "refresh_token", refresh_token: first.refresh }),
    ]);
    expect(
      responses.filter((response) => response.status === 200).length,
    ).toBeLessThanOrEqual(1);
    expect(responses.some((response) => response.status === 400)).toBe(true);
    const successful = responses.find((response) => response.status === 200);
    expect(s.store.tokens.size).toBeLessThanOrEqual(2);
    expect(
      [...s.store.tokens.values()].every((token) => token.revokedAt !== null),
    ).toBe(true);
    if (successful) {
      const next = tokenOutput(await successful.json());
      await expect(
        createLocalTokenVerifier(config, s.store).verifyAccessToken(
          next.access,
        ),
      ).rejects.toThrow("revoked");
    }
  });

  test("token revocation and owner client revocation invalidate grants", async () => {
    const s = await session();
    const first = await s.issued();
    const revoke = await s.send("/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: s.client.id,
        token: first.access,
      }),
    });
    expect(revoke.status).toBe(200);
    await expect(
      createLocalTokenVerifier(config, s.store).verifyAccessToken(first.access),
    ).rejects.toThrow("revoked");
    const second = await s.issued();
    await s.store.revokeClient(s.client.id);
    await expect(
      createLocalTokenVerifier(config, s.store).verifyAccessToken(
        second.access,
      ),
    ).rejects.toThrow("revoked");
    expect(
      (
        await s.token({
          grant_type: "refresh_token",
          refresh_token: second.refresh,
        })
      ).status,
    ).toBe(401);
  });
});
