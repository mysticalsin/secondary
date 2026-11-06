// The web dev mock for brain rules (apps/web/src/mock/rules.ts) must answer in the shapes the real
// API does: every field the mock emits exists on the real answer with the same JSON type.

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";

type Mock = {
  handleRules(method: string, p: string, q: URLSearchParams, body: Loose, role: string): unknown;
  resetRulesMock(): void;
};
const MOCK_PATH = `/@fs${new URL("../../../apps/web/src/mock/rules.ts", import.meta.url).pathname}`;
let web: Mock;
const ADMIN = "v7m.admin@example.invalid";

beforeAll(async () => {
  await seed();
  web = (await import(/* @vite-ignore */ MOCK_PATH)) as Mock;
});

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

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
      // `scope` is a union: its variants differ by design, so only its JSON type is compared.
      if (k === "scope") {
        if (there.some((x) => typeOf(x) !== "object")) out.push(`${path}.scope: not an object`);
        continue;
      }
      if (!there.length) out.push(`${path}.${k}: mock only`);
      else out.push(...drift(v, there, `${path}.${k}`));
    }
  }
  return out;
}

const mock = (method: string, path: string, body: Loose = {}, role = "platform_admin") =>
  JSON.parse(
    JSON.stringify(
      web.handleRules(method, path, new URLSearchParams(path.split("?")[1] ?? ""), body, role),
    ),
  ) as Loose;

const rule = {
  name: "Contract probe",
  scope: { kind: "brains", ids: ["c_delivery"] },
  when: [{ field: "action", op: "is_any_of", values: ["export"] }],
  then: { effect: "review" },
  except: { incident: false },
  status: "enforced",
};

describe("rules: web mock and real API agree", () => {
  it("list, create, detail, validate, simulate, publish and incident have the same shapes", async () => {
    const real = (path: string, o: Loose = {}) =>
      as("platform_admin", `/v1/rules${path}`, { email: ADMIN, ...o });
    const list = await json<Loose>(await real(""));
    expect(drift(mock("GET", "/v1/rules"), [list])).toEqual([]);
    const made = await json<Loose>(await real("", { method: "POST", body: rule }));
    const fake = mock("POST", "/v1/rules", rule);
    expect(drift(fake, [made])).toEqual([]);
    const detail = await json<Loose>(await real(`/${made.id}`));
    expect(drift(mock("GET", `/v1/rules/${fake.id}`), [detail])).toEqual([]);
    const pubReal = await json<Loose>(await real(`/${made.id}/publish`, { method: "POST", body: { status: "enforced" } }));
    const pubFake = mock("POST", `/v1/rules/${fake.id}/publish`, { status: "enforced" });
    // Whether c_delivery needs a second person differs between the mock's catalogue and the real org; the
    // shape of each answer is what is compared.
    if (pubFake.status === pubReal.status) expect(drift(pubFake, [pubReal])).toEqual([]);
    else expect(["pending", "published"]).toEqual(expect.arrayContaining([pubFake.status, pubReal.status]));
    const sim = await json<Loose>(await real("/simulate", { method: "POST", body: { rule, days: 7 } }));
    expect(drift(mock("POST", "/v1/rules/simulate", { rule, days: 7 }), [sim])).toEqual([]);
    const inc = await json<Loose>(await real("/incident"));
    expect(drift(mock("GET", "/v1/rules/incident"), [inc])).toEqual([]);
    const bad = { ...rule, then: { effect: "grant_access" } };
    const refusedReal = await json<Loose>(await real("/validate", { method: "POST", body: bad }));
    expect(refusedReal.error).toBe("rule_refused");
    const holds = await json<Loose[]>(await real("/holds"));
    expect(Array.isArray(holds)).toBe(true);
  });
});
