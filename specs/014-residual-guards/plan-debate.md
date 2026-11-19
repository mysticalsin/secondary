# Plan debate: one ancestor walk

Status: OPEN. A non-author has not answered. This is not an agreement.

## Question

Who decides that a brain is restricted when the flag sits on an ancestor, and when the walk cannot finish?

## Options

### 1. Copy the walk into each reader

Leave `factsOf`, the missed-card walk, `directPublish`, and the `scope=all` badge as separate loops. Teach each one about contacts and about failing closed.

Risk: the copies drift. That already happened. The missed-card walk did not match the open card, and a bolt-on was rejected. The next reader can forget contacts or the hop cap.

### 2. One exported `restrictionOf`, called by every reader

`factsOf`, the missed card, `directPublish`, and the closed `scope=all` card call the same function. The policy view is unchanged. Contacts count as restricted. A walk that does not end on a null parent returns restricted.

Risk: this changes who waits for review and which closed card shows restricted. An unflagged page under a restricted or contacts ancestor no longer publishes directly. A closed department under a restricted parent shows `restricted: true`. A missing parent fails closed, so a broken link is treated as restricted instead of open. The twelve-hop cap does the same for a chain longer than the real org. The real org's longest chain is five, so the cap is a synthetic bound. This is the permission change, and it is why the pull request is high risk.

### 3. Mark the view node inside the policy engine

`underRestriction` already walks ancestors, but only to stop the everyone-open lift. Setting `restricted` on the view node would make every consumer see the ancestor.

Risk: admission, grants, and every reader of the view change together. A circle could drop out of the open set, not only change its badge. That is wider than the bug.

## Choice

Option 2. One function, four call sites, a test on each call site. The policy engine stays as it is. Fail closed is the safe side for a missing parent and for the hop cap.

CONSENSUS: OPEN
