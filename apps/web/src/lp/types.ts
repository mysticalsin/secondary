// Landing Page Studio shapes (docs/DESIGN-LP-STUDIO.md section 2, docs/API-CONTRACT.md). The mock answers in
// the same shapes: workers/api/test/lp-mock-contract.test.ts runs one call against both.

export type LpStatus = "draft" | "in_review" | "approved" | "published" | "expired" | "unpublished";
export type LpBrand = "amaris" | "mantu";
export type LpLang = "fr" | "en";

export const SLOT_IDS = ["hero", "intro", "whyUs", "caseStudyIntro", "cta"] as const;
export type SlotId = (typeof SLOT_IDS)[number];
export type LpSlots = Record<SlotId, string>;

export interface LpProspect {
  firstName?: string;
  role: string;
  company: string;
}

export interface LpReference {
  pageId: string;
  title: string;
  summary: string;
  image?: string;
  /** `named`: a CustomerPermission covers this item for landing pages. Otherwise only the generalised wording may show. */
  permission: "named" | "generalised-only";
  generalisedTitle?: string;
  /** An outcome figure. The page shows it only when `permission` is `named`; the API sends it only when the customer permission covers it. */
  metric?: { value: string; label: string };
}

export interface LpContact {
  name: string;
  title?: string;
  email: string;
}

export type LpIssueKind = "customer-permission" | "sensitivity" | "length";

export interface LpIssue {
  /** A slot id, `contact`, or `reference:<pageId>`. */
  slot: string;
  kind: LpIssueKind;
  detail: string;
  /** What one click does. `text` replaces the whole slot, `removeReference` drops that reference (its pageId). */
  fix?: { label: string; text?: string; removeReference?: string };
}

export interface LpChecks {
  ok: boolean;
  issues: LpIssue[];
}

export interface LandingDraft {
  id: string;
  status: LpStatus;
  brand: LpBrand;
  lang: LpLang;
  prospect: LpProspect;
  slots: LpSlots;
  references: LpReference[];
  contact: LpContact;
  revision: number;
  revisionHash: string;
  checks?: LpChecks;
  /** Set once published. */
  url?: string;
  expiresAt?: string;
  updatedAt?: string;
  composedBy?: "deterministic" | "ai";
  /** A reviewer's note after "request changes". */
  note?: string;
}

export interface LpStats {
  views: number;
  ctaClicks: number;
  consentRate: number;
  /** One entry per day with counts, oldest first (the API sends only the days that have any). */
  byDay: { day: string; views: number; ctaClicks: number }[];
}

/** GET /v1/lp rows are drafts with their stats. */
export interface LandingSummary extends LandingDraft {
  stats?: LpStats;
}

export type LpCandidate = LpReference;

export interface ComposeInput {
  prospect: LpProspect;
  angle: string;
  brand: LpBrand;
  lang: LpLang;
}

export interface SaveInput {
  slots: LpSlots;
  references: LpReference[];
  contact: LpContact;
  revision: number;
}

/** The release question carries what the reviewer needs to read the page: `detail.landing`. */
export interface LpReviewDetail {
  id: string;
  draft: LandingDraft;
  previous?: Pick<LandingDraft, "slots" | "references" | "contact" | "revision"> | null;
}

export const MAX_REFERENCES = 6;
export const EXPIRY_DAYS = 90;
