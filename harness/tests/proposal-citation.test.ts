/**
 * Which source ids a proposal body cites, and which shapes are not the stored one.
 * The function does not throw.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { citedSourceIds } from "../../src/state/proposal-citation.ts";

function seen(body: string): { ids: string[]; malformed: boolean } {
  const out = citedSourceIds(body);
  return { ids: [...out.ids].sort(), malformed: out.malformed };
}

function withField(field: string, value: unknown): string {
  const body: Record<string, unknown> = {
    titleSources: [],
    reingest: [],
    sources: [],
    facts: [],
  };
  if (value === undefined) delete body[field];
  else body[field] = value;
  return JSON.stringify(body);
}

test("citedSourceIds: a missing citation field is not malformed", () => {
  assert.deepEqual(
    ["titleSources", "reingest", "sources", "facts"].map((field) => seen(withField(field, undefined))),
    [
      { ids: [], malformed: false },
      { ids: [], malformed: false },
      { ids: [], malformed: false },
      { ids: [], malformed: false },
    ],
  );
});

test("citedSourceIds: titleSources keeps strings and rejects every other shape", () => {
  assert.deepEqual(
    {
      string: seen(withField("titleSources", "src_1")),
      number: seen(withField("titleSources", 1)),
      null: seen(withField("titleSources", null)),
      object: seen(withField("titleSources", { id: "src_1" })),
      objects: seen(withField("titleSources", [{ id: "src_1" }])),
      strings: seen(withField("titleSources", ["src_1", "src_10"])),
      longer: seen(withField("titleSources", ["src_10"])),
    },
    {
      string: { ids: [], malformed: true },
      number: { ids: [], malformed: true },
      null: { ids: [], malformed: true },
      object: { ids: [], malformed: true },
      objects: { ids: [], malformed: true },
      strings: { ids: ["src_1", "src_10"], malformed: false },
      longer: { ids: ["src_10"], malformed: false },
    },
  );
});

test("citedSourceIds: reingest keeps strings and rejects every other shape", () => {
  assert.deepEqual(
    {
      string: seen(withField("reingest", "src_1")),
      number: seen(withField("reingest", 1)),
      null: seen(withField("reingest", null)),
      object: seen(withField("reingest", { id: "src_1" })),
      objects: seen(withField("reingest", [{ id: "src_1" }])),
      strings: seen(withField("reingest", ["src_1"])),
      longer: seen(withField("reingest", ["src_10"])),
    },
    {
      string: { ids: [], malformed: true },
      number: { ids: [], malformed: true },
      null: { ids: [], malformed: true },
      object: { ids: [], malformed: true },
      objects: { ids: [], malformed: true },
      strings: { ids: ["src_1"], malformed: false },
      longer: { ids: ["src_10"], malformed: false },
    },
  );
});

test("citedSourceIds: sources keep object ids and string elements are malformed", () => {
  assert.deepEqual(
    {
      string: seen(withField("sources", "src_1")),
      number: seen(withField("sources", 1)),
      null: seen(withField("sources", null)),
      object: seen(withField("sources", { id: "src_1" })),
      objects: seen(withField("sources", [{ id: "src_1", hash: "h", title: "src_10" }])),
      strings: seen(withField("sources", ["src_1"])),
      longer: seen(withField("sources", ["src_10"])),
      title: seen(withField("sources", [{ id: "src_9", hash: "h", title: "src_1" }])),
    },
    {
      string: { ids: [], malformed: true },
      number: { ids: [], malformed: true },
      null: { ids: [], malformed: true },
      object: { ids: [], malformed: true },
      objects: { ids: ["src_1"], malformed: false },
      strings: { ids: [], malformed: true },
      longer: { ids: [], malformed: true },
      title: { ids: ["src_9"], malformed: false },
    },
  );
});

test("citedSourceIds: facts keep a sourceIds array and a string is malformed", () => {
  assert.deepEqual(
    {
      string: seen(withField("facts", "src_1")),
      number: seen(withField("facts", 1)),
      null: seen(withField("facts", null)),
      object: seen(withField("facts", { sourceIds: ["src_1"] })),
      strings: seen(withField("facts", ["src_1"])),
      sourceIdsString: seen(withField("facts", [{ sourceIds: "src_1" }])),
      sourceIdsArray: seen(withField("facts", [{ sourceIds: ["src_1", "src_10"] }])),
      longer: seen(withField("facts", [{ sourceIds: ["src_10"] }])),
      missingIds: seen(withField("facts", [{}])),
    },
    {
      string: { ids: [], malformed: true },
      number: { ids: [], malformed: true },
      null: { ids: [], malformed: true },
      object: { ids: [], malformed: true },
      strings: { ids: [], malformed: true },
      sourceIdsString: { ids: [], malformed: true },
      sourceIdsArray: { ids: ["src_1", "src_10"], malformed: false },
      longer: { ids: ["src_10"], malformed: false },
      missingIds: { ids: [], malformed: false },
    },
  );
});

test("citedSourceIds: invalid JSON is malformed and has no ids", () => {
  assert.deepEqual(
    { text: seen(`not-json "src_1"`), array: seen("[]"), number: seen("1") },
    {
      text: { ids: [], malformed: true },
      array: { ids: [], malformed: true },
      number: { ids: [], malformed: true },
    },
  );
});
