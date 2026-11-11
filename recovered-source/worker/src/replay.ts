// Replay protection and key rings for the signed service calls into the API (MCP, connector, ops).
// The nonce cache is a table in the directory tenant's TenantPolicy Durable Object: a nonce is stored
// for twice the clock skew, so a captured request is accepted once even inside the timestamp window.

import {
  type KeyRing,
  keyringFromEnv,
  type ReplayStore,
} from "../../../packages/contracts/src/signed-call.ts";
import { directoryTenant } from "./auth/config.ts";
import { tenantStub } from "./stubs.ts";

export const replayStore = (env: Env, now: number): ReplayStore => ({
  first: (key, ttlMs, window) =>
    tenantStub(env, directoryTenant(env) ?? env.DEFAULT_TENANT_ID).nonceFirst(
      key,
      now,
      ttlMs,
      window,
    ),
});

/** MCP -> API calls. The MCP worker holds this key and no other. */
export const internalKeys = (env: Env): KeyRing =>
  keyringFromEnv(
    env.INTERNAL_HMAC_KEY,
    env.INTERNAL_HMAC_KID,
    env.INTERNAL_HMAC_KEY_PREVIOUS,
    env.INTERNAL_HMAC_KID_PREVIOUS,
  );

/** API <-> connector calls. */
export const connectorKeys = (env: Env): KeyRing =>
  keyringFromEnv(
    env.CONNECTOR_HMAC_KEY,
    env.CONNECTOR_HMAC_KID,
    env.CONNECTOR_HMAC_KEY_PREVIOUS,
    env.CONNECTOR_HMAC_KID_PREVIOUS,
  );

/** Ops worker -> API calls (full export, restore, retention). A separate key the MCP worker never holds (M-01). */
export const opsKeys = (env: Env): KeyRing =>
  keyringFromEnv(
    env.OPS_HMAC_KEY,
    env.OPS_HMAC_KID,
    env.OPS_HMAC_KEY_PREVIOUS,
    env.OPS_HMAC_KID_PREVIOUS,
  );
