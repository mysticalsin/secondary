# Spec 014: Counters follow the chosen brain

**Feature Branch**: `cursor/sb-dashboard-graph-brains-1c66`

**Input**: Inspector, on the PR #20 pages. The note and link counters still include another brain. "All brains" stays absent.

## What stays out

Spec 013 says: `There is no "All brains" option.` That removal is deliberate. This slice does not put the option back.

## What changes

Graph's unresolved count uses ghosts in the selected brain only. The note and link counts already use the visible graph, which is filtered by that brain.

Dashboard's link total and page degree count an edge only when the other page is in the selected brain. A `global:` link that lands in another brain does not add to the selected brain's Links number.

## Independent test

With Delivery selected and Engineering holding the extra page, a broken Engineering link, and a Delivery `global:` link into Engineering: Graph's status line has `2 notes` and no `unresolved`, and Dashboard's Links value is `0`. The same assertions fail before the filter.
