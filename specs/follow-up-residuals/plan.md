# Implementation Plan: Follow-up residuals

**Branch**: `cursor/sb-followup-r2-b165` | **Date**: 2026-11-18 | **Spec**: `specs/follow-up-residuals/spec.md`

## Summary

Warnings for failed deny receipts, a null persona id for a bad email, a real switch-off audit outcome, one cap warning, no raw malformed seed address, one refund state, and an escaped profile label.

## Security & data

See the spec. No new secret, no amount, and no address in the warnings. Provenance still exits 1 when the source commits are absent.

## Constitution Check

Red tests are already on this branch ahead of each fix. No force push. No deploy. D6 is unchanged.
