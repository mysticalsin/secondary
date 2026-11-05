import { describe, expect, it } from "vitest";
import { MAX_WINDOW_DAYS, meetingWindow } from "../src/calendar.ts";
import {
  GraphAuthError,
  GraphClient,
  GraphGoneError,
  GraphHttpError,
  graphFromEnv,
} from "../src/graph.ts";
import { graphMock, link } from "./helpers.ts";

describe("graph client", () => {
  it("is disabled unless tenant, client and secret are all set and well formed", () => {
    const ok = {
      GRAPH_TENANT_ID: "contoso.example.invalid",
      GRAPH_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
      GRAPH_CLIENT_SECRET: "s",
    };
    expect(graphFromEnv(ok)).not.toBeNull();
    for (const k of Object.keys(ok)) expect(graphFromEnv({ ...ok, [k]: "" })).toBeNull();
    expect(graphFromEnv({ ...ok, GRAPH_TENANT_ID: "../evil" })).toBeNull();
    expect(graphFromEnv({})).toBeNull();
  });

  it("uses client credentials with the .default scope and caches the token", async () => {
    const seen: { url: string; body: string }[] = [];
    const g = new GraphClient({
      tenantId: "contoso.example.invalid",
      clientId: "00000000-0000-0000-0000-000000000001",
      clientSecret: "shh",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("login.microsoftonline.com")) {
          seen.push({ url, body: String(init?.body) });
          return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        return Response.json({ value: [] });
      },
    });
    await g.getJson("/drives/d1/root/delta");
    await g.getJson("/drives/d1/root/delta");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(
      "https://login.microsoftonline.com/contoso.example.invalid/oauth2/v2.0/token",
    );
    const body = new URLSearchParams(seen[0]?.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  it("refuses paths outside /drives and /sites and links to other hosts (no calendar, users, groups)", async () => {
    const { graph, log } = graphMock();
    for (const p of [
      "/me/calendarView",
      "/users/a@b.c/events",
      "/groups/x/members",
      "https://evil.example.invalid/v1.0/drives/d/root/delta",
      "https://graph.microsoft.com/v1.0/users/x",
      "https://graph.microsoft.com/beta/drives/d/root/delta",
      "drives/d1",
    ])
      await expect(graph.getJson(p)).rejects.toThrow();
    expect(log).toEqual([]);
  });

  it("maps 410 to a resync signal and other errors to typed failures", async () => {
    const m = graphMock();
    m.on(link("a"), new Response("", { status: 410 }));
    m.on(link("b"), new Response("", { status: 403 }));
    await expect(m.graph.getJson(link("a"))).rejects.toBeInstanceOf(GraphGoneError);
    await expect(m.graph.getJson(link("b"))).rejects.toMatchObject({ status: 403 });
    await expect(m.graph.getJson(link("b"))).rejects.toBeInstanceOf(GraphHttpError);
  });

  it("token failure is a typed error with no secret in the message", async () => {
    const g = new GraphClient({
      tenantId: "contoso.example.invalid",
      clientId: "00000000-0000-0000-0000-000000000001",
      clientSecret: "super-secret-value",
      fetch: async () => new Response("bad", { status: 401 }),
    });
    const e = (await g.getJson("/drives/d/root/delta").catch((x) => x)) as Error;
    expect(e).toBeInstanceOf(GraphAuthError);
    expect(String(e.message)).not.toContain("super-secret-value");
  });

  it("downloads only from https hosts that are not literals or localhost, and respects the size cap", async () => {
    const m = graphMock();
    m.on("https://download.example.invalid/ok", () => new Response("hello"));
    m.on("https://download.example.invalid/big", () => new Response("x".repeat(100)));
    expect(
      new TextDecoder().decode(
        (await m.graph.getBytes("https://download.example.invalid/ok", 50)) as Uint8Array,
      ),
    ).toBe("hello");
    expect(await m.graph.getBytes("https://download.example.invalid/big", 50)).toBeNull();
    for (const u of [
      "http://download.example.invalid/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://[::1]/x",
      "nonsense",
    ])
      expect(await m.graph.getBytes(u, 50)).toBeNull();
    expect(m.log).toEqual([
      "https://download.example.invalid/ok",
      "https://download.example.invalid/big",
    ]);
    expect(m.auth).toEqual([null, null]); // pre-authenticated URL: no bearer token goes to the file host
  });
});

describe("calendar (delegated only)", () => {
  const from = new Date("2026-11-10T08:00:00Z");
  const to = new Date("2026-11-11T08:00:00Z");

  it("is off until enabled, and never runs without a delegated token", async () => {
    let called = 0;
    const f = (async () => {
      called++;
      return Response.json({ value: [] });
    }) as typeof fetch;
    expect(
      await meetingWindow({ enabled: false, delegatedToken: "t", from, to, fetch: f }),
    ).toEqual({
      ok: false,
      error: "calendar_disabled",
    });
    expect(
      await meetingWindow({ enabled: true, delegatedToken: null, from, to, fetch: f }),
    ).toEqual({
      ok: false,
      error: "delegated_token_required",
    });
    expect(called).toBe(0);
  });

  it("asks /me/calendarView for a bounded window with the minimum fields", async () => {
    let url = "";
    let auth = "";
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        value: [
          {
            id: "e1",
            subject: "Bid review",
            start: { dateTime: "2026-11-10T09:00:00" },
            end: { dateTime: "2026-11-10T10:00:00" },
            body: { content: "SECRET" },
            attendees: [{}],
          },
          { subject: "no id" },
        ],
      });
    }) as typeof fetch;
    const far = new Date(from.getTime() + 90 * 86_400_000);
    const r = await meetingWindow({
      enabled: true,
      delegatedToken: "user-token",
      from,
      to: far,
      fetch: f,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toEqual([
      {
        id: "e1",
        subject: "Bid review",
        start: "2026-11-10T09:00:00",
        end: "2026-11-10T10:00:00",
        isCancelled: false,
      },
    ]);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    const u = new URL(url);
    expect(u.pathname).toBe("/v1.0/me/calendarView");
    expect(u.searchParams.get("$select")).toBe("id,subject,start,end,isCancelled");
    const span =
      (new Date(u.searchParams.get("endDateTime") as string).getTime() - from.getTime()) /
      86_400_000;
    expect(span).toBe(MAX_WINDOW_DAYS);
    expect(auth).toBe("Bearer user-token");
  });

  it("rejects an empty or inverted window and maps Graph errors", async () => {
    const f = (async () => new Response("", { status: 403 })) as typeof fetch;
    expect(
      await meetingWindow({ enabled: true, delegatedToken: "t", from: to, to: from, fetch: f }),
    ).toEqual({ ok: false, error: "invalid_window" });
    expect(await meetingWindow({ enabled: true, delegatedToken: "t", from, to, fetch: f })).toEqual(
      { ok: false, error: "graph_error" },
    );
  });
});
