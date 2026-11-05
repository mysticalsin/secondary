import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Await } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import "./brains.css";
import type { BrainHome, BrainType } from "./types";

export const TYPE_KEY: Record<BrainType, Key> = {
  personal: "b3.type.personal",
  team: "b3.type.team",
  account: "b3.type.account",
  global: "b3.type.global",
};

export function TypeChip({ type }: { type: BrainType }) {
  const { t } = useI18n();
  return <span className={`chip bt-${type}`}>{t(TYPE_KEY[type])}</span>;
}

export function RestrictedChip() {
  const { t } = useI18n();
  return (
    <span className="chip t-attn">
      <Lock size={12} aria-hidden /> {t("b3.restricted")}
    </span>
  );
}

export function ManageChip() {
  const { t } = useI18n();
  return (
    <span className="chip t-done">
      <ShieldCheck size={12} aria-hidden /> {t("b3.manage")}
    </span>
  );
}

export const band = (score: number): "done" | "progress" | "risk" =>
  score >= 75 ? "done" : score >= 50 ? "progress" : "risk";

/** The brain's health score as a ring. The number and the word carry the meaning, the colour only echoes it. */
export function HealthRing({ score, size = 72 }: { score: number; size?: number }) {
  const { t } = useI18n();
  const stroke = Math.max(5, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = band(score);
  const word = t(`b3.health.${tone}` as Key);
  return (
    <svg
      className={`ring ring-${tone}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={t("b3.health.aria", { n: score, word })}
    >
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
      <circle
        className="ring-arc"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={`${(c * Math.max(0, Math.min(100, score))) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        strokeLinecap="round"
      />
      <text
        x="50%"
        y="50%"
        dy="0.35em"
        textAnchor="middle"
        className="ring-num"
        style={{ fontSize: size * 0.34 }}
      >
        {score}
      </text>
    </svg>
  );
}

/** Pilot flags for the caller. A flag nobody manages is on. A failed read changes nothing. */
export function useFlags(): Record<string, boolean> | null {
  const { epoch } = useApp();
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let live = true;
    v3.flags().then(
      (f) => live && setFlags(f.flags),
      () => live && setFlags({}),
    );
    return () => {
      live = false;
    };
  }, [epoch]);
  return flags;
}

export function relDays(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const d = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return Number.isNaN(d) ? null : Math.max(0, d);
}

export function LastActive({ iso }: { iso: string | null }) {
  const { t, tn } = useI18n();
  const d = relDays(iso);
  if (d === null) return <>{t("b3.activity.none")}</>;
  if (d === 0) return <>{t("b3.activity.today")}</>;
  return <>{tn(d, "b3.activity.day", "b3.activity.days")}</>;
}

/** The header of a page that belongs to one brain: a link back to the brain and the page's own title. */
export function BrainFrame({
  id,
  title,
  children,
  width,
}: {
  id: string;
  title: string;
  children: ReactNode | ((b: BrainHome) => ReactNode);
  width?: "narrow";
}) {
  const { t } = useI18n();
  const brain = useApi(() => v3.brain(id), [id]);
  return (
    <div className={`page v4page${width === "narrow" ? " narrow" : ""}`}>
      <Await state={brain} skeleton={2}>
        {(b) => (
          <>
            <p className="backlink">
              <Link to={`/brains/${encodeURIComponent(id)}`}>
                <ArrowLeft size={14} aria-hidden /> {id === "me" ? t("v4.personal") : b.name}
              </Link>
            </p>
            <h1 className="ptitle">{title}</h1>
            {typeof children === "function" ? children(b) : children}
          </>
        )}
      </Await>
    </div>
  );
}
