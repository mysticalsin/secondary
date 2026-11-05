import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Await, Chip, Eyebrow, fmtDate } from "../components/ui";
import { AskPanel } from "../genui";
import { PERSONAS } from "../personas";
import { useApp } from "../state";
import { useApi } from "../useApi";

const WORLD: [string, string][] = [
  ["Montreal", "America/Toronto"],
  ["São Paulo", "America/Sao_Paulo"],
  ["Bogotá", "America/Bogota"],
  ["Paris", "Europe/Paris"],
  ["Ho Chi Minh City", "Asia/Ho_Chi_Minh"],
];

function useNow(ms = 20000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const timeIn = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);

function greeting(d: Date): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Toronto",
    }).format(d),
  );
  return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

export function Today() {
  const { me, openNode } = useApp();
  const now = useNow();
  const review = useApi(() => api.review(), []);
  const map = useApi(() => api.map("departments"), []);
  const accounts = useApi(() => api.accounts(), []);
  const activity = useApi(() => api.activity(), []);
  const role = me ? PERSONAS.find((p) => p.id === me.principal.roleIds[0])?.label : undefined;

  const date = new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  }).format(now);
  const openHubs = (map.data?.hubs ?? [])
    .filter((h) => h.counts && h.counts.open > 0)
    .sort((a, b) => (b.counts?.open ?? 0) - (a.counts?.open ?? 0))
    .slice(0, 4);
  const openAccounts = (accounts.data?.accounts ?? []).filter((a) => a.openItems > 0).slice(0, 3);
  const waiting = review.data?.candidates ?? [];
  const nothing =
    !review.loading &&
    !map.loading &&
    !accounts.loading &&
    waiting.length === 0 &&
    openHubs.length === 0 &&
    openAccounts.length === 0;

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <section className="hero" aria-label="Today">
        <Eyebrow>Toronto · {role ?? "Company Brain"}</Eyebrow>
        <h2>{greeting(now)}</h2>
        <div className="clock">{timeIn(now, "America/Toronto")}</div>
        <p style={{ color: "var(--lilac-1)" }}>{date}</p>
      </section>

      <div className="grid cols-2">
        <section className="card" aria-labelledby="seedo-h">
          <h3 id="seedo-h">What you can see and do</h3>
          {me ? (
            <>
              <div className="seedo">
                <div>
                  <Eyebrow>See</Eyebrow>
                  <ul>
                    {me.describe.see.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <Eyebrow>Do</Eyebrow>
                  <ul>
                    {me.describe.do.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="never">
                <strong>Never:</strong> {me.describe.never.join(". ")}.
              </div>
            </>
          ) : (
            <p className="muted">Loading your access summary.</p>
          )}
        </section>

        <section className="card" aria-labelledby="attn-h">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 id="attn-h" style={{ marginBottom: 0 }}>
              Needs attention
            </h3>
            <Chip tone="attn">In your scope</Chip>
          </div>
          <div style={{ marginTop: 8 }}>
            {waiting.length > 0 ? (
              <div className="attn-row">
                <div>
                  <strong>{waiting.length}</strong>{" "}
                  {waiting.length === 1 ? "review is" : "reviews are"} waiting for you
                </div>
                <Link className="btn sm" to="/review">
                  Open Review <ChevronRight size={14} aria-hidden />
                </Link>
              </div>
            ) : null}
            {openHubs.map((h) => (
              <div className="attn-row" key={h.id}>
                <div>
                  <strong>{h.counts?.open}</strong> open decisions or overdue items in {h.label}
                </div>
                <button type="button" className="btn sm ghost" onClick={() => openNode(h.id)}>
                  Details
                </button>
              </div>
            ))}
            {openAccounts.map((a) => (
              <div className="attn-row" key={a.id}>
                <div>
                  <strong>{a.openItems}</strong> open items for {a.name}
                </div>
                <Link className="btn sm ghost" to={`/accounts/${a.id}`}>
                  Workspace
                </Link>
              </div>
            ))}
            {nothing ? <p className="muted">Nothing needs you right now.</p> : null}
            {review.error || map.error ? (
              <p className="reason err">Some items could not load: {review.error ?? map.error}</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="recent-h">
        <h3 id="recent-h">Recent approved changes</h3>
        {activity.error ? (
          <p className="muted">The activity feed is not available yet.</p>
        ) : (
          <Await state={activity} skeleton={2}>
            {(d) =>
              d.entries.length === 0 ? (
                <p className="muted">No approved changes in your scope yet.</p>
              ) : (
                <div>
                  {d.entries.map((e) => (
                    <div className="attn-row" key={e.id}>
                      <div>
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => openNode(e.nodeId)}
                        >
                          {e.title}
                        </button>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {e.scopeLabel} · {e.revision} · {fmtDate(e.at)}
                        </div>
                      </div>
                      <Chip tone="done">Approved</Chip>
                    </div>
                  ))}
                </div>
              )
            }
          </Await>
        )}
      </section>

      <AskPanel />

      <section aria-label="World strip">
        <Eyebrow>Where the teams are</Eyebrow>
        <div className="worldstrip" style={{ marginTop: 8 }}>
          {WORLD.map(([city, tz]) => (
            <div className="world" key={city}>
              <span className="muted" style={{ fontSize: 14 }}>
                {city}
              </span>
              <b>{timeIn(now, tz)}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
