import { env } from "cloudflare:workers";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../src/index.ts";

export const TEAM = "acme-test.cloudflareaccess.com";
export const AUD = "aud-test-123";
export const SEED_TOKEN = "test-seed-token";
export const ALPHA = "tenant_mantu_synthetic";
export const BETA = "tenant_beta";

const pair = await generateKeyPair("RS256");
const stranger = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const jwks = createLocalJWKSet({ keys: [jwk] });
export const publicJwk = jwk;

export interface SignOpts {
  aud?: string;
  iss?: string;
  /** Seconds since epoch. */
  exp?: number;
  signWithStranger?: boolean;
  noEmail?: boolean;
}

/** An Access-style JWT signed by the local key, so the real verification path runs. */
export async function sign(email: string, o: SignOpts = {}): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  return new SignJWT(o.noEmail ? { sub: "svc" } : { email })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt(nowS - 10)
    .setExpirationTime(o.exp ?? nowS + 600)
    .sign(o.signWithStranger ? stranger.privateKey : pair.privateKey);
}

export interface CallOpts {
  email?: string;
  persona?: string;
  method?: string;
  body?: unknown;
  /** Binding or var overrides, e.g. { ENVIRONMENT: "prod" }. */
  env?: Record<string, unknown>;
  headers?: Record<string, string>;
  origin?: string;
  /** Fixed clock for the request. */
  now?: number;
  /** Send this token instead of a valid one for `email`. null sends none. */
  token?: string | null;
  rawBody?: string;
}

const defaultApp = createApp({ jwks: () => jwks });

/** Jurisdictions the code under test asked for. workerd cannot create them locally, so the wrapper only records. */
export const jurisdictionCalls: string[] = [];
type Ns = { get(id: DurableObjectId): unknown; idFromName(name: string): DurableObjectId };
const recording = <T>(ns: Ns): T =>
  ({
    get: (id: DurableObjectId) => ns.get(id),
    idFromName: (name: string) => ns.idFromName(name),
    jurisdiction: (j: string) => {
      jurisdictionCalls.push(j);
      return recording(ns);
    },
  }) as unknown as T;

export const testEnv = (over: Record<string, unknown> = {}): Env =>
  ({
    ...env,
    TENANT_POLICY: recording(env.TENANT_POLICY as unknown as Ns),
    WORKSPACE: recording(env.WORKSPACE as unknown as Ns),
    DO_JURISDICTION: "eu",
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...over,
  }) as unknown as Env;

/** Direct handles to the objects, bypassing the API (to plant canaries or read state). */
export const rawEnv = env;

export async function call(path: string, o: CallOpts = {}): Promise<Response> {
  const app =
    o.now === undefined ? defaultApp : createApp({ jwks: () => jwks, now: () => o.now as number });
  const headers: Record<string, string> = { ...o.headers };
  const token = o.token === undefined ? (o.email ? await sign(o.email) : null) : o.token;
  if (token) headers["Cf-Access-Jwt-Assertion"] = token;
  if (o.persona) headers["X-Demo-Persona"] = o.persona;
  const hasBody = o.body !== undefined || o.rawBody !== undefined;
  if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const req = new Request(`${o.origin ?? "https://secondary.example.test"}${path}`, {
    method: o.method ?? (hasBody ? "POST" : "GET"),
    headers,
    ...(hasBody ? { body: o.rawBody ?? JSON.stringify(o.body) } : {}),
  });
  return app.fetch(req, testEnv(o.env));
}

// biome-ignore lint/suspicious/noExplicitAny: test JSON bodies are untyped on purpose
export type Loose = any;
export const json = async <T = Record<string, Loose>>(r: Response): Promise<T> =>
  (await r.json()) as T;

/** Persona calls: any email works, the persona header (dev) picks the role. */
export const as = (persona: string, path: string, o: CallOpts = {}) =>
  call(path, { email: `${persona}@example.invalid`, persona, ...o });

export async function seed(opts: { tenantId?: string; emailDomain?: string; seed?: number } = {}) {
  const res = await call("/v1/admin/seed", {
    email: "seeder@example.invalid",
    body: opts,
    headers: { "X-Seed-Token": SEED_TOKEN },
    env: { TENANT_DOMAINS: JSON.stringify({ "beta.example.invalid": BETA }) },
  });
  if (res.status !== 200) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  return json(res);
}

export const withBeta = { TENANT_DOMAINS: JSON.stringify({ "beta.example.invalid": BETA }) };

export const wsOf = (tenantId: string, scope: string) =>
  rawEnv.WORKSPACE.get(rawEnv.WORKSPACE.idFromName(`${tenantId}:${scope}`));
export const tenantDo = (tenantId: string) =>
  rawEnv.TENANT_POLICY.get(rawEnv.TENANT_POLICY.idFromName(tenantId));

/** Re-label an existing seeded row so the text can only be found through that workspace's index. */
export async function plantLabel(
  tenantId: string,
  scope: string,
  id: string,
  kind: string,
  plane: string,
  label: string,
) {
  await wsOf(tenantId, scope).seed(
    [
      {
        id,
        label,
        kind,
        plane,
        status: "",
        revision: 0,
        authorId: null,
        tags: [],
        reviewedBy2: false,
      },
    ],
    false,
    Date.now(),
  );
}

/** Every node id in a MapView, hubs and children. */
export function mapIds(map: Loose): string[] {
  const out: string[] = [];
  const walk = (n: { id: string; children?: unknown[] }) => {
    out.push(n.id);
    for (const c of (n.children ?? []) as { id: string }[]) walk(c);
  };
  for (const h of map.hubs) walk(h);
  return out;
}

export const PERSONAS = [
  "ceo",
  "head_bid",
  "acme_lead",
  "consultant",
  "reviewer",
  "platform_admin",
  "auditor",
] as const;
