import type { RuleEffect, RuleField } from "@secondary/policy";
import { useCallback, useMemo } from "react";
import { type Key, useI18n } from "../i18n";
import { whoIs } from "../personas";
import type { RuleScope } from "./types";

/** The chip an effect shows in a sample row: approvals share one amber chip. */
export type EffectKind = "approval" | "block" | "notify" | "expiry";
export const effectKind = (e: RuleEffect): EffectKind =>
  e === "block" ? "block" : e === "notify" ? "notify" : e === "expire" ? "expiry" : "approval";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Wording helpers for rules, in the viewer's language. Every label comes from i18n/v7.ts. */
export function useRuleText() {
  const { t, td, lang } = useI18n();

  const fieldLabel = useCallback((f: RuleField) => t(`v7.field.${f}` as Key), [t]);
  const opLabel = useCallback((op: string) => td("v7.op", op), [td]);
  const effectLabel = useCallback((e: RuleEffect) => t(`v7.effect.${e}` as Key), [t]);
  const effectShort = useCallback((e: RuleEffect) => t(`v7.effect.short.${e}` as Key), [t]);
  const chipLabel = useCallback((e: RuleEffect) => t(`v7.chip.${effectKind(e)}` as Key), [t]);

  /** A condition value as a person reads it. Brain ids resolve through `brains` when known. */
  const valueLabel = useCallback(
    (field: RuleField, v: string, brains?: Record<string, string>) => {
      if (field === "brain") return brains?.[v] ?? v;
      if (field === "size_pages") return v;
      if (field === "actor_role") return td("v4.role", v, td("role", v, v));
      return td(`v7.val.${field}`, v, v);
    },
    [td],
  );

  const scopeText = useCallback(
    (scope: RuleScope, serverLabel?: string) => {
      if (scope.kind === "tenant") return t("v7.scope.tenant");
      if (scope.kind === "brain_types") {
        const names = scope.types.map((x) => t(`v7.scope.type.${x}` as Key));
        const list = new Intl.ListFormat(lang === "fr" ? "fr-CA" : "en-CA", {
          style: "long",
          type: "conjunction",
        }).format(names);
        return t("v7.scope.types", { types: list });
      }
      return serverLabel ?? scope.ids.join(", ");
    },
    [t, lang],
  );

  const ago = useCallback(
    (at: string | number, now = Date.now()) => {
      const ms = typeof at === "number" ? at : Date.parse(at);
      if (Number.isNaN(ms)) return "";
      const d = Math.max(0, now - ms);
      if (d < MIN) return t("v7.ago.now");
      if (d < HOUR) return t("v7.ago.min", { n: Math.round(d / MIN) });
      if (d < 24 * HOUR) return t("v7.ago.h", { n: Math.round(d / HOUR) });
      return t("v7.ago.d", { n: Math.round(d / (24 * HOUR)) });
    },
    [t],
  );

  const who = useCallback(
    (by: string) =>
      by === "system" ? t("v7.who.system") : whoIs(by, (id, f) => td("role", id, f)),
    [t, td],
  );

  const actorLabel = useCallback(
    (a: { kind: string; host?: string | null }) =>
      a.kind === "agent" && a.host
        ? td("v7.actor", a.host, t("v7.actor.agent"))
        : td("v7.actor", a.kind, a.kind),
    [t, td],
  );

  return useMemo(
    () => ({
      fieldLabel,
      opLabel,
      effectLabel,
      effectShort,
      chipLabel,
      valueLabel,
      scopeText,
      ago,
      who,
      actorLabel,
    }),
    [
      fieldLabel,
      opLabel,
      effectLabel,
      effectShort,
      chipLabel,
      valueLabel,
      scopeText,
      ago,
      who,
      actorLabel,
    ],
  );
}

/** A short date such as "Oct 7", in the viewer's language. */
export function shortDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    month: "short",
    day: "numeric",
  }).format(d);
}
