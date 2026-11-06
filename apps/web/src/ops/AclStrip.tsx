import { useI18n } from "../i18n";
import { TwinTable } from "../insights/InsightCard";
import { fmtWait, num, pctL } from "./format";
import type { SourceStats } from "./types";
import { Panel, Swatch } from "./ui";

/** ACL staleness: how many reads were confirmed within the max age, stale, or fail-closed. */
export function AclStrip({ acl }: { acl: SourceStats["acl"] }) {
  const { t, locale } = useI18n();
  const segs = [
    { key: "confirmed", n: acl.confirmed, cls: "ok", label: t("v7o.acl.confirmed") },
    { key: "stale", n: acl.stale, cls: "warn", label: t("v7o.acl.stale") },
    { key: "failClosed", n: acl.failClosed, cls: "fail", label: t("v7o.acl.failclosed") },
  ];
  const share = pctL(acl.share, locale);
  const summary = t("v7o.acl.summary", {
    share,
    age: fmtWait(acl.maxAgeSeconds),
    total: num(acl.total, locale),
    failed: acl.failClosed,
  });
  return (
    <Panel
      title={t("v7o.acl.title")}
      meta={<span className="mono">{t("v7o.acl.meta", { age: fmtWait(acl.maxAgeSeconds) })}</span>}
      summary={summary}
      testId="acl-strip"
      table={
        <TwinTable
          caption={t("v7o.acl.twin")}
          head={[t("v7o.acl.col.state"), t("v7o.acl.col.n")]}
          rows={segs.map((s) => [s.label, s.n])}
        />
      }
    >
      <div className="opx-acl">
        <p className="opx-acl-big">
          <b className="mono">{share}</b>{" "}
          <span>{t("v7o.acl.share", { age: fmtWait(acl.maxAgeSeconds) })}</span>
        </p>
        <div className="opx-seg" role="img" aria-label={summary}>
          {segs.map((s) => (
            <i key={s.key} className={`t-${s.cls}`} style={{ flexGrow: Math.max(s.n, 0.0001) }} />
          ))}
        </div>
        <ul className="opx-legend small">
          {segs.map((s) => (
            <li key={s.key}>
              <Swatch kind={s.cls as "ok"} /> {s.label} <b className="mono">{num(s.n, locale)}</b>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
