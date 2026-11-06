// A brain's "My view" tab: the views the person pinned to this brain. Same card chrome as My Home.
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Await } from "../components/ui";
import { useI18n } from "../i18n";
import { useApi } from "../useApi";
import { useAgentHost } from "./host";
import { ViewCard } from "./ViewCard";
import { type SavedView, viewsApi } from "./views";
import "./agent.css";

export default function BrainViews({ brainId }: { brainId: string }) {
  const { t } = useI18n();
  const { setOpen } = useAgentHost();
  const state = useApi(() => viewsApi.list(brainId), [brainId]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Map<string, SavedView>>(new Map());
  return (
    <div className="ag-myview" data-testid="agent-myview">
      <Await state={state} skeleton={2}>
        {(views) => {
          const shown = views.filter((v) => !gone.has(v.id)).map((v) => edits.get(v.id) ?? v);
          return shown.length ? (
            <div className="ag-stack gap-l">
              {shown.map((v) => (
                <ViewCard
                  key={v.id}
                  view={v}
                  onChanged={(nv) => {
                    if (!nv) setGone((g) => new Set(g).add(v.id));
                    else setEdits((m) => new Map(m).set(v.id, { ...nv, tree: nv.tree ?? v.tree }));
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty ag-empty">
              <h3>{t("v6.myview.empty")}</h3>
              <p>{t("v6.myview.empty.lead")}</p>
              <button type="button" className="btn primary" onClick={() => setOpen(true)}>
                <Sparkles size={15} aria-hidden /> {t("v6.home.ask")}
              </button>
            </div>
          );
        }}
      </Await>
    </div>
  );
}
