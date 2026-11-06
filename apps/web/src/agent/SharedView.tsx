// /agent/shared/:shareId. The link is to the plan, never to data: the server returns the tree
// re-resolved for this viewer, and every card still resolves its data as this viewer.
import { useParams } from "react-router-dom";
import { Await } from "../components/ui";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";
import "./agent.css";
import { useAgentHost } from "./host";
import { AgentRender } from "./Renderer";
import { useAgentSettings } from "./useSettings";
import { viewsApi } from "./views";

export default function SharedView() {
  const { shareId = "" } = useParams();
  const { t } = useI18n();
  const { ask } = useAgentHost();
  const s = useAgentSettings();
  const state = useApi(() => viewsApi.shared(shareId), [shareId]);
  return (
    <div className="page v4page wide ag-page">
      <h1 className="ptitle">{state.data?.name || t("v6.shared.title")}</h1>
      <p className="muted">{t("v6.shared.lead")}</p>
      {state.status === 404 ? (
        <div className="empty">
          <h3>{t("v6.shared.gone")}</h3>
        </div>
      ) : (
        <Await state={state} skeleton={2}>
          {(v) => (
            <AgentRender
              root={v.tree}
              density={s.density}
              theme={s.theme}
              onTurn={(e, label) => ask({ label, action: e })}
            />
          )}
        </Await>
      )}
    </div>
  );
}
