import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { StageBoard } from "../components/StageBoard";
import { Await, PageHead } from "../components/ui";
import { useI18n } from "../i18n";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { MaturityBar } from "./Governances";

export function GovernanceBoard() {
  const { id = "" } = useParams();
  const { t, td } = useI18n();
  const { openNode } = useApp();
  const state = useApi(() => api.governance(id), [id]);
  return (
    <div className="page">
      <p style={{ marginBottom: 16 }}>
        <Link className="btn sm ghost" to="/governances">
          <ArrowLeft size={14} aria-hidden /> {t("gov.back")}
        </Link>
      </p>
      <Await state={state} skeleton={3}>
        {(d) => (
          <>
            <PageHead
              eyebrow={td("group", d.governance.group, d.governance.group)}
              title={d.governance.label}
              lead={t("gov.board.lead", { n: d.governance.useCases })}
            />
            <div style={{ marginBottom: 16 }}>
              <MaturityBar g={d.governance} />
            </div>
            <StageBoard useCases={d.useCases} onOpen={openNode} limit={40} />
          </>
        )}
      </Await>
    </div>
  );
}
