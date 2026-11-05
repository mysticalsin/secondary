import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { STAGE_COLOR } from "../components/StageBoard";
import { Await, Chip, PageHead } from "../components/ui";
import { useI18n } from "../i18n";
import { type GovernanceCard, STAGES } from "../types";
import { useApi } from "../useApi";

export function MaturityBar({ g }: { g: GovernanceCard }) {
  const { t, td } = useI18n();
  const total = Math.max(1, g.useCases);
  return (
    <div
      className="progress"
      role="img"
      aria-label={t("gov.maturity", {
        list: STAGES.map((s) => `${g.stages[s]} ${td("stage", s, s)}`).join(", "),
      })}
    >
      {STAGES.map((s) => (
        <i
          key={s}
          style={{ width: `${(g.stages[s] / total) * 100}%`, background: STAGE_COLOR[s] }}
        />
      ))}
    </div>
  );
}

export function Governances() {
  const { t, td } = useI18n();
  const state = useApi(() => api.governances(), []);
  return (
    <div className="page">
      <PageHead
        eyebrow={t("nav.governances")}
        title={
          <>
            {t("gov.title.a")} <em>{t("gov.title.b")}</em>
          </>
        }
        lead={t("gov.lead")}
      />
      <Await state={state} skeleton={4}>
        {(d) => {
          const total = d.reduce((s, g) => s + g.useCases, 0);
          return (
            <>
              <p className="muted" style={{ marginBottom: 12 }}>
                {t("gov.visible", { n: total })}
              </p>
              <ul className="grid auto" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {d.map((g) => {
                  const locked = g.useCases === 0;
                  return (
                    <li key={g.id}>
                      {locked ? (
                        <div className="card acard">
                          <Chip tone="risk">
                            <Lock size={11} aria-hidden /> {t("common.locked")}
                          </Chip>
                          <h3>{g.label}</h3>
                          <p className="muted">{t("gov.nameonly")}</p>
                        </div>
                      ) : (
                        <Link className="card acard" to={`/governances/${g.id}`}>
                          <span className="muted" style={{ fontSize: 13 }}>
                            {td("group", g.group, g.group)}
                          </span>
                          <h3>{g.label}</h3>
                          <div>
                            <b className="num" style={{ fontSize: 26 }}>
                              {g.useCases}
                            </b>{" "}
                            <span className="muted">{t("gov.usecases")}</span>
                          </div>
                          <MaturityBar g={g} />
                          <div className="muted" style={{ fontSize: 13 }}>
                            {t("gov.summary", {
                              deployed: g.stages.Deployed,
                              piloting: g.stages.Piloting,
                            })}
                          </div>
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="legend" style={{ marginTop: 16 }}>
                {STAGES.map((s) => (
                  <span key={s}>
                    <i className="dotk" style={{ background: STAGE_COLOR[s] }} />
                    {td("stage", s, s)}
                  </span>
                ))}
              </div>
            </>
          );
        }}
      </Await>
    </div>
  );
}
