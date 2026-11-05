import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPONENT_TYPES, SCHEMA_NAMES, type ViewPlan, validate } from "../src/index.ts";

const schemasDir = resolve(dirname(fileURLToPath(import.meta.url)), "../schemas");
const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

interface Entry {
  schema: string;
  example: string;
  expected_schema_valid: boolean;
  expect_error_match?: string;
}
const manifest = read(resolve(schemasDir, "example-manifest.json")) as Entry[];

describe("example manifest", () => {
  it("lists at least 54 examples and every file on disk", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(54);
    expect(manifest.filter((e) => e.expected_schema_valid).length).toBeGreaterThan(20);
    expect(manifest.filter((e) => !e.expected_schema_valid).length).toBeGreaterThan(20);
    for (const e of manifest) expect(() => read(resolve(schemasDir, e.example))).not.toThrow();
  });

  it("covers every schema except common", () => {
    expect(new Set(manifest.map((e) => e.schema.replace(".schema.json", "")))).toEqual(
      new Set(SCHEMA_NAMES),
    );
  });

  it.each(manifest.map((e) => [e.example.replace("../examples/", ""), e] as const))(
    "%s",
    (_name, e) => {
      const r = validate(e.schema, read(resolve(schemasDir, e.example)));
      expect(r.valid).toBe(e.expected_schema_valid);
      if (e.expected_schema_valid) expect(r.errors).toEqual([]);
      else {
        expect(r.errors.length).toBeGreaterThan(0);
        if (e.expect_error_match) expect(r.errors.join(" | ")).toContain(e.expect_error_match);
      }
    },
  );
});

describe("validate", () => {
  it("accepts a schema name with or without the suffix and rejects unknown names", () => {
    const v = read(resolve(schemasDir, "../examples/audit-event.valid.json"));
    expect(validate("audit-event", v).valid).toBe(true);
    expect(validate("audit-event.schema.json", v).valid).toBe(true);
    expect(() => validate("nope", v)).toThrow(/unknown schema/);
    expect(() => validate("common", v)).toThrow(/unknown schema/);
  });
});

describe("ViewPlan", () => {
  const plan = (components: unknown[], extra: Record<string, unknown> = {}) => ({
    version: 1,
    title: "Plan",
    components,
    ...extra,
  });
  const ok = (components: unknown[]) => validate("view-plan", plan(components));

  it("has a typed example for every catalog component", () => {
    const all: ViewPlan = {
      version: 1,
      title: "All",
      components: [
        { type: "KpiRow", props: { lens: "departments", metrics: ["items"] } },
        { type: "NodeCard", props: { nodeId: "c_bid" } },
        { type: "ItemList", props: { nodeId: "c_bid", filter: { status: "draft" }, limit: 5 } },
        { type: "AccountSummary", props: { accountId: "a_acme" } },
        { type: "StageBoard", props: {} },
        { type: "MapMini", props: { lens: "accounts", hops: 1 } },
        { type: "Callout", props: { template: "empty" } },
        { type: "Table", props: { lens: "topics", sort: { by: "items", dir: "desc" } } },
      ],
    };
    expect(validate("view-plan", all)).toEqual({ valid: true, errors: [] });
    expect(all.components.map((c) => c.type)).toEqual([...COMPONENT_TYPES]);
  });

  it("rejects an unknown component type", () => {
    const r = ok([{ type: "RawHtml", props: { nodeId: "c_bid" } }]);
    expect(r.valid).toBe(false);
    expect(ok([{ type: "kpirow", props: {} }]).valid).toBe(false);
  });

  it.each(["data", "items", "rows", "content", "records"])(
    "rejects inline content in a prop named %s",
    (name) => {
      for (const type of ["NodeCard", "ItemList", "Table", "KpiRow"]) {
        const r = ok([{ type, props: { nodeId: "c_bid", [name]: [{ title: "inline" }] } }]);
        expect(r.valid, `${type}.${name}`).toBe(false);
        expect(r.errors.join("|")).toContain(name);
      }
    },
  );

  it("rejects permissions, extra keys and wrong versions", () => {
    const c = [{ type: "NodeCard", props: { nodeId: "c_bid" } }];
    expect(validate("view-plan", plan(c, { permissions: ["view_content"] })).valid).toBe(false);
    expect(validate("view-plan", plan(c, { role: "ceo" })).valid).toBe(false);
    expect(validate("view-plan", { ...plan(c), version: 2 }).valid).toBe(false);
    expect(validate("view-plan", { ...plan(c), version: "1" }).valid).toBe(false);
    expect(ok([{ type: "NodeCard", props: { nodeId: "c_bid" }, html: "<b>x</b>" }]).valid).toBe(
      false,
    );
  });

  it("enforces required queries, id tokens and bounds", () => {
    expect(ok([]).valid).toBe(false);
    expect(
      ok(Array.from({ length: 13 }, () => ({ type: "NodeCard", props: { nodeId: "c_bid" } })))
        .valid,
    ).toBe(false);
    expect(ok([{ type: "NodeCard", props: {} }]).valid).toBe(false);
    expect(ok([{ type: "AccountSummary", props: { nodeId: "a_acme" } }]).valid).toBe(false);
    expect(ok([{ type: "MapMini", props: {} }]).valid).toBe(false);
    expect(ok([{ type: "Table", props: {} }]).valid).toBe(false);
    expect(ok([{ type: "NodeCard", props: { nodeId: "../x" } }]).valid).toBe(false);
    expect(ok([{ type: "NodeCard", props: { nodeId: "a b" } }]).valid).toBe(false);
    expect(ok([{ type: "ItemList", props: { nodeId: "c_bid", limit: 0 } }]).valid).toBe(false);
    expect(ok([{ type: "Callout", props: { template: "Hello, free text" } }]).valid).toBe(false);
    expect(ok([{ type: "MapMini", props: { lens: "people" } }]).valid).toBe(false);
    expect(
      validate("view-plan", plan([{ type: "NodeCard", props: { nodeId: "c_bid" } }], { title: "" }))
        .valid,
    ).toBe(false);
  });

  it("accepts the node id grammar the policy package issues", () => {
    for (const id of [
      "core",
      "c_bid:pricing-models",
      "k_ivory_coast",
      "a_acme:eng:0",
      "pb:u_ceo:1",
      "g_lbc:c:in-design",
    ]) {
      expect(ok([{ type: "NodeCard", props: { nodeId: id } }]).valid, id).toBe(true);
    }
  });
});
