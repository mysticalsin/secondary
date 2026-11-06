# Secondary v5: Brain Insights (data visual layer)

Date: 2026-11-05. Plan: Claude Opus. Sponsor: Tony.

**Visual reference:** four dark data cards supplied by Tony:
- radial dot-field search;
- profile panel with fit bars, career timeline and activity dot-grid;
- match-score beeswarm with a threshold line and a source bar;
- outreach funnel with KPI tiles.

Adopt that visual language for viewing the brain. These cards add to the v4 familiar shell; they do not replace it.

## 1. Visual language (from the reference)

- **Cards:**
  - Dark instrument cards (`#1E1E22`, radius 20, 1 px hairline `#2A2A30`) on the light page, as in the reference. They are dark in both themes, deliberately.
  - Header: icon tile, title, subtitle in muted text, and a right-aligned control (segmented Week/Month, a "30 days" pill, or Share).
- **Dots as data:** 1 dot = 1 page, or N pages when dense; the legend always says so. Admitted, in-scope items are purple `#8B5CF6` to `#7F00DA`. Others are neutral grey `#5A5A63`.
- **Accents:** teal `#14B8A6`, magenta `#DB2777`, amber `#F59E0B` and blue `#3B5BDB`, used per category (sources, collections). Mantu yellow `#F8F060` is reserved for "needs you".
- **Type:** big numbers in a display weight. Numbers and axes in a mono tabular face (JetBrains Mono). Labels in Carlito.
- **Chips:** a pill with label and "+N" count, coloured by category (as in the reference query chips).
- **Motion:** dots fade and scale in by ring. Hover lifts a node and shows a label pill such as "Pricing method 96%". Reduced-motion respected.
- **Accessibility:**
  - Every chart has a table twin (toggle) and text summaries.
  - Colour is never the only signal: shapes or labels carry it too.
  - Keyboard focus can move across highlighted nodes.

## 2. Views

1. **Brain constellation** (the brain's Insights tab, and a mini version on Home per brain).
   - Radial dot field. Sectors are the brain's collections (labels around the ring). Each dot is a page.
   - Radius depends on the mode:
     - **Relevance** to the current query (Ask-style prompt bar with chips under the card), with rings at 50%, 70% and 85%.
     - **Freshness:** the centre is fresh, the edge is stale.
   - The top 3 to 5 pages get labelled nodes ("Bid playbook 96%"). The centre icon is the brain.
   - Legend: "In the zone N · Below threshold M · 1 dot = k pages".
   - Clicking a node opens the page.
2. **Page or account focus panel**, the right-side card, as in the reference profile.
   - Header: initials or icon, name, type and brain.
   - **Coverage**: bars for each required collection or section of the brain template, with a target marker and a value (pages, or "Lead" or "Missing").
   - **Timeline**: Gantt-like bars, for example engagements and projects for account brains, or decisions per quarter.
   - **Activity**: a dot grid of edits and ingests per day over 6 months, sized by volume, with month labels.
   - **Status** select (Active, Watch, Dormant) for account brains. Changing it is an edit, so it goes through publication-mode review.
   - **Actions**: "Open brain", "Ask this brain".
3. **Brain health beeswarm.**
   - Pages placed on an x axis by a score: freshness (days), confidence (verified share of facts), or evidence coverage, chosen in a segmented control. Optional y jitter. The threshold line reads "Review below 60%".
   - Header stats: the big number "N above threshold of M pages" and a "+K this week" chip.
   - **Sources by count** as a segmented bar: SharePoint, meetings, agents (MCP), manual, import.
   - Hovering a dot shows a tooltip with the page title and score.
4. **Knowledge flow funnel.**
   - Stages: Ingested, then Proposed, then Reviewed, then Published, then Promoted to Global (Global only for brains that promote).
   - A big headline metric, "publish rate".
   - KPI tiles: median "days to review" and "changes seen before approve" (the share of approvals with every change seen, which should be 100%).
   - A 30-day pill.
5. **Governance overview.** On Home, and in All brains for roles with several brains.
   - A small-multiples grid of mini-constellations, one per admitted brain, each with its health score and a sparkline.
   - **Never aggregates across brains the viewer cannot read.** No contamination: each tile is computed from that brain only.

## 3. Data and API (server-side aggregation, per-brain, policy-gated)

- `GET /v1/brains/:id/insights?mode=relevance|freshness&q=&window=30d` returns the following. It contains no page bodies, and titles only for pages the caller can read (masked otherwise per the wiki rules).
  - `{constellation:{sectors:[{id,label,count}], dots:[{pageId,sector,r,score,label?,highlight?}], rings:[50,70,85], legend}, focus?:{...}, health:{scoreKind, points:[{pageId,score,source}], threshold, aboveCount, total, weekDelta, sources:[{kind,count}]}, flow:{stages:[{key,count}], medianDaysToReview, seenAllRate, window}, activity:{days:[{date,count}]}, timeline:[{label,start,end,kind}]}`
- `GET /v1/brains/overview` returns one mini-summary per admitted brain.
- Dense brains are bucketed server-side, so a dot can stand for k pages, and k is returned in the legend.
- Every count respects masking and admission. Tests prove that an unreadable brain contributes nothing.

## 4. Implementation notes

- Render with SVG (`d3-scale`, `d3-shape` and `d3-array` are fine) plus a Canvas fallback above 2,000 dots. No heavy chart library.
- Deterministic layout: seeded jitter and Poisson-like packing within sector and ring, so screenshots are stable.
- **Components:**
  - `InsightCard`
  - `DotConstellation`
  - `FitBars`
  - `TimelineBars`
  - `ActivityGrid`
  - `Beeswarm`
  - `SegmentBar`
  - `Funnel`
  - `KpiTile`
  - `QueryChips`
- These live in `apps/web/src/insights/`. Load the `dataviz` skill for palette and accessibility rules.
- **Acceptance:**
  - Each view matches the reference look: compare screenshots side by side, with two refinement passes.
  - axe reports zero violations, and table twins are present.
  - FR/EN.
  - Works at 400 px, where cards stack and the constellation scales.
  - Isolation tests for the insights and overview endpoints.
  - Performance stays under 16 ms per frame on hover at 1,500 dots.
