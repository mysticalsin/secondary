// Parsing of SCIM filters and PATCH operations (RFC 7644 sections 3.4.2.2 and 3.5.2). Only what
// Entra ID sends is supported: `attr eq "value"` filters and add/remove/replace operations.

import type { Email, GroupOp, NameRec, UserChange } from "../auth/identity-store.ts";

type ScimType = "invalidFilter" | "invalidValue" | "invalidPath" | "invalidSyntax";

export class ScimParseError extends Error {
  readonly scimType: ScimType;
  constructor(scimType: ScimType, detail: string) {
    super(detail);
    this.scimType = scimType;
  }
}

const FILTER = /^\s*([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i;
const unquote = (s: string): string => s.replace(/\\(.)/g, "$1");

/** `attr eq "value"` with the attribute (lower case) in `allowed`. Undefined for no filter. */
export function parseFilter(
  raw: string | undefined,
  allowed: readonly string[],
): { attr: string; value: string } | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const m = FILTER.exec(raw);
  if (!m) throw new ScimParseError("invalidFilter", 'Only `attribute eq "value"` is supported.');
  const attr = (m[1] as string).toLowerCase();
  if (!allowed.includes(attr))
    throw new ScimParseError("invalidFilter", `Filtering on ${m[1]} is not supported.`);
  return { attr, value: unquote(m[2] as string) };
}

const asBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && /^(true|false)$/i.test(v.trim()))
    return v.trim().toLowerCase() === "true";
  throw new ScimParseError("invalidValue", "active must be a boolean.");
};
const asString = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new ScimParseError("invalidValue", `${what} must be a string.`);
  return v;
};
const asNullableString = (v: unknown, what: string): string | null =>
  v === null ? null : asString(v, what);

/** Only string-valued name parts are kept (givenName, familyName, formatted, ...). */
const nameOf = (v: unknown): NameRec => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ScimParseError("invalidValue", "name must be an object.");
  const out: NameRec = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x.slice(0, 256);
  return out;
};
const emailsOf = (v: unknown): Email[] => {
  if (!Array.isArray(v)) throw new ScimParseError("invalidValue", "emails must be an array.");
  return v.slice(0, 10).flatMap((e): Email[] => {
    const x = e as { value?: unknown; type?: unknown; primary?: unknown } | null;
    if (!x || typeof x.value !== "string") return [];
    return [
      {
        value: x.value.slice(0, 254),
        ...(typeof x.type === "string" ? { type: x.type.slice(0, 32) } : {}),
        ...(typeof x.primary === "boolean" ? { primary: x.primary } : {}),
      },
    ];
  });
};

type Op = { op: string; path?: string; value?: unknown };

/** The validated operation list of a PatchOp message. */
export function patchOps(body: unknown): Op[] {
  const b = body as { Operations?: unknown } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.Operations) || b.Operations.length === 0)
    throw new ScimParseError("invalidSyntax", "Operations is required.");
  return b.Operations.map((o): Op => {
    const x = o as Op | null;
    const op = typeof x?.op === "string" ? x.op.toLowerCase() : "";
    if (!x || (op !== "add" && op !== "remove" && op !== "replace"))
      throw new ScimParseError("invalidSyntax", "op must be add, remove or replace.");
    if (x.path !== undefined && typeof x.path !== "string")
      throw new ScimParseError("invalidPath", "path must be a string.");
    return { op, path: x.path, value: x.value };
  });
}

/** Folds user PATCH operations, in order, into one change. Unknown attributes are ignored. */
export function userChange(ops: Op[]): UserChange {
  const c: UserChange = {};
  const set = (path: string, value: unknown, remove: boolean) => {
    const p = path.toLowerCase();
    if (p === "active") {
      if (!remove) c.active = asBool(value);
    } else if (p === "username") {
      if (!remove) c.userName = asString(value, "userName");
    } else if (p === "displayname")
      c.displayName = remove ? null : asNullableString(value, "displayName");
    else if (p === "externalid")
      c.externalId = remove ? null : asNullableString(value, "externalId");
    else if (p === "name") {
      if (remove || value === null) c.name = null;
      else c.name = nameOf(value);
    } else if (p.startsWith("name.")) {
      const key = path.slice(5);
      if (["givenName", "familyName", "formatted"].includes(key) && !remove)
        c.name = { ...(c.name ?? {}), [key]: asString(value, path) };
    } else if (p === "emails" || p.startsWith("emails[")) {
      if (remove) c.emails = null;
      else if (p === "emails") {
        if (!Array.isArray(value))
          throw new ScimParseError("invalidValue", "emails must be an array.");
        c.emails = emailsOf(value);
      } else c.emails = [{ value: asString(value, "emails.value"), type: "work", primary: true }];
    }
  };
  for (const o of ops) {
    const remove = o.op === "remove";
    if (o.path) set(o.path, o.value, remove);
    else if (o.value && typeof o.value === "object" && !Array.isArray(o.value))
      for (const [k, v] of Object.entries(o.value)) set(k, v, remove);
    else throw new ScimParseError("invalidSyntax", "An operation needs a path or an object value.");
  }
  return c;
}

const memberIds = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new ScimParseError("invalidValue", "members must be an array.");
  return v.map((m) => {
    const id = (m as { value?: unknown } | null)?.value;
    if (typeof id !== "string" || id.length > 64)
      throw new ScimParseError("invalidValue", "A member needs a string value.");
    return id;
  });
};

const MEMBER_PATH = /^members\[\s*value\s+eq\s+"([^"]{1,64})"\s*\]$/i;

/** Group PATCH operations as an ordered list the store applies all-or-nothing. */
export function groupOps(ops: Op[]): GroupOp[] {
  const out: GroupOp[] = [];
  const one = (kind: "add" | "remove" | "replace", path: string, value: unknown) => {
    const p = path.toLowerCase();
    const mp = MEMBER_PATH.exec(path);
    if (mp && kind === "remove") out.push({ kind: "remove", ids: [mp[1] as string] });
    else if (p === "members") {
      if (kind === "remove")
        out.push(
          value === undefined
            ? { kind: "replace", ids: [] }
            : { kind: "remove", ids: memberIds(value) },
        );
      else out.push({ kind, ids: memberIds(value) });
    } else if (p === "displayname" && kind !== "remove")
      out.push({ kind: "name", value: asString(value, "displayName") });
    else if (p === "externalid")
      out.push({
        kind: "externalId",
        value: kind === "remove" ? null : asNullableString(value, "externalId"),
      });
  };
  for (const o of ops) {
    const kind = o.op as "add" | "remove" | "replace";
    if (o.path) one(kind, o.path, o.value);
    else if (o.value && typeof o.value === "object" && !Array.isArray(o.value))
      for (const [k, v] of Object.entries(o.value)) one(kind, k, v);
    else throw new ScimParseError("invalidSyntax", "An operation needs a path or an object value.");
  }
  return out;
}

export const userCreate = (b: unknown) => {
  const o = b as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o))
    throw new ScimParseError("invalidSyntax", "A JSON object is required.");
  const userName = asString(o.userName, "userName").trim();
  if (!userName) throw new ScimParseError("invalidValue", "userName is required.");
  return {
    userName,
    externalId: o.externalId === undefined ? null : asNullableString(o.externalId, "externalId"),
    displayName:
      o.displayName === undefined ? null : asNullableString(o.displayName, "displayName"),
    name: o.name === undefined ? null : nameOf(o.name),
    emails: o.emails === undefined ? null : emailsOf(o.emails),
    active: o.active === undefined ? true : asBool(o.active),
  };
};

export const groupCreate = (b: unknown) => {
  const o = b as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o))
    throw new ScimParseError("invalidSyntax", "A JSON object is required.");
  return {
    displayName: asString(o.displayName, "displayName"),
    externalId: o.externalId === undefined ? null : asNullableString(o.externalId, "externalId"),
    memberIds: o.members === undefined ? [] : memberIds(o.members),
  };
};
