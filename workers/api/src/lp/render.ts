// The static page of Landing Page Studio. The template is the shared package `@secondary/lp-template`
// (the same file the web editor previews with): one self-contained HTML document in the brand template,
// Carlito then Calibri, Mantu purple, yellow and dark, responsive, AA contrast, one idea per section.
// No external script, font, image or request of any kind. The only script is a tiny inline beacon that
// does nothing until the visitor accepts the consent banner, which declines by default. The pages worker
// allows the inline style and script by their hashes, so nothing else can run.
//
// This module keeps the API's own interface (`LandingRenderData`, docs/API-CONTRACT.md) and maps it to the
// template: `preview` is the unscripted rendering stored for the reviewer, `published` the one served.

import {
  BEACON,
  IMAGE_OK,
  PALETTE,
  PUBLISHED_IMAGE,
  renderLandingPage as renderTemplate,
} from "@secondary/lp-template";
import type { Brand, Contact, Lang, Prospect, Reference, Slots } from "./types.ts";

export { BEACON, IMAGE_OK, PALETTE, PUBLISHED_IMAGE };

/**
 * Everything a template needs, and nothing else: data in, one HTML string out. Rules every template keeps:
 *  - static HTML, no external request of any kind; the only script is one inline consent and beacon
 *    script, allowed by its hash (the pages worker computes it), only when `mode` is "published"
 *  - an image is either `/p/<slug>/i/<n>` (an asset copied into the pages bucket at publish time) or,
 *    in the review preview only, a small data URL. Any other value is dropped, never a brain URL.
 */
export interface LandingRenderData {
  brand: Brand;
  lang: Lang;
  prospect: Prospect;
  slots: Slots;
  references: readonly (Pick<Reference, "title" | "summary"> &
    Partial<Pick<Reference, "image" | "permission" | "generalisedTitle" | "metric">>)[];
  contact: Contact;
  mode: "preview" | "published";
  /** ISO date the page closes. Shown in the footer and the header strip. */
  expiresAt?: string;
}

export function renderLandingPage(r: LandingRenderData): string {
  return renderTemplate(
    {
      brand: r.brand,
      lang: r.lang,
      prospect: r.prospect,
      slots: r.slots,
      references: r.references.map((x) => ({
        title: x.title,
        summary: x.summary,
        // Without a permission on the record a reference is shown generalised, never named.
        permission: x.permission ?? "generalised-only",
        ...(x.generalisedTitle ? { generalisedTitle: x.generalisedTitle } : {}),
        ...(x.metric ? { metric: x.metric } : {}),
        ...(x.image ? { image: x.image } : {}),
      })),
      contact: r.contact,
      ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
    },
    { mode: r.mode === "published" ? "published" : "public" },
  );
}
