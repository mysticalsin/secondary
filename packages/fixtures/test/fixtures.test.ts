import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type FileMap, generate, hashFiles } from "../src/generate.ts";

const AT = "2026-01-01T00:00:00.000Z";
const files: FileMap = generate({ seed: 7, generatedAt: AT });
const paths = Object.keys(files);
const docs = paths.filter((p) => p.startsWith("docs/"));
const meetings = paths.filter((p) => p.startsWith("meetings/"));
const json = (p: string) => JSON.parse(files[p] as string);
const front = (p: string, key: string) =>
  new RegExp(`^${key}: (.+)$`, "m").exec(files[p] as string)?.[1];

describe("determinism", () => {
  it("same seed gives identical content and hash, even with a different timestamp", () => {
    const again = generate({ seed: 7, generatedAt: "2030-05-05T00:00:00.000Z" });
    expect(hashFiles(again)).toBe(hashFiles(files));
    expect(generate({ seed: 7, generatedAt: AT })).toEqual(files);
  });
  it("different seed gives a different hash", () => {
    expect(hashFiles(generate({ seed: 8, generatedAt: AT }))).not.toBe(hashFiles(files));
  });
});

describe("shape", () => {
  it("has the expected counts", () => {
    expect(docs).toHaveLength(500);
    expect(meetings).toHaveLength(50);
    const m = json("manifest.json");
    expect(m.tenants).toEqual(["tenant-alpha", "tenant-beta"]);
    expect(m.counts).toMatchObject({
      accounts: 4,
      people: 12,
      docs: 500,
      meetings: 50,
      hostile_docs: 3,
    });
  });
  it("registry lists 3 alpha accounts and 1 beta account, only Calypso NDA-hidden", () => {
    const rows = (files["accounts.csv"] as string)
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split(","));
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r[1] === "tenant-alpha")).toHaveLength(3);
    expect(rows.filter((r) => r[1] === "tenant-beta")).toHaveLength(1);
    expect(rows.filter((r) => r[3] === "true").map((r) => r[2])).toEqual(["Calypso Demo GmbH"]);
  });
  it("every account has all three subspaces populated", () => {
    for (const acct of ["acct-acme", "acct-borealis", "acct-calypso", "acct-delta"]) {
      for (const sub of ["general", "contacts", "restricted-commercial"]) {
        expect(docs.some((p) => p.startsWith(`docs/${acct}/${sub}/`))).toBe(true);
      }
    }
  });
  it("people cover the required archetypes", () => {
    const { people, memberships } = json("people.json");
    expect(people).toHaveLength(12);
    const withAccess = new Set(memberships.map((m: { principal_id: string }) => m.principal_id));
    const denied = people.find((p: { archetype: string }) => p.archetype === "denied");
    expect(withAccess.has(denied.id)).toBe(false);
    const acmeOnly = people.find((p: { archetype: string }) => p.archetype === "acme_only_member");
    const mine = memberships.filter(
      (m: { principal_id: string }) => m.principal_id === acmeOnly.id,
    );
    expect(mine.map((m: { account_id: string }) => m.account_id)).toEqual(["acct-acme"]);
    const roles = memberships.map((m: { role: string }) => m.role);
    expect(roles).toContain("reviewer");
    expect(roles).toContain("steward");
  });
  it("every meeting has at least one decision and one action", () => {
    for (const p of meetings) {
      const t = files[p] as string;
      expect(t).toMatch(/^- DEC-/m);
      expect(t).toMatch(/^- \[ \] ACT-/m);
    }
  });
  it("marks 3 hostile docs in the manifest, each containing injection text", () => {
    const { hostile_docs } = json("manifest.json");
    expect(hostile_docs).toHaveLength(3);
    for (const h of hostile_docs) {
      expect(files[h.path]).toMatch(/ignore previous instructions/i);
      expect(h.target_account_id).not.toBe(h.account_id);
    }
  });
});

describe("canaries", () => {
  const canaries = json("canaries.json") as Record<
    string,
    { tenant_id: string; account_id: string; subspace_id: string | null }
  >;
  const tokens = Object.keys(canaries);
  it("has 16 unique tokens: 4 accounts x (1 account + 3 subspaces)", () => {
    expect(tokens).toHaveLength(16);
    expect(new Set(tokens).size).toBe(16);
  });
  it("each token appears in at least one doc and only inside its own boundary", () => {
    const content = [...docs, ...meetings];
    for (const tok of tokens) {
      const b = canaries[tok] as {
        tenant_id: string;
        account_id: string;
        subspace_id: string | null;
      };
      const hits = content.filter((p) => (files[p] as string).includes(tok));
      expect(hits.length, tok).toBeGreaterThan(0);
      for (const p of hits) {
        expect(front(p, "tenant_id"), `${tok} in ${p}`).toBe(b.tenant_id);
        expect(front(p, "account_id"), `${tok} in ${p}`).toBe(b.account_id);
        if (b.subspace_id) expect(front(p, "subspace_id"), `${tok} in ${p}`).toBe(b.subspace_id);
      }
    }
  });
  it("tokens appear in no file outside docs, meetings and canaries.json", () => {
    for (const p of paths) {
      if (p === "canaries.json" || p.startsWith("docs/") || p.startsWith("meetings/")) continue;
      for (const tok of tokens) expect(files[p], p).not.toContain(tok);
    }
  });
});

describe("safety", () => {
  it("every email address uses the reserved .invalid domain", () => {
    const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g;
    let seen = 0;
    for (const p of paths) {
      for (const m of (files[p] as string).match(re) ?? []) {
        seen++;
        expect(m, p).toMatch(/@example\.invalid$/);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("provenance states that no external data was read", () => {
    const p = json("provenance.json");
    expect(p).toMatchObject({ seed: 7, generated_at: AT, external_data_read: false });
    expect(p.version).toBeTruthy();
  });
  it("generator source never references vault paths and only cli.ts touches the filesystem", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    for (const f of readdirSync(srcDir)) {
      const text = readFileSync(join(srcDir, f), "utf8");
      expect(text, f).not.toMatch(/_brain_api|OneDrive|AI Second Brain/);
      expect(text, f).not.toMatch(/node:(http|https|net|dgram|child_process)|fetch\(/);
      if (f !== "cli.ts") expect(text, f).not.toMatch(/node:fs/);
    }
  });
});

describe("no personal data (GDPR guard)", () => {
  const sampleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "sample");
  const readTree = (dir: string, base = ""): FileMap => {
    const out: FileMap = {};
    for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
      const rel = join(base, e.name);
      if (e.isDirectory()) Object.assign(out, readTree(dir, rel));
      else out[rel] = readFileSync(join(dir, rel), "utf8");
    }
    return out;
  };
  const targets: [string, FileMap][] = [
    ["generated", files],
    ["committed sample", readTree(sampleDir)],
  ];
  const DENY = ["loreal", "l'oreal", "l’oreal", "nestle", "nestlé", "danone", "sanofi"];
  const PHONE = /(?<![\w.-])\+?\(?\d[\d\s().-]{7,}\d(?![\w])/g;
  const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

  for (const [label, set] of targets) {
    it(`${label}: only example.invalid emails`, () => {
      for (const [p, c] of Object.entries(set)) {
        for (const m of c.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []) {
          expect(m, p).toMatch(/@example\.invalid$/);
        }
      }
    });
    it(`${label}: no phone-number patterns`, () => {
      for (const [p, c] of Object.entries(set)) {
        expect(c.replace(ISO_DATE, "").match(PHONE) ?? [], p).toEqual([]);
      }
    });
    it(`${label}: no real client names`, () => {
      for (const [p, c] of Object.entries(set)) {
        const lower = c.toLowerCase();
        for (const name of DENY) expect(lower, `${name} in ${p}`).not.toContain(name);
      }
    });
  }

  it("the sample is non-empty and the phone pattern does catch phone numbers", () => {
    expect(Object.keys(targets[1]?.[1] ?? {}).length).toBeGreaterThan(0);
    for (const s of ["+33 1 23 45 67 89", "(514) 555-0142", "514-555-0142", "+1.514.555.0142"]) {
      expect(s.match(PHONE), s).not.toBeNull();
    }
  });
});
