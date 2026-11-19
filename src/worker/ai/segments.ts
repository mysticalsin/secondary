// R-110: personal-segment detection for transcript text. It runs before any transcript text enters
// a prompt or storage. Deterministic, no model, no network. It extends the pre-share detector
// (health, family, HR wording) with holidays and private-life talk, and it works per sentence so a
// work sentence next to a personal one survives. When unsure it excludes (fail closed on privacy).

import { detectSensitivity } from "../sensitivity.ts";

export type PersonalCategory = "health" | "family" | "holidays" | "hr" | "private_life";

export type ExcludedSegment = {
  /** 1-based line of the text. */
  line: number;
  category: PersonalCategory;
  /** At most 40 characters, for the owner's "what was excluded" list. Never stored. */
  excerpt: string;
};

const HEALTH =
  /\b(?:knee|surgery|diagnos\w*|specialist|treatment|therap\w*|medication|illness|pregnan\w*|sick|hospital\w*|burn-?out|mental health|chronic|doctor|injur\w*)\b/i;
const FAMILY =
  /\b(?:my (?:wife|husband|son|daughter|child(?:ren)?|mother|father|mum|mom|dad|partner|baby|brother|sister|parents?)|family|divorce|custody|funeral|care home|new school|expecting a baby|parental leave|maternity|paternity|the kids)\b/i;
const HOLIDAYS =
  /\b(?:holidays?|vacations?|ski trip|honeymoon|road trip|long weekend|weekend away|time off|days? off|flying to|taking\b[^.!?]{0,40}\boff|booked a (?:trip|flight|cabin))\b/i;
const HR =
  /\b(?:HR|human resources|complaint about|passed over for promotion|looking for another job|performance plan|performance review|disciplinary|grievance|salary|payroll|bonus|redundanc\w*|dismissal|layoffs?|severance|harass\w*)\b/;
const PRIVATE_LIFE =
  /\b(?:between us|off the record|don'?t tell|gossip|apparently|did you hear)\b/i;

const RULES: readonly [PersonalCategory, RegExp][] = [
  ["health", HEALTH],
  ["family", FAMILY],
  ["holidays", HOLIDAYS],
  ["hr", HR],
  ["private_life", PRIVATE_LIFE],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.])\+?\(?\d(?:[\s().-]{0,2}\d){7,14}(?!\w)/g;
const DATE = /^(?:\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})$/;

/** Contact details are masked, not dropped: the sentence itself is business text. */
export function maskContacts(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, (m) =>
      m.replace(/\D/g, "").length < 8 || DATE.test(m.trim()) ? m : "[phone removed]",
    );
}

function categoryOf(sentence: string): PersonalCategory | null {
  for (const [cat, re] of RULES) if (re.test(sentence)) return cat;
  // The shared pre-share detector is the safety net for anything its wording covers.
  const f = detectSensitivity({ body: sentence }).find(
    (x) => x.type === "health" || x.type === "family" || x.type === "hr",
  );
  return f && f.type !== "email" && f.type !== "phone" ? f.type : null;
}

export type FilteredText = { kept: string; excluded: ExcludedSegment[] };

/**
 * Splits `text` into sentences per line, removes personal ones and masks contact details in the rest.
 * Line structure is preserved, so a transcript keeps its timestamps and speakers for the work lines.
 */
export function excludePersonalSegments(text: string): FilteredText {
  const excluded: ExcludedSegment[] = [];
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) {
      out.push("");
      return;
    }
    const keptParts: string[] = [];
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const cat = categoryOf(sentence);
      if (cat) excluded.push({ line: i + 1, category: cat, excerpt: sentence.trim().slice(0, 40) });
      else keptParts.push(sentence);
    }
    if (keptParts.length) out.push(maskContacts(keptParts.join(" ")));
  });
  return {
    kept: out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    excluded,
  };
}

export function countByCategory(ex: readonly ExcludedSegment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of ex) out[e.category] = (out[e.category] ?? 0) + 1;
  return out;
}
