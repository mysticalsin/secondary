import { ArrowLeft, Lock } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Await, Chip, Empty, PlaneBadge, statusTone } from "../components/ui";
import type { AccountRecord } from "../types";
import { useApi } from "../useApi";

function Story({ r }: { r: AccountRecord }) {
  if (!r.story) return null;
  const ext = r.story.external;
  return (
    <div className="story">
      <div>
        <strong>Internal</strong>
        <div className="muted">{r.story.internal ? "Ready" : "Not written"}</div>
      </div>
      <div>
        <strong>Lesson</strong>
        <div className="muted">{r.story.lesson ? "Ready" : "Not written"}</div>
      </div>
      <div className={ext.available ? "" : "locked"}>
        <strong>{ext.available ? "External" : "External, locked"}</strong>
        <div className="muted">
          {ext.available ? "" : <Lock size={12} aria-hidden style={{ verticalAlign: -1 }} />}{" "}
          {ext.reason}
        </div>
      </div>
    </div>
  );
}

export function AccountWorkspace() {
  const { id = "" } = useParams();
  const state = useApi(() => api.account(id), [id]);
  const [tab, setTab] = useState("overview");

  return (
    <div className="page">
      <p style={{ marginBottom: 16 }}>
        <Link className="btn sm ghost" to="/accounts">
          <ArrowLeft size={14} aria-hidden /> All accounts
        </Link>
      </p>
      <Await state={state} skeleton={3}>
        {(d) => {
          const section = d.sections.find((s) => s.key === tab) ?? d.sections[0];
          const onKey = (e: KeyboardEvent) => {
            const i = d.sections.findIndex((s) => s.key === (section?.key ?? ""));
            const next =
              e.key === "ArrowRight"
                ? i + 1
                : e.key === "ArrowLeft"
                  ? i - 1
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? d.sections.length - 1
                      : -1;
            if (next < 0) return;
            e.preventDefault();
            const s = d.sections[(next + d.sections.length) % d.sections.length];
            if (s) {
              setTab(s.key);
              document.getElementById(`tab-${s.key}`)?.focus();
            }
          };
          return (
            <>
              <header className="page-head">
                <div className="row">
                  <PlaneBadge plane={d.account.plane} />
                  <Chip tone={statusTone(d.account.aiProcessing)}>
                    AI processing: {d.account.aiProcessing}
                  </Chip>
                  <Chip tone={statusTone(d.account.status)}>{d.account.status}</Chip>
                </div>
                <h2>{d.account.name}</h2>
                <p>
                  {d.account.country} · {d.account.region} · {d.account.sector}
                </p>
                {d.members ? (
                  <p className="muted" style={{ fontSize: 14 }}>
                    Members: {d.members.join(", ")}
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 14 }}>
                    Member list is visible to members only.
                  </p>
                )}
              </header>
              <div className="tabs" role="tablist" aria-label="Account sections" onKeyDown={onKey}>
                {d.sections.map((s) => (
                  <button
                    key={s.key}
                    id={`tab-${s.key}`}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={section?.key === s.key}
                    aria-controls="tabpanel"
                    tabIndex={section?.key === s.key ? 0 : -1}
                    onClick={() => setTab(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${section?.key}`}>
                {!section || section.items.length === 0 ? (
                  <Empty title="Nothing here yet">No records in this section for your role.</Empty>
                ) : (
                  <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {section.items.map((r) => (
                      <li className="card" key={r.id}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <strong>{r.title}</strong>
                          <span className="row">
                            <Chip tone={statusTone(r.status)}>{r.status}</Chip>
                            <span className="muted">{r.revision}</span>
                          </span>
                        </div>
                        {r.note ? (
                          <p className="muted" style={{ marginTop: 6 }}>
                            {r.note}
                          </p>
                        ) : null}
                        <Story r={r} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          );
        }}
      </Await>
    </div>
  );
}
