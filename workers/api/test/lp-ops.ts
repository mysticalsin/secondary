// Signed calls for the Landing Page tests: the MCP worker's internal scheme and the ops worker's.

import { signOpsRequest } from "../../../packages/contracts/src/ops-auth.ts";
import { type InternalPrincipal, signInternalRequest } from "../src/internal-auth.ts";
import { call, rawEnv } from "./helpers.ts";

const env = rawEnv as unknown as Env;

export async function internal(
  path: string,
  o: { body?: unknown; scope?: string[]; email?: string } = {},
) {
  const url = `https://secondary.example.test${path}`;
  const raw = o.body === undefined ? undefined : JSON.stringify(o.body);
  const method = raw === undefined ? "GET" : "POST";
  const principal: InternalPrincipal = {
    v: 1,
    iss: "secondary-mcp",
    aud: "secondary-api",
    sub: "sub-lp",
    email: o.email ?? "ceo@example.invalid",
    client_id: "claude.ai",
    scope: o.scope ?? ["secondary.read"],
    tool: "lp_compose",
  };
  const headers = await signInternalRequest({
    secret: env.INTERNAL_HMAC_KEY as string,
    method,
    url,
    ...(raw === undefined ? {} : { body: raw }),
    principal,
    now: Math.floor(Date.now() / 1000),
  });
  return call(path, {
    method,
    token: null,
    ...(raw === undefined ? {} : { rawBody: raw }),
    headers,
  });
}

export async function signOps(path: string, at: number): Promise<Response> {
  const url = `https://secondary.example.test${path}`;
  const body = "{}";
  const headers = await signOpsRequest({
    secret: env.OPS_HMAC_KEY as string,
    method: "POST",
    url,
    body,
    now: Math.floor(at / 1000),
  });
  return call(path, { method: "POST", token: null, rawBody: body, headers, now: at });
}
