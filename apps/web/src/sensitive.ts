// Client-side pre-share scan. It helps the author review before contributing (R-111).
// The server stays authoritative and re-validates on contribute.
export interface SensitiveFlag {
  kind: string;
  span: string;
  reason: string;
  index: number;
}

const RULES: { kind: string; reason: string; re: RegExp }[] = [
  {
    kind: "Email address",
    reason: "Personal or client contact detail.",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    kind: "Phone number",
    reason: "Personal or client contact detail.",
    re: /\+?\d[\d ().-]{7,}\d/g,
  },
  {
    kind: "Amount",
    reason: "Commercial figure. Check it is cleared for this audience.",
    re: /\b(?:EUR|USD|CAD|BRL|COP|VND|GBP)\s?\d[\d,.]*\b|[€$£]\s?\d[\d,.]*/g,
  },
  {
    kind: "Confidentiality marker",
    reason: "The text refers to a confidentiality or NDA constraint.",
    re: /\b(?:NDA|confidential|do not share|under embargo|privileged)\b/gi,
  },
  {
    kind: "People matter",
    reason: "HR or personal matter. Keep it out of shared scopes.",
    re: /\b(?:salary|disciplinary|resignation|performance review|health issue|sick leave)\b/gi,
  },
  {
    kind: "Credential",
    reason: "Looks like a secret. Never share keys or passwords.",
    re: /\b(?:password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S+/gi,
  },
];

export function scanSensitive(text: string): SensitiveFlag[] {
  const out: SensitiveFlag[] = [];
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      out.push({ kind: r.kind, span: m[0], reason: r.reason, index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
