# Landing Page Studio (D16: build natively, sponsor decision 2026-11-05)

**Goal.** A salesperson types a prospect's role and company. Secondary composes a personalised landing page from the brain: past work with that client, case studies matching the angle, and the standard pitch. The salesperson edits it inline. A reviewer approves it. It is then published at a private-by-link URL with consent-first analytics. Weekly performance flows into the digest.

**Reference.** This is a pattern taken from a stakeholder demo; no code is reused. Brand follows Mantu Brand DNA, with a template per brand (Amaris as the default).

## 1. Flow

1. **Compose.**
   - **Inputs:** prospect first name (optional), role, company, angle (free text or a chosen expertise), brand template, and language (FR/EN).
   - **Brain lookup, policy-gated for the composer:**
     - Is the company a known account? If so, pull past projects and success stories.
     - Find case studies matching the angle in Company Global and in admitted account wikis.
   - **References:** at most 6, ranked.
   - **Draft copy:** written by the AI gate, with a deterministic template fallback when AI is off.
2. **Edit.**
   - Every slot is editable inline, and hover shows the editable region.
   - A reference picker (search the brain) enforces the 6-reference maximum, and the visual of each reference can be swapped.
   - The footer contact (the sales owner) is editable.
3. **Check (automatic, blocking).**
   - **Customer permission.** No client name, logo, quote or metric may appear unless a CustomerPermission record covers that exact item for the channel "landing page". Without one, the reference is generalised automatically ("A European retailer"), using the wiki promote de-identifier.
   - **Sensitivity scan.** The R-110/R-111 detectors and the confidentiality check run. Flags must be resolved.
   - **Prospect data.** First name and role are personal data. They are stored only in the page record (restricted) and shown only on that page. A retention clock applies: the page auto-expires after 90 days by default.
4. **Approve.** A reviewer who is neither the author nor an editor approves the exact revision hash, under the two-person rule. No page is public before that.
5. **Publish.**
   - The page is rendered to static HTML and stored in R2 (eu) under an unguessable slug.
   - It is served by a separate public worker, `secondary-pages`, which has no access to the brain. Its only binding is read access to the published-pages bucket.
   - UTM parameters are supported.
   - Publishing can be undone at any time, and the page also expires on its own.
6. **Measure.**
   - The cookie banner declines non-essential cookies by default.
   - With consent, privacy-friendly event counts are kept (views, scroll depth bucket, CTA clicks). There is no IP, no fingerprinting and no cross-site tracking.
   - The CTA opens a pre-filled email for the visitor to send themselves. Nothing is sent by Secondary.
   - Weekly stats appear for each owner in Studio and in the digest.
7. **Batch.** The MCP tool `lp_compose_batch(rows[])`, fed for example from a pasted CSV of role, company and angle, creates **drafts only**. Each draft still needs the check and the approval steps.

## 2. API (normative)

- `POST /v1/lp/compose`: `{prospect:{firstName?, role, company}, angle, brand, lang}` returns a `LandingDraft`.
- `GET/PUT /v1/lp/:id`: get or update the draft. `PUT` takes `{slots, references[], contact, revision}`. Returns 409 when the expected revision does not match the current one.
- `GET /v1/lp/:id/references?q=` returns candidate references the composer may see, each marked `permission: "named" | "generalised-only"`.
- `POST /v1/lp/:id/check` returns `{ok, issues:[{slot, kind:"customer-permission"|"sensitivity"|"length", detail, fix?}]}`.
- `POST /v1/lp/:id/submit` sends the page to review.
- `POST /v1/lp/:id/approve {revisionHash}`.
- `POST /v1/lp/:id/publish {utm?}` returns `{url, expiresAt}`.
- `POST /v1/lp/:id/unpublish`.
- `GET /v1/lp` lists my pages with status and stats.
- `GET /v1/lp/:id/stats` returns `{views, ctaClicks, consentRate, byDay[]}`.
- `LandingDraft` is `{id, status:"draft"|"in_review"|"approved"|"published"|"expired"|"unpublished", brand, lang, prospect, slots:{hero, intro, whyUs, caseStudyIntro, cta}, references:[{pageId, title, summary, image?, permission, generalisedTitle?}], contact, revision, revisionHash, checks?}`.
- **Public worker:**
  - `GET /p/:slug` returns the static page, with a strict CSP and `noindex` by default.
  - `POST /p/:slug/e` records an event only with consent. It keeps counts only, and is rate-limited.
- **MCP tools:**
  - `lp_compose` and `lp_compose_batch` require the `secondary.contribute` scope and produce drafts only.
  - `lp_list` requires `secondary.read`.
  - MCP has no publish and no approve.

## 3. UI

- **Studio, Landing pages.** A list of my pages with status chips and stats sparklines. "New page" opens a composer with 4 inputs and "Compose".
- **Editor.**
  - Live preview at real size, with a phone/desktop toggle.
  - Click-to-edit slots with a hover outline.
  - A side panel of references with a picker and the permission badges "Named" and "Generalised".
  - A checks panel with one-click fixes.
  - A "Submit for review" button.
- **Review.** The review appears in Questions as kind `release`. It shows a rendered preview and a diff against the previous revision.
- **Published.**
  - Copy link, with a UTM builder.
  - Unpublish.
  - Expiry date.
  - Stats.
- **Brand.** The template follows Brand DNA: Calibri/Carlito, the purple and yellow palette, no stock photos (images only from brain pages), one idea per section. It is fully responsive and AA accessible.

## 4. Tests (acceptance)

- Composing for a known account shows past projects. A named reference appears only when a CustomerPermission covers it; otherwise it is generalised.
- No public URL exists before approval. The author cannot approve, and an editor cannot approve.
- The public worker binding inventory is exactly the pages bucket plus the counter. It cannot read brain storage.
- Events are not recorded without consent. No IP is stored.
- Expiry removes the page.
- MCP batch creates drafts only.
- Sensitivity flags block submission.
- Unpublish returns 404 within one request.
