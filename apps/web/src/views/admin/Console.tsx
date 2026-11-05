// The Admin area: Roles, Memberships, Requests, Elevations, NDA grants, Audit.
// Every tab asks the server and shows the server's reason when it says no.

import { useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { useApp } from "../../state";
import { AuditTab } from "./AuditTab";
import { useAdminCaps } from "./api";
import { ElevationsTab } from "./ElevationsTab";
import { MembershipsTab } from "./MembershipsTab";
import { NdaTab } from "./NdaTab";
import { RequestsTab } from "./RequestsTab";
import { RolesTab } from "./RolesTab";
import "./admin.css";

const TABS = [
  { key: "roles", label: "adm.tab.roles", el: RolesTab },
  { key: "memberships", label: "adm.tab.memberships", el: MembershipsTab },
  { key: "requests", label: "adm.tab.requests", el: RequestsTab },
  { key: "elevations", label: "adm.tab.elevations", el: ElevationsTab },
  { key: "nda", label: "adm.tab.nda", el: NdaTab },
  { key: "audit", label: "adm.tab.audit", el: AuditTab },
] as const satisfies readonly { key: string; label: Key; el: unknown }[];

export function Admin() {
  const { epoch } = useApp();
  const { t } = useI18n();
  const caps = useAdminCaps();
  const [sp, setSp] = useSearchParams();
  const first = caps?.configure
    ? "roles"
    : caps?.steward
      ? "memberships"
      : caps?.auditor
        ? "audit"
        : "requests";
  const key = sp.get("tab") ?? first;
  const tab = TABS.find((x) => x.key === key) ?? TABS[0];
  const Body = tab.el;
  return (
    <div className="page stack" style={{ gap: 24 }}>
      <PageHead
        eyebrow={t("nav.admin")}
        title={
          <>
            {t("adm.title.a")} <em>{t("adm.title.b")}</em>
          </>
        }
        lead={t("adm.lead")}
      />
      <div className="tabs" role="tablist" aria-label={t("adm.tabs.label")}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            id={`adm-tab-${tb.key}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab.key === tb.key}
            aria-controls="adm-panel"
            onClick={() => setSp({ tab: tb.key })}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>
      <div
        id="adm-panel"
        role="tabpanel"
        aria-labelledby={`adm-tab-${tab.key}`}
        key={`${tab.key}-${epoch}`}
      >
        <Body />
      </div>
    </div>
  );
}
