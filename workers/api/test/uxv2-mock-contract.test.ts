// The web client's mock (apps/web/src/mock/uxv2.ts) must answer in the shapes the real API does, or the
// mock hides bugs the real stack shows. For each endpoint the same call is made against both; every
// field the mock emits must exist on the real answer with the same JSON type, and ranges the contract
// fixes (savedPct is a fraction) must hold on both sides.

import { beforeAll, describe, expect, it } from "vitest";
import { ALPHA, as, json, type Loose, seed } from "./helpers.ts";
import { parseSse } from "./uxv2-helpers.ts";

beforeAll(async () => {
  await seed();
});

// The mock is web code (DOM types), so this package's typecheck does not follow the import.
type Mock = {
  handleV2(method: string, p: string, q: URLSearchParams, body: Loose, role: string): unknown;
  mockAsk(text: string, persona: string | null, signal?: AbortSignal): AsyncGenerator<Loose>;
};
const MOCK_PATH = `/@fs${new URL("../../../apps/web/src/mock/uxv2.ts", import.meta.url).pathname}`;
let web: Mock;
beforeAll(async () => {
  web = (await import(/* @vite-ignore */ MOCK_PATH)) as Mock;
});

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** Problems where `mock` has a field the real answer lacks, or a different JSON type. `real` may be a list of samples. */
function drift(mock: Loose, real: Loose[], path = "$"): string[] {
  const out: string[] = [];
  const samples = real.filter((r) => r !== null && r !== undefined);
  if (mock === null || mock === undefined || !samples.length) return out;
  const t = typeOf(mock);
  if (samples.some((r) => typeOf(r) !== t)) {
    out.push(`${path}: mock is ${t}, real is ${[...new Set(samples.map(typeOf))].join("|")}`);
    return out;
  }
  if (t === "array") {
    for (const el of mock as Loose[]) out.push(...drift(el, samples.flat(), `${path}[]`));
  } else if (t === "object") {
    for (const [k, v] of Object.entries(mock as Loose)) {
      const there = samples.filter((r) => k in r).map((r) => r[k]);
      if (!there.length) out.push(`${path}.${k}: mock only`);
      else out.push(...drift(v, there, `${path}.${k}`));
    }
  }
  return out;
}

const mock = (method: string, path: string, role: string, body: Loose = {}) =>
  JSON.parse(
    JSON.stringify(
      web.handleV2(method, path, new URLSearchParams(path.split("?")[1] ?? ""), body, role),
    ),
  ) as Loose;

describe("web mock and real API agree", () => {
  it("usage: savedPct is a fraction in both", async () => {
    for (const persona of ["consultant", "platform_admin"]) {
      const real = await json<Loose>(await as(persona, "/v1/usage?period=7d"));
      const fake = mock("GET", "/v1/usage", persona);
      expect(drift(fake, [real])).toEqual([]);
      for (const b of [real.me, fake.me, real.tenant, fake.tenant].filter(Boolean)) {
        expect(b.savedPct).toBeGreaterThanOrEqual(0);
        expect(b.savedPct).toBeLessThanOrEqual(1);
      }
    }
  });

  it("brain tree", async () => {
    const tree = await json<Loose>(await as("consultant", "/v1/brain/tree"));
    expect(drift(mock("GET", "/v1/brain/tree", "consultant"), [tree])).toEqual([]);
  });

  it("ask events", async () => {
    const r = await as("consultant", "/v1/ask", { body: { q: "What do we know about Acme?" } });
    const real = parseSse(await r.text());
    expect(real.map((e) => e.event)).toContain("usage");
    const usage = real.find((e) => e.event === "usage")?.data as Loose;
    expect(usage.savedPct).toBeLessThanOrEqual(1);
    expect(usage.savedPct).toBeGreaterThanOrEqual(0);
    const fake: Loose[] = [];
    for await (const ev of web.mockAsk("What do we know about Acme?", "consultant")) fake.push(ev);
    for (const name of ["status", "answer", "usage"]) {
      const f = fake.find((e) => e.event === name);
      const rl = real.filter((e) => e.event === name).map((e) => e.data);
      if (f && rl.length) expect(drift(f.data, rl, name)).toEqual([]);
    }
    const fu = fake.find((e) => e.event === "usage")?.data as Loose;
    expect(fu.savedPct).toBeLessThanOrEqual(1);
  });

  it("routines, runs and questions", async () => {
    const body = {
      name: "Contract notes",
      source: { kind: "manual" },
      schedule: "manual",
      targetScopeId: "c_delivery",
      guardrails: { excludePersonal: true, excludeHR: true, excludeNewsletters: true },
      enabled: true,
    };
    const rt = await json<Loose>(await as("consultant", "/v1/routines", { body }));
    const WORK =
      "The pricing approach for phase 2 was agreed with the steering group. The fixed fee covers three deliverables. A quarterly review of the fee is planned.";
    const run = await json<Loose>(
      await as("consultant", `/v1/routines/${rt.id}/run`, {
        method: "POST",
        body: {
          items: [
            { title: "Phase 2 pricing", text: WORK },
            { title: "Status", text: `${WORK} My son is sick today.` },
          ],
        },
      }),
    );
    const fakeRt = mock("POST", "/v1/routines", "consultant", body);
    expect(drift(fakeRt, [rt])).toEqual([]);
    expect(drift(mock("POST", `/v1/routines/${fakeRt.id}/run`, "consultant", {}), [run])).toEqual(
      [],
    );
    const runs = await json<Loose[]>(await as("consultant", `/v1/routines/${rt.id}/runs`));
    expect(drift(mock("GET", `/v1/routines/${fakeRt.id}/runs`, "consultant"), [runs])).toEqual([]);

    // Questions: one sample per kind the real stack can raise here, compared with the mock's own of that kind.
    const real: Loose[] = [
      ...(await json<Loose[]>(await as("consultant", "/v1/questions"))),
      ...(await json<Loose[]>(await as("reviewer", "/v1/questions"))),
    ];
    expect(real.length).toBeGreaterThan(0);
    const fake = mock("GET", "/v1/questions", "reviewer") as Loose[];
    for (const kind of new Set(real.map((q) => q.kind))) {
      const f = fake.filter((q) => q.kind === kind);
      const rl = real.filter((q) => q.kind === kind);
      for (const q of f) expect(drift(q, rl, `question(${kind})`)).toEqual([]);
    }
    // Option actions the mock offers are ones the API accepts.
    const allowed: Record<string, string[]> = {
      ingest: ["ingest", "skip"],
      contradiction: ["prefer_incoming", "keep_current"],
      lint: ["approve", "reject"],
      review: ["approve", "reject", "accept", "request_changes"],
      release: ["approve", "request_changes"],
    };
    for (const q of fake)
      for (const o of q.options) expect(allowed[q.kind], `${q.id} ${o.action}`).toContain(o.action);
    expect(ALPHA).toBeTruthy();
  });
});
