// From a parse result to a validated view tree. This is the gate between what a model wrote and what
// is drawn: only registered components, only props that pass their Zod schema, only children a
// parent may hold, bounded depth and node count. Anything else is dropped and counted, never drawn.
// Statements that are not components (Query, Mutation, $state, functions) are never evaluated:
// they are counted as `rejected`.

import type { ParseResult } from "@openuidev/lang-core";
import type { ZodType } from "zod";
import { newAgentParser, parseAgentProgram } from "./library.ts";
import { COMPONENTS, type ComponentName, LIMITS, type PlanNodeType } from "./schemas.ts";

export interface AgentNode {
  /** The statement name in the program, or a path. Stable across streaming re-parses. */
  id: string;
  type: PlanNodeType;
  /** Validated props without the child slot. */
  props: Record<string, unknown>;
  children: AgentNode[];
  /** The node is still streaming: draw a skeleton. */
  partial?: boolean;
}

export interface AgentView {
  root: AgentNode | null;
  /** The program ended cleanly (no truncated statement). */
  complete: boolean;
  /** References used but not yet defined (cards still to come while streaming). */
  pending: number;
  /** Components or props dropped by the checks. */
  dropped: number;
  /** Query, Mutation, state or function statements that were refused. */
  rejected: number;
}

interface Ctx {
  nodes: number;
  dropped: number;
  /** Statements the parser itself flagged (wrong type, too many arguments): dropped whole. */
  bad: ReadonlySet<string>;
  /** Flagged statements the walk reached (and counted). The rest were cut out by the parser itself. */
  hit: Set<string>;
  /** The parse left references to other lines unresolved and a card has no child yet: keep it (checking one line alone). */
  pendingOk: boolean;
}

interface El {
  type: "element";
  typeName: string;
  props: Record<string, unknown>;
  partial?: boolean;
  statementId?: string;
}
const isEl = (v: unknown): v is El =>
  !!v && typeof v === "object" && (v as { type?: unknown }).type === "element";

interface Spec {
  props: ZodType;
  holds?: readonly string[];
  slot?: "children" | "items";
}

function convert(
  raw: unknown,
  parent: ComponentName | null,
  depth: number,
  path: string,
  ctx: Ctx,
): AgentNode | null {
  // null or undefined is a reference that has not arrived yet: nothing to draw, nothing to count.
  if (raw === null || raw === undefined) return null;
  if (!isEl(raw) || !Object.hasOwn(COMPONENTS, raw.typeName)) {
    ctx.dropped++;
    return null;
  }
  const type = raw.typeName as ComponentName;
  const spec = COMPONENTS[type] as Spec;
  if (parent && !(COMPONENTS[parent] as Spec).holds?.includes(type)) {
    ctx.dropped++;
    return null;
  }
  if (depth > LIMITS.maxDepth || ctx.nodes >= LIMITS.maxNodes) {
    ctx.dropped++;
    return null;
  }
  const id = raw.statementId ?? path;
  if (raw.statementId && ctx.bad.has(raw.statementId)) {
    ctx.hit.add(raw.statementId);
    ctx.dropped++;
    return null;
  }
  if (raw.partial) return { id, type, props: {}, children: [], partial: true };
  ctx.nodes++;
  // A prop the model left out is null positionally: that means "not set".
  const given = Object.fromEntries(
    Object.entries(raw.props).filter(([, v]) => v !== null && v !== undefined),
  );
  const slot = spec.slot;
  // Checking one line alone: a child slot waiting on other lines is empty, so give it a stand-in.
  const toCheck =
    ctx.pendingOk && depth === 0 && slot && Array.isArray(given[slot]) && given[slot].length === 0
      ? { ...given, [slot]: [null] }
      : given;
  const ok = spec.props.safeParse(toCheck);
  if (!ok.success) {
    ctx.dropped++;
    return null;
  }
  const rest = { ...(ok.data as Record<string, unknown>) };
  const children: AgentNode[] = [];
  if (slot) {
    delete rest[slot];
    // (the stand-in above is dropped here: `held` comes from the real props)
    const held = Array.isArray(given[slot]) ? (given[slot] as unknown[]) : [];
    for (const [n, child] of held.entries()) {
      const c = convert(child, type, depth + 1, `${id}.${n}`, ctx);
      if (c) children.push(c);
    }
    // A card with nothing in it, or a button row with no valid button, is dropped whole. When one line
    // is checked alone its children are references to other lines: those are not an empty card.
    const awaited = ctx.pendingOk && depth === 0;
    if (!children.length && !awaited && type !== "Stack" && type !== "Grid") {
      ctx.dropped++;
      return null;
    }
  }
  return { id, type, props: rest, children };
}

/** Build the checked tree from a parse result. */
export function toView(r: ParseResult, opts: { pendingOk?: boolean } = {}): AgentView {
  const bad = new Set(r.meta.errors.flatMap((e) => (e.statementId ? [e.statementId] : [])));
  const ctx: Ctx = {
    nodes: 0,
    dropped: 0,
    bad,
    hit: new Set(),
    pendingOk: opts.pendingOk === true && r.meta.unresolved.length > 0,
  };
  const root = convert(r.root, null, 0, "root", ctx);
  const rejected =
    r.queryStatements.length +
    r.mutationStatements.length +
    Object.keys(r.stateDeclarations).length;
  return {
    root,
    complete: !r.meta.incomplete,
    pending: r.meta.unresolved.length,
    // A flagged statement the parser cut out before the walk (an unknown component inside a list) still counts.
    dropped:
      ctx.dropped +
      r.meta.errors.filter(
        (e) => e.code !== "no-root" && !(e.statementId && ctx.hit.has(e.statementId)),
      ).length,
    rejected,
  };
}

const STATEMENT = /^(root|[a-z][A-Za-z0-9_]{0,31})\s*=\s*[A-Z][A-Za-z]{1,23}\(/;

/**
 * Keep only statement lines. Fences, blank lines, prose and statements that do not call a component
 * are dropped, so a stray sentence cannot reach the parser. Bounded in lines and bytes. The last
 * line of a stream may be unfinished: it is kept only when it already looks like a statement.
 */
export function clean(text: string): { lines: string[]; dropped: number } {
  const out: string[] = [];
  let dropped = 0;
  let bytes = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) continue;
    if (!STATEMENT.test(line) || /=\s*(Query|Mutation)\s*\(/.test(line)) {
      dropped++;
      continue;
    }
    bytes += line.length + 1;
    if (out.length >= LIMITS.maxLines || bytes > LIMITS.maxProgramBytes) {
      dropped++;
      continue;
    }
    out.push(line);
  }
  return { lines: out, dropped };
}

/** One call: program text in, checked view out. */
export function viewOfProgram(text: string): AgentView {
  const c = clean(text);
  const v = toView(parseAgentProgram(c.lines.join("\n")));
  return { ...v, dropped: v.dropped + c.dropped };
}

/** A streaming reader: feed it the text so far, get the checked view so far. */
export function newViewStream() {
  const parser = newAgentParser();
  return {
    /** Replace the text so far (it must only grow). `done` marks the end of the stream. */
    set(text: string, done = false): AgentView {
      const c = clean(text);
      const v = toView(parser.set(c.lines.join("\n"), done));
      return { ...v, dropped: v.dropped + c.dropped };
    },
  };
}

/**
 * Is this one finished line safe to send on? True when it is one statement that calls a registered
 * component and, read as a program of its own, its props pass the same checks as on the client.
 */
export function lineOk(line: string): boolean {
  const { lines } = clean(line);
  if (lines.length !== 1) return false;
  const one = lines[0] as string;
  const r = parseAgentProgram(one);
  if (r.queryStatements.length || r.mutationStatements.length) return false;
  if (Object.keys(r.stateDeclarations).length) return false;
  // A statement still open (unbalanced bracket or quote) is not a finished line.
  if (r.meta.incomplete) return false;
  if (r.meta.errors.some((e) => e.code !== "no-root")) return false;
  if (r.meta.statementCount !== 1) return false;
  const v = toView(parseAgentProgram(one.replace(/^[a-z][A-Za-z0-9_]*\s*=/, "root =")), {
    pendingOk: true,
  });
  return !!v.root && v.dropped === 0 && v.rejected === 0;
}
