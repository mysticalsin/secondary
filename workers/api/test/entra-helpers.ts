// A fake Microsoft Entra ID for tests: discovery, the token endpoint (with real PKCE checking) and
// ID tokens signed by a locally generated key. Nothing here talks to the network.

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { EntraDeps } from "../src/auth/oidc.ts";
import { createApp } from "../src/index.ts";
import { publicJwk, testEnv } from "./helpers.ts";

export const TENANT = "11111111-2222-4333-8444-555555555555";
export const OTHER_TENANT = "99999999-8888-4777-8666-555555555555";
export const CLIENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const CLIENT_SECRET = "test-entra-client-secret";
export const SCIM_TOKEN = "test-scim-token-0123456789abcdef0123456789";
export const ORIGIN = "https://secondary.example.test";
const HOST = "https://login.microsoftonline.com";

export const ENTRA_ENV = {
  AUTH_MODE: "entra",
  ENTRA_TENANT_ID: TENANT,
  ENTRA_CLIENT_ID: CLIENT,
  ENTRA_CLIENT_SECRET: CLIENT_SECRET,
};

const idpKeys = await generateKeyPair("RS256");
const idpJwk = { ...(await exportJWK(idpKeys.publicKey)), kid: "idp1", alg: "RS256", use: "sig" };
const strangerKeys = await generateKeyPair("RS256");
const idpJwks = createLocalJWKSet({ keys: [idpJwk] });

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const challengeOf = async (v: string) =>
  b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));

export interface Claims {
  email?: string | null;
  groups?: string[];
  tid?: string;
  iss?: string;
  aud?: string;
  nonce?: string;
  /** Seconds since epoch. */
  exp?: number;
  signWithStranger?: boolean;
  overage?: boolean;
}

interface Pending {
  challenge: string;
  nonce: string;
  redirectUri: string;
  claims: Claims;
}

export interface Idp {
  deps: EntraDeps;
  /** Every request the app made to the fake IdP, for assertions. */
  requests: { url: string; body: URLSearchParams | null }[];
  /** Issue a code for an authorize URL, as if the user signed in. Returns the callback URL. */
  approve(authorizeUrl: string, claims: Claims): Promise<string>;
}

export function makeIdp(over: { discoveryIssuer?: string } = {}): Idp {
  const codes = new Map<string, Pending>();
  const requests: Idp["requests"] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? new URLSearchParams(String(init.body)) : null;
    requests.push({ url, body });
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: over.discoveryIssuer ?? `${HOST}/${TENANT}/v2.0`,
        authorization_endpoint: `${HOST}/${TENANT}/oauth2/v2.0/authorize`,
        token_endpoint: `${HOST}/${TENANT}/oauth2/v2.0/token`,
        jwks_uri: `${HOST}/${TENANT}/discovery/v2.0/keys`,
      });
    if (url === `${HOST}/${TENANT}/oauth2/v2.0/token` && body) {
      const p = codes.get(body.get("code") ?? "");
      const bad = (e: string) => Response.json({ error: e }, { status: 400 });
      if (!p) return bad("invalid_grant");
      codes.delete(body.get("code") as string);
      if (body.get("client_secret") !== CLIENT_SECRET) return bad("invalid_client");
      if (body.get("redirect_uri") !== p.redirectUri) return bad("invalid_grant");
      const verifier = body.get("code_verifier");
      // PKCE as the real IdP enforces it: the verifier must hash to the challenge from /authorize.
      if (!verifier || (await challengeOf(verifier)) !== p.challenge) return bad("invalid_grant");
      return Response.json({ token_type: "Bearer", id_token: await idToken(p) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return {
    deps: { fetch: fetchImpl, jwks: () => idpJwks },
    requests,
    async approve(authorizeUrl, claims) {
      const u = new URL(authorizeUrl);
      const q = u.searchParams;
      const code = `code_${crypto.randomUUID()}`;
      codes.set(code, {
        challenge: q.get("code_challenge") ?? "",
        nonce: q.get("nonce") ?? "",
        redirectUri: q.get("redirect_uri") ?? "",
        claims,
      });
      const cb = new URL(q.get("redirect_uri") as string);
      cb.searchParams.set("code", code);
      cb.searchParams.set("state", q.get("state") as string);
      return cb.toString();
    },
  };
}

async function idToken(p: Pending): Promise<string> {
  const c = p.claims;
  const nowS = Math.floor(Date.now() / 1000);
  const tid = c.tid ?? TENANT;
  const payload: Record<string, unknown> = {
    sub: "sub-test",
    oid: "oid-test",
    tid,
    ver: "2.0",
    nonce: c.nonce ?? p.nonce,
    ...(c.email === null ? {} : { preferred_username: c.email ?? "someone@example.invalid" }),
    ...(c.groups ? { groups: c.groups } : {}),
    ...(c.overage ? { _claim_names: { groups: "src1" } } : {}),
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "idp1" })
    .setIssuer(c.iss ?? `${HOST}/${tid}/v2.0`)
    .setAudience(c.aud ?? CLIENT)
    .setIssuedAt(nowS - 5)
    .setExpirationTime(c.exp ?? nowS + 3600)
    .sign(c.signWithStranger ? strangerKeys.privateKey : idpKeys.privateKey);
}

export interface Req {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  env?: Record<string, unknown>;
  now?: number;
  idp?: Idp;
}

/** One request against the app, with Entra on and the fake IdP wired in. */
export async function req(path: string, o: Req = {}): Promise<Response> {
  const app = createApp({
    jwks: () => createLocalJWKSet({ keys: [publicJwk] }),
    ...(o.now === undefined ? {} : { now: () => o.now as number }),
    ...(o.idp ? { entra: o.idp.deps } : {}),
  });
  const headers = { ...o.headers };
  const hasBody = o.body !== undefined;
  if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: o.method ?? (hasBody ? "POST" : "GET"),
      headers,
      ...(hasBody ? { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) } : {}),
    }),
    testEnv({ ...ENTRA_ENV, SCIM_TOKEN, ...o.env }),
  );
}

export const cookieOf = (res: Response, name: string): string | null => {
  for (const line of res.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).split(";")[0] as string;
  }
  return null;
};
export const setCookieLine = (res: Response, name: string): string =>
  res.headers.getSetCookie().find((l) => l.startsWith(`${name}=`)) ?? "";

export interface SignIn {
  login: Response;
  callback: Response;
  /** The session cookie header to send on later requests, or null when no session was issued. */
  cookie: string | null;
  authorizeUrl: string;
}

/** The whole browser dance: /auth/login, the IdP approving, then /auth/callback. */
export async function signIn(idp: Idp, claims: Claims, o: Req & { returnTo?: string } = {}) {
  const login = await req(
    `/auth/login${o.returnTo ? `?returnTo=${encodeURIComponent(o.returnTo)}` : ""}`,
    {
      ...o,
      idp,
    },
  );
  const authorizeUrl = login.headers.get("Location") ?? "";
  const loginCookie = cookieOf(login, "__Host-secondary_login");
  const callbackUrl = await idp.approve(authorizeUrl, claims);
  const u = new URL(callbackUrl);
  const callback = await req(`${u.pathname}${u.search}`, {
    ...o,
    idp,
    headers: { ...(loginCookie ? { Cookie: `__Host-secondary_login=${loginCookie}` } : {}) },
  });
  const sid = cookieOf(callback, "__Host-secondary_session");
  return {
    login,
    callback,
    cookie: sid ? `__Host-secondary_session=${sid}` : null,
    authorizeUrl,
  } satisfies SignIn;
}
