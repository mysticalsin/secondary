import { useState } from "react";
import { Await, PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import type { UsageBlock } from "../../uxv2/types";

function Block({
  b,
  rows,
}: {
  b: UsageBlock;
  rows: { capability: string; tokens: number; runs: number }[];
}) {
  const { t, td, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale);
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <div className="usage-body">
      <dl className="usage-stats">
        <div>
          <dt>{t("usage.tokens")}</dt>
          <dd className="num">{nf.format(b.tokens)}</dd>
        </div>
        <div>
          <dt>{t("usage.runs")}</dt>
          <dd className="num">{nf.format(b.runs)}</dd>
        </div>
        <div>
          <dt>{t("usage.saved")}</dt>
          <dd className="num">{Math.round(b.savedPct * 100)}%</dd>
        </div>
      </dl>
      <p className="muted">{t("usage.saved.how")}</p>
      {rows.length ? (
        <section aria-labelledby="usage-cap">
          <h3 id="usage-cap">{t("usage.by")}</h3>
          <ul className="bars">
            {rows.map((r) => (
              <li key={r.capability}>
                <span>{td("usage.cap", r.capability, r.capability)}</span>
                <span className="bar" aria-hidden>
                  <i style={{ width: `${Math.max(3, (r.tokens / max) * 100)}%` }} />
                </span>
                <span className="num muted">
                  {t("usage.row", { tokens: nf.format(r.tokens), runs: nf.format(r.runs) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function Usage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [tab, setTab] = useState<"me" | "tenant">("me");
  const usage = useApi(() => ux2.usage(period), [period]);
  const periods: [typeof period, Key][] = [
    ["7d", "usage.p7"],
    ["30d", "usage.p30"],
  ];
  return (
    <div className="page usage">
      <PageHead eyebrow={t("nav.usage")} title={t("usage.title")} lead={t("usage.lead")} />
      <div className="row usage-bar">
        <div className="pills" role="group" aria-label={t("usage.period")}>
          {periods.map(([p, k]) => (
            <button
              key={p}
              type="button"
              className="pill"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
            >
              {t(k)}
            </button>
          ))}
        </div>
        <Await state={usage}>
          {(u) =>
            u.tenant ? (
              <div className="tabs" role="tablist" aria-label={t("usage.view")}>
                {(["me", "tenant"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                  >
                    {k === "me" ? t("usage.tab.me") : t("usage.tab.tenant")}
                  </button>
                ))}
              </div>
            ) : null
          }
        </Await>
      </div>
      <Await state={usage}>
        {(u) =>
          tab === "tenant" && u.tenant ? (
            <Block b={u.tenant} rows={u.tenant.byCapability ?? []} />
          ) : (
            <Block b={u.me} rows={u.byCapability} />
          )
        }
      </Await>
    </div>
  );
}
