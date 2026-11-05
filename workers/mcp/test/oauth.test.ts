import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessKeys, resetAccessKeyCache } from "../src/access.ts";
import {
  ALICE,
  auditEvents,
  authorizeUrl,
  BASE,
  callTool,
  clearAudit,
  cookieJar,
  devHeaders,
  envWith,
  getToken,
  pkce,
  REDIRECT,
  register,
  rpc,
  send,
} from "./helpers.ts";

const form = (data: Record<string, string>) => new URLSearchParams(data);

beforeEach(async () => {
  await clearAudit();
});

describe("unauthenticated access and discovery", () => {
  it("answers /mcp without a token with 401 and a resource_metadata challenge", async () => {
    const { res } = await rpc(null, "tools/list");
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).toContain('scope="secondary.read"');
  });

  it("rejects a bogus bearer token with 401", async () => {
    const { res } = await rpc("not-a-real-token", "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("publishes RFC 9728 protected resource metadata", async () => {
    const res = await send(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: "http://localhost/mcp",
      authorization_servers: ["http://localhost"],
      scopes_supported: ["secondary.read"],
      bearer_methods_supported: ["header"],
    });
  });

  it("publishes RFC 8414 server metadata with the three endpoints, PKCE S256 and CIMD", async () => {
    const res = await send(new Request(`${BASE}/.well-known/oauth-authorization-server`));
    const m = (await res.json()) as Record<string, unknown>;
    expect(m).toMatchObject({
      issuer: "http://localhost",
      authorization_endpoint: "http://localhost/authorize",
      token_endpoint: "http://localhost/token",
      registration_endpoint: "http://localhost/register",
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["secondary.read", "secondary.personal.write", "secondary.contribute"],
      client_id_metadata_document_supported: true,
    });
  });

  it("serves /health without auth and 404s unknown paths", async () => {
    expect((await send(new Request(`${BASE}/health`))).status).toBe(200);
    expect((await send(new Request(`${BASE}/nope`))).status).toBe(404);
  });
});

describe("audience (RFC 8707) and no token passthrough", () => {
  it("rejects a token that was issued for a different resource", async () => {
    const other = envWith({ MCP_PUBLIC_URL: "http://127.0.0.1" });
    const t = await getToken({ e: other, base: "http://127.0.0.1" });
    // valid at the issuing server...
    expect((await rpc(t.token, "tools/list", {}, other, "http://127.0.0.1")).res.status).toBe(200);
    // ...but refused here: audience is http://127.0.0.1/mcp, not http://localhost/mcp.
    const { res } = await rpc(t.token, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("refuses an authorization request that names another resource", async () => {
    const { body } = await register();
    const { challenge } = await pkce();
    const res = await send(
      new Request(
        authorizeUrl({
          clientId: body.client_id as string,
          scope: "secondary.read",
          challenge,
          resource: "https://evil.test/mcp",
        }),
        { headers: devHeaders({}) },
      ),
    );
    // client and redirect URI validated, so the error goes back to the client (allowlisted host).
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.host).toBe("claude.ai");
    expect(loc.searchParams.get("error")).toBe("invalid_target");
    expect(loc.searchParams.get("code")).toBeNull();
  });
});

describe("client allowlist (redirect host)", () => {
  it("rejects dynamic registration for a host that is not on the list, and audits it", async () => {
    const { res, body } = await register(env, "https://evil.example/callback");
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
    const ev = (await auditEvents()).find((e) => e.action === "register.rejected");
    expect(ev).toMatchObject({
      kind: "mcp.oauth",
      outcome: "denied",
      redirect_host: "evil.example",
    });
  });

  it("rejects plain http on a non-loopback host and a lookalike suffix", async () => {
    expect((await register(env, "http://claude.ai/cb")).res.status).toBe(400);
    expect((await register(env, "https://claude.ai.evil.example/cb")).res.status).toBe(400);
    expect((await register(env, "https://evilclaude.ai/cb")).res.status).toBe(400);
  });

  it("accepts every allowlisted host, and http on localhost", async () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/cb",
      "https://chatgpt.com/connector/oauth/abc",
      "https://chat.openai.com/aip/x/oauth/callback",
      "https://dust.tt/oauth/cb",
      "https://eu.dust.tt/oauth/cb",
      "http://localhost:6274/oauth/callback",
      "http://127.0.0.1:33418/callback",
    ]) {
      expect((await register(env, uri)).res.status, uri).toBe(201);
    }
  });

  it("re-checks the host at /authorize and audits when the list changed", async () => {
    const { body } = await register();
    const { challenge } = await pkce();
    const narrowed = envWith({ ALLOWED_REDIRECT_HOSTS: "dust.tt" });
    const res = await send(
      new Request(
        authorizeUrl({ clientId: body.client_id as string, scope: "secondary.read", challenge }),
        {
          headers: devHeaders({}),
        },
      ),
      narrowed,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("not on the list");
    const ev = (await auditEvents()).find((e) => e.action === "authorize.rejected");
    expect(ev).toMatchObject({
      outcome: "denied",
      redirect_host: "claude.ai",
      reason: "redirect_host_not_allowed",
    });
  });

  it("an empty allowlist denies everything", async () => {
    const none = envWith({ ALLOWED_REDIRECT_HOSTS: "" });
    expect((await register(none)).res.status).toBe(400);
  });
});

describe("consent page", () => {
  async function page(name = "Test Host") {
    const { body } = await register(env, REDIRECT, BASE, name);
    const { challenge } = await pkce();
    const res = await send(
      new Request(
        authorizeUrl({
          clientId: body.client_id as string,
          scope: "secondary.read secondary.contribute bogus.scope",
          challenge,
        }),
        {
          headers: devHeaders({}),
        },
      ),
    );
    return { res, html: await res.text(), clientId: body.client_id as string };
  }

  it("is Mantu branded and lists client, redirect host and requested scopes", async () => {
    const { res, html } = await page();
    expect(res.status).toBe(200);
    expect(html).toContain("#6600AE");
    expect(html).toContain("#F8F060");
    expect(html).toContain("Carlito");
    expect(html).toMatch(/class="wordmark">mantu</);
    expect(html).toContain("Test Host");
    expect(html).toContain("claude.ai");
    expect(html).toContain("secondary.read");
    expect(html).toContain("secondary.contribute");
    expect(html).not.toContain("bogus.scope");
    expect(html).not.toContain("secondary.personal.write"); // not requested, so not offered
    expect(html).toContain(ALICE);
    expect(html).toContain("never approve, delete or change membership");
  });

  it("escapes client-supplied names and forbids framing", async () => {
    const { res, html } = await page('<img src=x onerror=alert(1)>"');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&#60;img src=x onerror=alert(1)&#62;&#34;");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("carries a one-time handle bound to the browser (CSRF)", async () => {
    const { res, html } = await page();
    const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] as string;
    expect(handle.length).toBeGreaterThan(16);
    expect(cookieJar(res)).toMatch(/__Host-/);
    const post = (headers: Record<string, string>) =>
      send(
        new Request(`${BASE}/authorize`, {
          method: "POST",
          headers: {
            ...devHeaders({}),
            "content-type": "application/x-www-form-urlencoded",
            ...headers,
          },
          body: form({ handle, decision: "approve", scope: "secondary.read" }),
        }),
      );
    // cross-site origin
    expect((await post({ cookie: cookieJar(res), origin: "https://evil.example" })).status).toBe(
      403,
    );
    // right origin but no cookie: the handle is not bound to this browser
    const noCookie = await post({ origin: BASE });
    expect(noCookie.status).toBe(400);
    expect(noCookie.headers.get("location")).toBeNull();
  });

  it("deny redirects to the client with access_denied and audits it", async () => {
    const t = await getToken({ decision: "deny" });
    expect(t.location.searchParams.get("error")).toBe("access_denied");
    expect(t.location.searchParams.get("code")).toBeNull();
    expect((await auditEvents()).find((e) => e.action === "authorize.deny")).toMatchObject({
      outcome: "denied",
    });
  });

  it("grants only the scopes the user left ticked, and read is always included", async () => {
    const t = await getToken({ scope: "secondary.read secondary.contribute" });
    expect(t.scope?.split(" ").sort()).toEqual(["secondary.contribute", "secondary.read"]);
    const ev = (await auditEvents()).find((e) => e.action === "authorize.approve");
    expect(ev?.oauth_scopes).toEqual(
      expect.arrayContaining(["secondary.read", "secondary.contribute"]),
    );
  });
});

describe("identity at /authorize", () => {
  it("needs sign-in: no identity, 401", async () => {
    const { body } = await register();
    const { challenge } = await pkce();
    const res = await send(
      new Request(
        authorizeUrl({ clientId: body.client_id as string, scope: "secondary.read", challenge }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it("ignores the dev test headers outside ENVIRONMENT=dev", async () => {
    const prod = envWith({ ENVIRONMENT: "prod" });
    const { body } = await register(prod);
    const { challenge } = await pkce();
    const res = await send(
      new Request(
        authorizeUrl({ clientId: body.client_id as string, scope: "secondary.read", challenge }),
        {
          headers: devHeaders({ persona: "ceo" }),
        },
      ),
      prod,
    );
    expect(res.status).toBe(401);
  });

  it("ignores the dev test headers once an Access team domain is configured", async () => {
    const withAccess = envWith({
      ACCESS_TEAM_DOMAIN: "team.example.cloudflareaccess.com",
      ACCESS_AUD: "aud-1",
    });
    const { body } = await register(withAccess);
    const { challenge } = await pkce();
    const res = await send(
      new Request(
        authorizeUrl({ clientId: body.client_id as string, scope: "secondary.read", challenge }),
        {
          headers: devHeaders({}),
        },
      ),
      withAccess,
    );
    expect(res.status).toBe(401);
  });

  it("fails closed outside dev when MCP_PUBLIC_URL is not pinned", async () => {
    const res = await send(
      new Request(`${BASE}/health`),
      envWith({ ENVIRONMENT: "prod", MCP_PUBLIC_URL: "" }),
    );
    expect(res.status).toBe(500);
  });
});

describe("Cloudflare Access JWT at /authorize", () => {
  const TEAM = "team.example.cloudflareaccess.com";
  const AUD = "aud-secondary-1";
  const access = envWith({ ENVIRONMENT: "prod", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
  const original = accessKeys.resolve;
  let sign: (
    claims: { email?: string; aud?: string; iss?: string; exp?: string | number; sub?: string },
    key?: CryptoKey,
  ) => Promise<string>;
  let otherKey: CryptoKey;

  beforeEach(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    accessKeys.resolve = () => createLocalJWKSet({ keys: [jwk] });
    resetAccessKeyCache();
    sign = (c, key) =>
      new SignJWT({ ...(c.email === undefined ? {} : { email: c.email }) })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(c.iss ?? `https://${TEAM}`)
        .setAudience(c.aud ?? AUD)
        .setSubject(c.sub ?? "access-sub-1")
        .setIssuedAt()
        .setExpirationTime(c.exp ?? "1h")
        .sign(key ?? privateKey);
  });
  afterEach(() => {
    accessKeys.resolve = original;
    resetAccessKeyCache();
  });

  const authorize = async (jwt: string | null) => {
    const { body } = await register(access);
    const { challenge } = await pkce();
    return send(
      new Request(
        authorizeUrl({ clientId: body.client_id as string, scope: "secondary.read", challenge }),
        {
          headers: jwt ? { "cf-access-jwt-assertion": jwt } : {},
        },
      ),
      access,
    );
  };

  it("accepts a valid Access JWT, shows the verified email, and the token carries that identity", async () => {
    const jwt = await sign({ email: "Bob@Example.invalid" });
    const res = await authorize(jwt);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("bob@example.invalid");
    const t = await getToken({ e: access, authHeaders: { "cf-access-jwt-assertion": jwt } });
    expect(t.token).toBeTruthy();
    const ev = (await auditEvents()).find((e) => e.action === "authorize.approve");
    expect(ev?.who).toBe("access-sub-1");
  });

  it("rejects missing, wrong-audience, wrong-issuer, expired, wrong-key and email-less tokens", async () => {
    expect((await authorize(null)).status).toBe(401);
    expect((await authorize(await sign({ email: ALICE, aud: "other-app" }))).status).toBe(401);
    expect(
      (await authorize(await sign({ email: ALICE, iss: "https://evil.cloudflareaccess.com" })))
        .status,
    ).toBe(401);
    expect(
      (await authorize(await sign({ email: ALICE, exp: Math.floor(Date.now() / 1000) - 120 })))
        .status,
    ).toBe(401);
    expect((await authorize(await sign({ email: ALICE }, otherKey))).status).toBe(401);
    expect((await authorize(await sign({}))).status).toBe(401);
    expect((await authorize("garbage.jwt.value")).status).toBe(401);
  });
});

describe("what the OAuth store keeps (KV is not EU-restricted)", () => {
  it("holds no plaintext token, email or content", async () => {
    const t = await getToken({ email: "carol@example.invalid" });
    await callTool(t.token as string, "personal_note_create", {
      title: "Secret title",
      body: "Secret body",
    });
    const dump: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.OAUTH_KV.list({ cursor });
      for (const k of page.keys) {
        dump.push(k.name, (await env.OAUTH_KV.get(k.name)) ?? "", JSON.stringify(k.metadata ?? {}));
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const all = dump.join("\n");
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(t.token as string);
    expect(all).not.toContain("carol@example.invalid");
    expect(all).not.toContain("Secret title");
    expect(all).not.toContain("Secret body");
  });
});
