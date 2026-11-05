import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { StageBoard } from "../components/StageBoard";
import { Await, PageHead } from "../components/ui";
import { useApp } from "../state";
import { useApi } from "../useApi";
import { MaturityBar } from "./Governances";

export function GovernanceBoard() {
  const { id = "" } = useParams();
  const { openNode } = useApp();
  const state = useApi(() => api.governance(id), [id]);
  return (
    <div className="page">
      <p style={{ marginBottom: 16 }}>
        <Link className="btn sm ghost" to="/governances">
          <ArrowLeft size={14} aria-hidden /> All governances
        </Link>
      </p>
      <Await state={state} skeleton={3}>
        {(d) => (
          <>
            <PageHead
              eyebrow={d.governance.group}
              title={d.governance.label}
              lead={`${d.governance.useCases} use cases across five stages.`}
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
