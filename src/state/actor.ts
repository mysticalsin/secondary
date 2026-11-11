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
const PAD = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

/** Trim, drop NBSP and other padding, and lowercase. Empty becomes null. */
export function normalEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(PAD, " ").trim().toLowerCase();
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
