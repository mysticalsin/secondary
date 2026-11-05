import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Await, Chip, Empty, PageHead, PlaneBadge, statusTone } from "../components/ui";
import { useApi } from "../useApi";

export function Accounts() {
  const state = useApi(() => api.accounts(), []);
  const [f, setF] = useState({ region: "", country: "", sector: "", status: "", q: "" });
  const all = state.data?.accounts ?? [];
  const opts = useMemo(() => {
    const u = (k: "region" | "country" | "sector" | "status") =>
      [...new Set(all.map((a) => a[k]))].sort();
    return { region: u("region"), country: u("country"), sector: u("sector"), status: u("status") };
  }, [all]);
  const shown = all.filter(
    (a) =>
      (!f.region || a.region === f.region) &&
      (!f.country || a.country === f.country) &&
      (!f.sector || a.sector === f.sector) &&
      (!f.status || a.status === f.status) &&
      (!f.q || a.name.toLowerCase().includes(f.q.toLowerCase())),
  );
  const sel = (k: "region" | "country" | "sector" | "status", label: string) => (
    <div className="field">
      <label htmlFor={`f-${k}`} className="sr-only">
        {label}
      </label>
      <select
        id={`f-${k}`}
        className="select"
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      >
        <option value="">{label}: all</option>
        {opts[k].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="page">
      <PageHead
        eyebrow="Accounts"
        title={
          <>
            Client workspaces, <em>by scope.</em>
          </>
        }
        lead="You see the accounts your role admits. Names under NDA stay hidden without a named grant."
      />
      <div className="filters">
        <div className="field">
          <label htmlFor="f-q" className="sr-only">
            Search accounts
          </label>
          <input
            id="f-q"
            className="input"
            placeholder="Search accounts"
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
          />
        </div>
        {sel("region", "Region")}
        {sel("country", "Country")}
        {sel("sector", "Sector")}
        {sel("status", "Status")}
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => setF({ region: "", country: "", sector: "", status: "", q: "" })}
        >
          Clear
        </button>
      </div>
      <Await state={state} skeleton={4}>
        {() =>
          all.length === 0 ? (
            <Empty title="No accounts in your scope">
              Your role does not admit any account workspace.
            </Empty>
          ) : shown.length === 0 ? (
            <Empty title="No match">Try a different filter.</Empty>
          ) : (
            <ul className="grid auto" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shown.map((a) => (
                <li key={a.id}>
                  <Link className="card acard" to={`/accounts/${a.id}`}>
                    <PlaneBadge plane={a.plane} />
                    <h3>{a.name}</h3>
                    <div className="meta">
                      <span className="muted">{a.country}</span>
                      <span className="muted">· {a.sector}</span>
                    </div>
                    <div className="meta">
                      <Chip tone={statusTone(a.status)}>{a.status}</Chip>
                      <Chip tone={statusTone(a.aiProcessing)}>AI: {a.aiProcessing}</Chip>
                    </div>
                    <div className="foot">
                      <span>{a.openItems} open</span>
                      <span>
                        <Star size={13} aria-hidden style={{ verticalAlign: -2 }} color="#f8f060" />{" "}
                        {a.stars} {a.stars === 1 ? "story" : "stories"}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Await>
    </div>
  );
}
