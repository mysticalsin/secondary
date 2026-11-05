// Mock-only copy of workers/api/src/sensitivity.ts so mock mode answers with the same flag shape.
// The browser never scans for real: the server scan is the only one that counts.

import type { PersonalFlag } from "../types";

type SensitivityFlag = PersonalFlag;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.])\+?\(?\d(?:[\s().-]{0,2}\d){7,14}(?![\w.])/g;
const HEALTH =
  /\b(?:diagnos\w*|medical|medication|illness|sick leave|surgery|therapy|therapist|pregnan\w*|disabilit\w*|cancer|hospital\w*|burn-?out|mental health|chronic)\b/gi;
const FAMILY =
  /\b(?:my (?:wife|husband|son|daughter|child(?:ren)?|mother|father|partner|baby|brother|sister)|family|divorce|custody|funeral|maternity|paternity)\b/gi;
const HR =
  /\b(?:salary|payroll|disciplinary|grievance|performance review|redundanc\w*|dismissal|terminat\w*|resignation|harass\w*|promotion case|bonus|layoffs?|PIP|severance)\b/gi;

// Dates such as 2026-11-04 have eight digits but are not phone numbers.
const DATE = /^(?:\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})$/;

const RULES: readonly ["email" | "phone" | "health" | "family" | "hr", RegExp][] = [
  ["email", EMAIL],
  ["phone", PHONE],
  ["health", HEALTH],
  ["family", FAMILY],
  ["hr", HR],
];

export function detectSensitivity(fields: {
  title?: string;
  body?: string | null;
}): SensitivityFlag[] {
  const out: SensitivityFlag[] = [];
  for (const field of ["title", "body"] as const) {
    const text = fields[field];
    if (!text) continue;
    for (const [type, re] of RULES) {
      for (const m of text.matchAll(re)) {
        // A phone number needs at least eight digits; this keeps dates and ids out.
        if (type === "phone" && (m[0].replace(/\D/g, "").length < 8 || DATE.test(m[0].trim())))
          continue;
        const start = m.index ?? 0;
        out.push({
          id: `${type}:${field}:${start}`,
          type,
          field,
          start,
          excerpt: m[0].slice(0, 40),
        });
      }
    }
  }
  const rank = { title: 0, body: 1 } as const;
  return out.sort(
    (a, b) => rank[a.field] - rank[b.field] || a.start - b.start || a.type.localeCompare(b.type),
  );
}
