/**
 * One actor identity. Quorum and humanIds both use this. A display name is not
 * an identity. Stored emails and subjects are not rewritten.
 */

export type ActorIdentity = {
  id: string;
  subject: string | null;
  /** Sign-in address. Null when this id has not signed in. */
  email: string | null;
  /** Directory email. Null when this id has no principal row. */
  directoryEmail: string | null;
};

export type DirectoryPrincipal = {
  id: string;
  subject: string | null;
  email: string | null;
};

/** Padding that String.trim and SQLite trim do not remove, folded to a space. */
const EMAIL_PAD = [
  0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
  0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
] as const;

/**
 * One fold list for `normalEmail` and `normalizedEmailSql`. ASCII whitespace is
 * here because String.trim strips it and SQLite trim() keeps it. A blank result
 * is null on both sides. Stored text is not rewritten.
 */
const EMAIL_FOLD = [0x0009, 0x000a, 0x000b, 0x000c, 0x000d, ...EMAIL_PAD] as const;

const charClass = (codes: readonly number[]): RegExp =>
  new RegExp(`[${codes.map((code) => `\\u${code.toString(16).padStart(4, "0")}`).join("")}]`, "g");

const PAD = charClass(EMAIL_PAD);
const FOLD = charClass(EMAIL_FOLD);

/**
 * SQL for `normalEmail` over a stored text column. The column is not rewritten.
 * `column` is a fixed name, never caller input. Blank is null, matching `normalEmail`.
 */
export function normalizedEmailSql(column: string): string {
  let expr = column;
  for (const code of EMAIL_FOLD) expr = `replace(${expr}, char(${code}), ' ')`;
  return `nullif(lower(trim(${expr})), '')`;
}

/** Fold `EMAIL_FOLD` to spaces, trim, and lowercase. Empty becomes null. */
export function normalEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(FOLD, " ").trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/** Trim and drop NBSP and other padding. Empty becomes null. Case stays. */
export function normalSubject(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(PAD, " ").trim();
  return trimmed === "" ? null : trimmed;
}

function addresses(actor: ActorIdentity): string[] {
  const out: string[] = [];
  for (const value of [actor.email, actor.directoryEmail]) {
    const email = normalEmail(value);
    if (email !== null && !out.includes(email)) out.push(email);
  }
  return out;
}

/**
 * Same id, or both directory subjects set and equal. Otherwise any normalised
 * sign-in or directory address. Two different subjects stay two people.
 */
export function sameActor(a: ActorIdentity, b: ActorIdentity): boolean {
  if (a.id !== "" && a.id === b.id) return true;
  const leftSubject = normalSubject(a.subject);
  const rightSubject = normalSubject(b.subject);
  if (leftSubject && rightSubject) return leftSubject === rightSubject;
  const right = addresses(b);
  return addresses(a).some((email) => right.includes(email));
}

/** The actor behind one id. Subject is copied from a directory row whose email matches, when this row has none. */
export function actorFromDirectory(
  id: string,
  signIn: string | null,
  rows: readonly DirectoryPrincipal[],
): ActorIdentity {
  const row = rows.find((r) => r.id === id);
  const directory = normalEmail(row?.email);
  const email = normalEmail(signIn);
  let subject = normalSubject(row?.subject);
  if (!subject) {
    for (const candidate of [directory, email]) {
      if (!candidate) continue;
      const found = rows.find(
        (r) => normalEmail(r.email) === candidate && normalSubject(r.subject) !== null,
      );
      const linked = found ? normalSubject(found.subject) : null;
      if (linked) {
        subject = linked;
        break;
      }
    }
  }
  return { id, subject, email, directoryEmail: directory };
}
