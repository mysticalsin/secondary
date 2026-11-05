// Calls into workers/api over the API service binding, signed with the shared internal HMAC helper.
// The connector never forwards a user token. It signs as a service principal; the api checks the
// principal and the key (CONNECTOR_HMAC_KEY) and only then lets the call write into a Workspace.

import { type InternalPrincipal, signInternalRequest } from "./internal-auth.ts";
import type { ApiItem, ApiSink, SourceDef } from "./types.ts";

const ORIGIN = "https://api.internal";
const BATCH = 50;

export const CONNECTOR_PRINCIPAL: InternalPrincipal = {
  v: 1,
  iss: "secondary-mcp",
  aud: "secondary-api",
  sub: "secondary-connector",
  email: "connector@service.invalid",
  client_id: "secondary-connector",
  scope: [],
  tool: "connector.sync",
};

export function apiSink(
  env: Pick<Env, "API" | "CONNECTOR_HMAC_KEY" | "CONNECTOR_HMAC_KID">,
): ApiSink {
  const post = async (path: string, payload: unknown) => {
    const secret = env.CONNECTOR_HMAC_KEY;
    if (!secret) throw new Error("connector_key_missing");
    const body = JSON.stringify(payload);
    const url = `${ORIGIN}${path}`;
    const headers = await signInternalRequest({
      secret,
      kid: env.CONNECTOR_HMAC_KID,
      method: "POST",
      url,
      body,
      principal: CONNECTOR_PRINCIPAL,
    });
    const res = await env.API.fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`api_${res.status}`);
  };
  const target = (s: SourceDef) => ({
    sourceId: s.id,
    scopeId: s.scope.scopeId,
    gateNodeId: s.scope.gateNodeId,
    plane: s.scope.plane,
    provider: s.provider,
  });
  return {
    async upsert(tenantId: string, source: SourceDef, items: ApiItem[]) {
      for (let i = 0; i < items.length; i += BATCH)
        await post("/internal/connector/upsert", {
          tenantId,
          ...target(source),
          items: items.slice(i, i + BATCH),
        });
    },
    async remove(tenantId: string, source: SourceDef, itemIds: string[]) {
      for (let i = 0; i < itemIds.length; i += 200)
        await post("/internal/connector/delete", {
          tenantId,
          scopeId: source.scope.scopeId,
          ids: itemIds.slice(i, i + 200),
        });
    },
    async purge(tenantId: string, source: SourceDef) {
      await post("/internal/connector/purge", {
        tenantId,
        scopeId: source.scope.scopeId,
        sourceId: source.id,
      });
    },
  };
}
