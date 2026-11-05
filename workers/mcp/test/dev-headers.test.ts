import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  clearAudit,
  devHeaders,
  envWith,
  getToken,
  pkce,
  register,
  send,
} from "./helpers.ts";

// C1 (security review): a deployed dev worker is public. Dev test headers are an identity only on a
// loopback host. Anywhere else an unconfigured Access means 401, never a header-chosen identity.

const PUBLIC_HOST = "https://secondary-mcp-dev.example.workers.dev";

async function authorizeAt(base: string, headers: Record<string, string>) {
  const e = envWith({ MCP_PUBLIC_URL: base });
  const { body } = await register(e, undefined, base);
  const { challenge } = await pkce();
  return send(
    new Request(
      authorizeUrl({ clientId: body.client_id as string, scope: "secondary.read", challenge, base }),
      { headers },
    ),
    e,
  );
}

describe("dev test headers (C1)", () => {
  it("are refused on a non-loopback host: 401 at /authorize", async () => {
    const res = await authorizeAt(PUBLIC_HOST, devHeaders({ email: "x@y.z", persona: "ceo" }));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('name="handle"');
  });

  it("are refused on a non-loopback host for the consent POST too", async () => {
    const res = await send(
      new Request(`${PUBLIC_HOST}/authorize`, {
        method: "POST",
        headers: { ...devHeaders({}), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ handle: "h", decision: "approve" }),
      }),
      envWith({ MCP_PUBLIC_URL: PUBLIC_HOST }),
    );
    expect(res.status).toBe(401);
  });

  it("do not let an anonymous caller on a public host get a token", async () => {
    await clearAudit();
    await expect(
      getToken({ base: PUBLIC_HOST, e: envWith({ MCP_PUBLIC_URL: PUBLIC_HOST }) }),
    ).rejects.toThrow(/authorize failed 401/);
  });

  it("still work on localhost and 127.0.0.1", async () => {
    expect((await authorizeAt("http://localhost", devHeaders({}))).status).toBe(200);
    expect((await authorizeAt("http://127.0.0.1", devHeaders({}))).status).toBe(200);
  });
});
