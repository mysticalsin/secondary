// The Admin area: Roles, Memberships, Requests, Elevations, NDA grants, Audit.
// Every tab asks the server and shows the server's reason when it says no.

import { useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui";
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
  { key: "roles", label: "Roles", el: RolesTab },
  { key: "memberships", label: "Memberships", el: MembershipsTab },
  { key: "requests", label: "Requests", el: RequestsTab },
  { key: "elevations", label: "Elevations", el: ElevationsTab },
  { key: "nda", label: "NDA grants", el: NdaTab },
  { key: "audit", label: "Audit", el: AuditTab },
] as const;

export function Admin() {
  const { epoch } = useApp();
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
  const tab = TABS.find((t) => t.key === key) ?? TABS[0];
  const Body = tab.el;
  return (
    <div className="page stack" style={{ gap: 24 }}>
      <PageHead
        eyebrow="Admin"
        title={
          <>
            Who can do <em>what.</em>
          </>
        }
        lead="Roles are data. Changes are versioned and audited, and anything touching restricted scopes needs a second person."
      />
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`adm-tab-${t.key}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab.key === t.key}
            aria-controls="adm-panel"
            onClick={() => setSp({ tab: t.key })}
          >
            {t.label}
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
