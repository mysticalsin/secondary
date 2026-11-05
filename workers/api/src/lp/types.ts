// Landing Page Studio: shapes and limits (docs/DESIGN-LP-STUDIO.md section 2). One module, no I/O.

export const BRANDS = ["amaris", "mantu"] as const;
export type Brand = (typeof BRANDS)[number];
export const LANGS = ["en", "fr"] as const;
export type Lang = (typeof LANGS)[number];
export const isBrand = (v: unknown): v is Brand => (BRANDS as readonly unknown[]).includes(v);
export const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);

export const STATUSES = [
  "draft",
  "in_review",
  "approved",
  "published",
  "expired",
  "unpublished",
] as const;
export type Status = (typeof STATUSES)[number];

export const SLOTS = ["hero", "intro", "whyUs", "caseStudyIntro", "cta"] as const;
export type Slot = (typeof SLOTS)[number];
export type Slots = Record<Slot, string>;
/** Longest text per slot. A longer text is a `length` issue in the checks, not a silent cut. */
export const SLOT_MAX: Record<Slot, number> = {
  hero: 140,
  intro: 420,
  whyUs: 700,
  caseStudyIntro: 300,
  cta: 90,
};
export const MAX_REFERENCES = 6;
/** The channel a CustomerPermission must name for a client to be named on a page. */
export const CHANNEL = "landing page";
/** Retention clock of a page and of the prospect data on it. */
export const DEFAULT_DAYS = 90;
export const MAX_DAYS = 180;
export const DAY_MS = 86_400_000;

export interface Prospect {
  firstName?: string;
  role: string;
  company: string;
}
export interface Contact {
  name: string;
  /** Job title, shown beside the name in the footer. Optional. */
  title?: string;
  email: string;
}
export type Permission = "named" | "generalised-only";
export interface Reference {
  /** `<workspace>/<page>`: where in the brain the reference comes from. */
  pageId: string;
  title: string;
  summary: string;
  image?: string;
  permission: Permission;
  generalisedTitle?: string;
  /** An outcome figure, only on a `named` reference and only when the customer permission covers it. */
  metric?: { value: string; label: string };
}
/** What one click does: `text` replaces the whole slot, `removeReference` drops that reference (its pageId). */
export interface Fix {
  label: string;
  text?: string;
  removeReference?: string;
}
export interface Issue {
  /** A slot id, or `reference:<pageId>`. */
  slot: string;
  kind: "customer-permission" | "sensitivity" | "length";
  detail: string;
  fix?: Fix;
}
export interface CheckResult {
  ok: boolean;
  issues: Issue[];
}
export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
}
export interface Stats {
  views: number;
  ctaClicks: number;
  consentRate: number;
  byDay: { day: string; views: number; ctaClicks: number }[];
}

/** What the store keeps for one page. Personal data (first name, role, company) lives only here. */
export interface PageRecord {
  id: string;
  owner: string;
  ownerEmail: string;
  status: Status;
  brand: Brand;
  lang: Lang;
  prospect: Prospect;
  slots: Slots;
  references: Reference[];
  contact: Contact;
  revision: number;
  composer: "deterministic" | "ai";
  slug: string | null;
  expiresAt: number;
  publishedAt: number | null;
  utm: Utm | null;
  previewHtml: string | null;
  approvedHash: string | null;
  approvedBy: string | null;
  checks: (CheckResult & { hash: string }) | null;
  finalStats: Stats | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LandingDraft {
  id: string;
  status: Status;
  brand: Brand;
  lang: Lang;
  prospect: Prospect;
  slots: Slots;
  references: Reference[];
  contact: Contact;
  revision: number;
  revisionHash: string;
  checks?: CheckResult;
  composedBy: "deterministic" | "ai";
  expiresAt: string;
  updatedAt: string;
  url?: string;
  note?: string;
}

/** Plain text of a slot: one line breaks are kept, markup is not allowed to survive. */
export const cleanSlot = (v: string): string =>
  v
    .replace(/\p{Cc}/gu, (c) => (c === "\n" ? "\n" : " "))
    .replace(/[<>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The hash an approver names. Anything the page shows is in it, and so is the revision. */
export async function revisionHashOf(
  r: Pick<
    PageRecord,
    "brand" | "lang" | "prospect" | "slots" | "references" | "contact" | "revision"
  >,
): Promise<string> {
  const canon = JSON.stringify([
    r.brand,
    r.lang,
    [r.prospect.firstName ?? "", r.prospect.role, r.prospect.company],
    SLOTS.map((s) => r.slots[s]),
    r.references.map((x) => [
      x.pageId,
      x.title,
      x.summary,
      x.image ?? "",
      x.permission,
      x.metric ? [x.metric.value, x.metric.label] : null,
    ]),
    [r.contact.name, r.contact.title ?? "", r.contact.email],
    r.revision,
  ]);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(d)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const hexId = (bytes: number): string =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
