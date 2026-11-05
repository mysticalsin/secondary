import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { STAGE_COLOR } from "../components/StageBoard";
import { Await, Chip, PageHead } from "../components/ui";
import { type GovernanceCard, STAGES } from "../types";
import { useApi } from "../useApi";

export function MaturityBar({ g }: { g: GovernanceCard }) {
  const total = Math.max(1, g.useCases);
  return (
    <div
      className="progress"
      role="img"
      aria-label={`Maturity: ${STAGES.map((s) => `${g.stages[s]} ${s}`).join(", ")}`}
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
  const state = useApi(() => api.governances(), []);
  return (
    <div className="page">
      <PageHead
        eyebrow="Governances"
        title={
          <>
            Twelve governances, <em>one pipeline.</em>
          </>
        }
        lead="Each governance owns its AI use cases, from discovery to deployment."
      />
      <Await state={state} skeleton={4}>
        {(d) => {
          const total = d.reduce((s, g) => s + g.useCases, 0);
          return (
            <>
              <p className="muted" style={{ marginBottom: 12 }}>
                {total} use cases visible to you.
              </p>
              <ul className="grid auto" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {d.map((g) => {
                  const locked = g.useCases === 0;
                  return (
                    <li key={g.id}>
                      {locked ? (
                        <div className="card acard">
                          <Chip tone="risk">
                            <Lock size={11} aria-hidden /> Locked
                          </Chip>
                          <h3>{g.label}</h3>
                          <p className="muted">Name only for your role.</p>
                        </div>
                      ) : (
                        <Link className="card acard" to={`/governances/${g.id}`}>
                          <span className="muted" style={{ fontSize: 13 }}>
                            {g.group}
                          </span>
                          <h3>{g.label}</h3>
                          <div>
                            <b className="num" style={{ fontSize: 26 }}>
                              {g.useCases}
                            </b>{" "}
                            <span className="muted">use cases</span>
                          </div>
                          <MaturityBar g={g} />
                          <div className="muted" style={{ fontSize: 13 }}>
                            {g.stages.Deployed} deployed, {g.stages.Piloting} piloting
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
                    {s}
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
