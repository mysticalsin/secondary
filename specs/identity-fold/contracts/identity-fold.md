# Contract: Identity fold

## Sign-in

`sessionCreate` forwards `who.email` unchanged. A match is `normalEmail` on both sides. U+212A does not equal `k`. U+0130 does not equal `i`.

## SCIM

Create and patch fold A–Z only, then reject when the result has no `@`, is longer than 254, or `normalEmail` is null. `@ascii.example` is `invalid` and writes nothing.

## OIDC

The mail claim uses `normalEmail`. A token whose preferred username is U+212A does not bind the `k@` principal.

## Pilot

`flagsFor` is true for a member only when `normalEmail` of the caller equals a stored member.

## Unknown switch

One log line per name per instance, and at most 256 names. The line is `unknown_name`.

## Deny

Status stays 403. A failed receipt logs the structured warning and no personal data.

## Switch off

`switch_disable` is written after `setSwitch`. The HTTP status is unchanged.
