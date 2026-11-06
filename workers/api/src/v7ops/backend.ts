// Where source config and numbers come from. In staging and prod it is the connector worker, reached
// over the CONNECTOR service binding with signed calls (the same way the read-time check is). In dev,
// with OPS_SYNTHETIC=on, it is the deterministic stand-in in synthetic.ts. Anything else answers null:
// the routes then say `connector_unavailable`. Nothing here returns file names or content.

import { type InternalPrincipal, signInternalRequest } from "../internal-auth.ts";
import { workspaceStub } from "../stubs.ts";
import type { C } from "../ux/util.ts";
import { sess } from "../ux/util.ts";
import type {
  AttemptOut,
  RunResult,
  Settings,
  SourceAttempts,
  SourceRow,
  SourceStats,
  SourcesBackend,
} from "./model.ts";
import { DEFAULT_SETTINGS, type SynthScope, syntheticBackend } from "./synthetic.ts";

const ORIGIN = "https://connector.internal";

type Def = {
  id: string;
  name?: string;
  provider: SourceRow["provider"];
  siteId: string | null;
  driveId: string;
  folderPath: string;
  scope: { scopeId: string } & Record<string, unknown>;
  enabled: boolean;
  paused?: boolean;
  settings?: Settings;
  credentialRotatedAt?: number;
  cursor?: { lastSyncAt: number | null; lastError: string | null };
  files?: number;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function connectorBackend(
  env: Env,
  tenantId: string,
  user: { id: string; email: string },
): SourcesBackend | null {
  const secret = env.CONNECTOR_HMAC_KEY;
  if (!secret || !env.CONNECTOR) return null;
  const call = async (method: "GET" | "PUT" | "POST", path: string, body?: unknown) => {
    try {
      const principal: InternalPrincipal = {
        v: 1,
        iss: "secondary-mcp",
        aud: "secondary-api",
        sub: user.id,
        email: user.email,
        client_id: "secondary-api",
        scope: [],
        tool: "ops.sources",
      };
      const url = `${ORIGIN}${path}`;
      const raw = body === undefined ? undefined : JSON.stringify(body);
      const headers = await signInternalRequest({
        secret,
        kid: env.CONNECTOR_HMAC_KID,
        method,
        url,
        body: raw,
        principal,
      });
      const res = await env.CONNECTOR.fetch(url, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        ...(raw !== undefined ? { body: raw } : {}),
      });
      return { status: res.status, json: obj(await res.json().catch(() => null)) };
    } catch {
      return { status: 0, json: null };
    }
  };
  const q = `tenantId=${encodeURIComponent(tenantId)}`;
  const toRow = (d: Def): SourceRow => ({
    id: d.id,
    name: d.name ?? d.id,
    provider: d.provider,
    folder: d.folderPath,
    scopeId: d.scope.scopeId,
    paused: d.paused === true,
    settings: { ...DEFAULT_SETTINGS, chips: [], ...d.settings },
    lastSyncAt: d.cursor?.lastSyncAt ?? null,
    lastError: d.cursor?.lastError ?? null,
    files: d.files ?? 0,
    rotatedAt: d.credentialRotatedAt ?? null,
    synthetic: false,
  });
  const defs = async (): Promise<Def[] | null> => {
    const r = await call("GET", `/internal/sources?${q}`);
    return r.status === 200 && Array.isArray(r.json?.sources) ? (r.json.sources as Def[]) : null;
  };
  return {
    synthetic: false,
    list: async () => (await defs())?.map(toRow) ?? null,
    get: async (id) => {
      const d = (await defs())?.find((x) => x.id === id);
      return d ? toRow(d) : null;
    },
    put: async (id, patch) => {
      const d = (await defs())?.find((x) => x.id === id);
      if (!d) return null;
      const body = {
        tenantId,
        provider: d.provider,
        siteId: d.siteId,
        driveId: d.driveId,
        folderPath: d.folderPath,
        scope: d.scope,
        enabled: d.enabled,
        ...(d.name ? { name: d.name } : {}),
        paused: patch.paused ?? d.paused === true,
        settings: { ...DEFAULT_SETTINGS, chips: [], ...d.settings, ...patch.settings },
        ...(patch.rotatedAt !== undefined
          ? { credentialRotatedAt: patch.rotatedAt }
          : d.credentialRotatedAt !== undefined
            ? { credentialRotatedAt: d.credentialRotatedAt }
            : {}),
      };
      const r = await call("PUT", `/internal/sources/${id}`, body);
      if (r.status !== 200 && r.status !== 201) return null;
      const next = (await defs())?.find((x) => x.id === id);
      return next ? toRow(next) : null;
    },
    run: async (id): Promise<RunResult> => {
      const r = await call("POST", `/internal/sources/${id}/sync`, { tenantId });
      return r.status === 202
        ? "queued"
        : r.status === 409
          ? "paused"
          : r.status === 404
            ? "not_found"
            : "unavailable";
    },
    stats: async (id) => {
      const r = await call("GET", `/internal/sources/${id}/stats?${q}`);
      return r.status === 200 ? (r.json as unknown as SourceStats) : null;
    },
    attempts: async (since) => {
      const r = await call("GET", `/internal/ops/summary?${q}&since=${since}`);
      return r.status === 200 && Array.isArray(r.json?.sources)
        ? (r.json.sources as {
            id: string;
            name: string;
            scopeId: string;
            attempts: AttemptOut[];
          }[])
        : [];
    },
  };
}

/** The backend for this request, or null when neither the connector nor the dev stand-in is available. */
export function sourcesBackend(c: C, scopes: SynthScope[]): SourcesBackend | null {
  const s = sess(c);
  if (c.env.OPS_SYNTHETIC === "on" && c.env.ENVIRONMENT === "dev") {
    const stub = workspaceStub(c.env, s.tenantId, "ops:sources");
    return syntheticBackend({
      tenantId: s.tenantId,
      scopes,
      now: () => s.ctx.now,
      kv: {
        get: (k) => stub.opsKvGet(k),
        set: (k, v) => stub.opsKvSet(k, v),
      },
    });
  }
  return connectorBackend(c.env, s.tenantId, { id: s.principal.id, email: s.principal.email });
}

export type { SourceAttempts };
