# v7 Operate, web (DESIGN.md before UI)

Scope: Brain activity (Brain page tab), Settings Agents activity, Settings Sources, Settings Health. Source of truth: `docs/DESIGN-V7-GOVERN-OPERATE.md` sections 2 to 5 and the contract at the end of `docs/API-CONTRACT.md`. References: `docs/design-refs/v7-ref-*.jpg`. Code lives in `apps/web/src/ops/`; shared files only get one-line registrations.

## Tokens

The cards reuse the v5 instrument card (`.icard`, dark in both themes, 20 px radius, card `#1e1e22`, line `#2a2a30`). New tokens sit on `.opx` (scoped, in `ops/ops.css`):

| Token | Value | Use |
|---|---|---|
| `--op-ok` | `#38bdf8` | published, delivered, confirmed |
| `--op-fail` | `#ec4899` | blocked, failed, failing hour, timed out |
| `--op-warn` | `#f59e0b` | needs review, Graph 429 |
| `--op-timeout` | `#8da2fb` | timeout reason (periwinkle) |
| `--op-brand` | `#a78bfa` | selection, brand accents |
| `--op-text` / `--op-mute` / `--op-faint` | `#f4f3f7` / `#a6a4b2` / `#8a8896` | text only: marks never carry text colour |

Type: Carlito for labels, JetBrains Mono (`var(--mono)`) with tabular numbers for ids, counts, times. Marks are at least 2 px. Colour is never the only signal: dashed outline = retrying or scheduled, x glyph = failed step, check glyph = ok step, every status chip has its word, every chart has a legend and a table twin.

## Layout

- Activity (Brain tab, 1440): one card. Header: tile, "Activity", search ("/" focuses) and All / Needs review / Blocked / Failed. Timeline: caption "Last 60 min, 1 dot = k events", window segmented, selection readout, dot columns (stacked from the bottom), failure callout top left, time axis, brush. Table: Event, Source, Status, Attempts, Latency, Time. Selected row opens a detail panel (Steps left, Metadata JSON right, buttons). Footer: legend and "4 of N".
- Agents activity: the same card without the brain-only parts (no retry, no callout rule link), inside the agent connection panel.
- Sources list: table card. Source page: two columns at 1440 (retry schedule and response time on the left, settings form on the right), one column under 900 px. Third strip: ACL staleness.
- Health: two columns (gauge and failures on the left, heatmap on the right), one column under 900 px.
- 400 px: dot timeline scrolls inside its own region, tables scroll inside focusable regions, detail panel stacks.

## States

Loading: skeleton rows with a status line ("Loading activity"). Empty: says what to change ("No events in this window. Widen the window or clear the filters."). Error: reason plus Retry. 403 on a tab: the tab is hidden, the route shows "You need to manage this brain to see this." Synthetic data: a visible "Synthetic data" chip in the card header.

## Keyboard

Brush: focus it, Left and Right move the window, Shift with arrows resizes the right edge, Alt with arrows resizes the left edge, Escape clears. "/" focuses search (not while typing). Rows are buttons; Enter opens the detail. Heatmap cells: roving tabindex, arrows move, tooltip follows focus. Segmented controls: arrow keys.

## Privacy

Only ids, counts, timings and `ruleId@version` are rendered. The metadata viewer prints the keys the API sends and nothing else. Credentials show the secret name only; Rotate is two-person and shows "Waiting for a second admin" until the second call answers 200.

## Time and language

Times show in UTC (labelled once per card) so screenshots and tests are stable. EN and FR for every string, in `i18n/v7ops.ts`. No em dashes.
