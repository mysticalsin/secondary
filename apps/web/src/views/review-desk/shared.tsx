import { Building2, FileQuestion, Lock, Scale, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { nameOfEmail } from "../../lib/people";
import { whoIs } from "../../personas";
import type { RiskKey } from "./types";

/** Who wrote an item: a person by role or name, or an agent. */
export function useWho(): (a: { id: string; agent: boolean } | null) => string {
  const { t, td } = useI18n();
  return (a) => {
    if (!a) return "";
    if (a.agent || a.id.startsWith("svc:")) return t("wiki.agent");
    if (a.id.includes("@")) return nameOfEmail(a.id);
    return whoIs(a.id, (r, f) => td("role", r, f));
  };
}

/** A person known only by principal id (reassign, comments): the name when given, else the role. */
export function usePerson(): (id: string, name?: string | null) => string {
  const { t, td } = useI18n();
  return (id, name) => {
    if (name) return name;
    if (id.startsWith("svc:")) return t("wiki.agent");
    if (id.includes("@")) return nameOfEmail(id);
    return whoIs(id, (r, f) => td("role", r, f));
  };
}

const ICON: Record<RiskKey, ReactNode> = {
  client: <Building2 size={14} aria-hidden />,
  personal: <UserRound size={14} aria-hidden />,
  confidential: <Lock size={14} aria-hidden />,
  rule: <Scale size={14} aria-hidden />,
  unsupported: <FileQuestion size={14} aria-hidden />,
};

/** Risk icons with a text label for assistive technology and a tooltip. */
export function RiskIcons({ risk }: { risk: RiskKey[] }) {
  const { t } = useI18n();
  if (!risk.length) return null;
  return (
    <ul className="rv-risk-icons" aria-label={t("v8r.risk.flags")}>
      {risk.map((k) => (
        <li key={k} title={t(`v8r.risk.${k}` as never)}>
          {ICON[k]}
          <span className="sr-only">{t(`v8r.risk.${k}` as never)}</span>
        </li>
      ))}
    </ul>
  );
}

export const RISK_ICON = ICON;

/** The reading-time estimate, "~2 min". */
export function Effort({ n }: { n: number }) {
  const { t } = useI18n();
  return <span className="rv-effort mono">{t("v8r.effort", { n })}</span>;
}
