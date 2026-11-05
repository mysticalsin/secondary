import { Building2, Lock } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, request } from "../../api";
import { Await } from "../../components/ui";
import { type Key, useI18n } from "../../i18n";
import { initialsOf, nameOfEmail } from "../../lib/people";
import { useApp } from "../../state";
import { useApi } from "../../useApi";
import { ux2 } from "../../uxv2/api";
import { wikiApi } from "../wiki/api";
import { v3 } from "./api";
import { Choice, type ChoiceOption } from "./Choice";
import { BrainFrame } from "./shared";
import type { AccessView, BrainHome, BrainRole, Everyone, FieldsView, Publication } from "./types";

const ROLE_KEY: Record<BrainRole, [Key, Key]> = {
  reader: ["v4.role.reader", "v4.role.reader.d"],
  contributor: ["v4.role.contributor", "v4.role.contributor.d"],
  editor: ["v4.role.editor", "v4.role.editor.d"],
  steward: ["v4.role.steward", "v4.role.steward.d"],
  owner: ["v4.role.owner", "v4.role.owner.d"],
};

function useRoleOptions(view: AccessView): ChoiceOption[] {
  const { t } = useI18n();
  return view.roles.map((r) => ({
    id: r.id,
    label: t(ROLE_KEY[r.id][0]),
    desc: t(ROLE_KEY[r.id][1]),
  }));
}

function Who({ email }: { email: string }) {
  const name = nameOfEmail(email);
  return (
    <>
      <span className="avatar sm" aria-hidden>
        {initialsOf(name)}
      </span>
      <span className="who">
        <b>{name}</b>
        <span className="muted">{email}</span>
      </span>
    </>
  );
}

function EveryoneRow({
  id,
  view,
  onSaved,
  onPending,
}: {
  id: string;
  view: AccessView;
  onSaved: () => void;
  onPending: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const opts: ChoiceOption[] = (["none", "reader"] as Everyone[]).map((v) => ({
    id: v,
    label: t(v === "none" ? "v4.every.none" : "v4.every.reader"),
    desc: t(v === "none" ? "v4.every.none.d" : "v4.every.reader.d"),
    disabled: !view.everyone.allowed.includes(v),
  }));
  const pick = async (v: string) => {
    try {
      const r = await v3.setAccess(id, { everyone: v as Everyone });
      if ("status" in r && r.status === "pending") {
        say(t("b3.acc.pending.say"));
        onPending();
        return;
      }
      say(t("b3.acc.saved"));
      onSaved();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    }
  };
  const blocked = opts.some((o) => o.disabled) && view.everyone.reason;
  return (
    <li className="arow" data-testid="everyone-row">
      <span className="avatar sm bld" aria-hidden>
        <Building2 size={15} />
      </span>
      <span className="who">
        <b>{t("v4.everyone")}</b>
        {blocked ? (
          <span className="muted why">
            <Lock size={12} aria-hidden /> {view.everyone.reason}
          </span>
        ) : null}
      </span>
      <Choice
        label={t("v4.everyone")}
        value={view.everyone.level === "contributor" ? "reader" : view.everyone.level}
        options={opts}
        disabled={!view.canManage}
        onPick={pick}
      />
    </li>
  );
}

/** Email or id to the principal id the API wants. Stewards can read the directory; others type an id. */
async function resolvePrincipal(input: string): Promise<string> {
  const text = input.trim();
  if (!text.includes("@")) return text;
  try {
    const people = await request<{ id: string; email: string }[]>("GET", "/v1/admin/principals");
    const hit = people.find((p) => p.email.toLowerCase() === text.toLowerCase());
    if (hit) return hit.id;
  } catch {
    /* the directory is for stewards: fall through and let the API say if the address is unknown */
  }
  return text;
}

function Members({
  id,
  view,
  reload,
  onPending,
}: {
  id: string;
  view: AccessView;
  reload: () => void;
  onPending: () => void;
}) {
  const { t, tn } = useI18n();
  const { say } = useApp();
  const roles = useRoleOptions(view);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<BrainRole>("reader");
  const run = async (fn: () => ReturnType<typeof v3.setMember>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (r.status === "pending") {
        say(t("b3.acc.pending.say"));
        onPending();
      } else say(t("b3.acc.saved"));
      reload();
      return true;
    } catch (e) {
      setErr(e instanceof ApiError ? e.reason : t("common.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const members = view.members ?? [];
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!who.trim()) return;
    const pid = await resolvePrincipal(who);
    if (await run(() => v3.setMember(id, pid, role))) setWho("");
  };
  return (
    <section aria-labelledby="acc-h" className="asec">
      {view.canManage && view.type !== "personal" ? (
        <form className="addrow" onSubmit={add}>
          <label className="sr-only" htmlFor="m-new">
            {t("v4.add.ph")}
          </label>
          <input
            id="m-new"
            className="input big"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder={t("v4.add.ph")}
          />
          <label className="sr-only" htmlFor="m-role">
            {t("b3.acc.role")}
          </label>
          <select
            id="m-role"
            className="select big"
            value={role}
            onChange={(e) => setRole(e.target.value as BrainRole)}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary big" disabled={busy || !who.trim()}>
            {t("v4.add")}
          </button>
        </form>
      ) : null}
      {err ? (
        <div className="errorbox" role="alert">
          {err}
        </div>
      ) : null}
      <h2 id="acc-h" className="sub">
        {t("v4.who.has")}{" "}
        <span className="cnt">{tn(members.length + 1, "v4.people.one", "v4.people.other")}</span>
      </h2>
      {view.members === null ? <p className="muted">{t("b3.acc.members.hidden")}</p> : null}
      <ul className="alist">
        <EveryoneRow id={id} view={view} onSaved={reload} onPending={onPending} />
        {members.map((m) => (
          <li key={m.principalId} className="arow">
            <Who email={m.email} />
            {m.state === "pending" ? (
              <span className="tag attn">{t("b3.acc.s.pending")}</span>
            ) : null}
            <Choice
              label={t("b3.acc.role.of", { who: m.email })}
              value={m.role}
              options={roles}
              disabled={!view.canManage || busy}
              onPick={(r) => run(() => v3.setMember(id, m.principalId, r as BrainRole))}
              {...(view.canManage
                ? {
                    remove: {
                      label: t("v4.remove"),
                      onPick: () => {
                        void run(() => v3.removeMember(id, m.principalId));
                      },
                    },
                  }
                : {})}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PublicationSection({
  id,
  view,
  reload,
  onPending,
}: {
  id: string;
  view: AccessView;
  reload: () => void;
  onPending: () => void;
}) {
  const { t } = useI18n();
  const { say } = useApp();
  const waiting = useApi(() => ux2.questions({ brain: id }), [id]);
  const n = waiting.data?.length ?? 0;
  const needReview = (waiting.data ?? []).filter((q) => (q.detail?.required ?? 1) > 1).length;
  const opts: ChoiceOption[] = (["review", "direct"] as Publication[]).map((v) => ({
    id: v,
    label: t(`b3.acc.pub.${v}` as Key),
    desc: t(`b3.acc.pub.${v}.d` as Key),
    disabled: !view.publication.allowed.includes(v),
  }));
  const pick = async (v: string) => {
    try {
      const r = await v3.setAccess(id, { publication: v as Publication });
      if ("status" in r && r.status === "pending") onPending();
      say(t("b3.acc.saved"));
      reload();
    } catch (e) {
      say(e instanceof ApiError ? e.reason : t("common.failed"));
    }
  };
  return (
    <section className="asec" aria-labelledby="pub-h">
      <div className="split-row">
        <div>
          <h2 id="pub-h" className="sub">
            {t("v4.publication")}
          </h2>
          {n > 0 ? (
            <p className="muted publine">
              {t("v4.pub.waiting", { n })} ·{" "}
              <Link to={`/waiting?brain=${encodeURIComponent(id)}`}>{t("v4.pub.publish")}</Link>
              {needReview ? <> · {t("v4.pub.needs", { n: needReview })}</> : null}
            </p>
          ) : (
            <p className="muted publine">{t("v4.pub.none")}</p>
          )}
          {view.publication.reason && view.publication.allowed.length < 2 ? (
            <p className="muted why">
              <Lock size={12} aria-hidden /> {view.publication.reason}
            </p>
          ) : null}
        </div>
        <Choice
          label={t("v4.publication")}
          value={view.publication.mode}
          options={opts}
          disabled={!view.canManage}
          onPick={pick}
        />
      </div>
    </section>
  );
}

function BusinessFields({ id, b }: { id: string; b: BrainHome }) {
  const { t, td } = useI18n();
  const fields = useApi(() => v3.fields(id), [id]);
  return (
    <section className="asec" aria-labelledby="bf-h">
      <div className="split-row">
        <div>
          <h2 id="bf-h" className="sub">
            {t("v4.fields")}
          </h2>
          <p className="muted">{t("v4.fields.lead")}</p>
        </div>
        <Link className="btn soft sm" to={`/brains/${encodeURIComponent(id)}/fields`}>
          {b.manages ? t("v4.fields.edit") : t("v4.fields.view")}
        </Link>
      </div>
      <Await state={fields} skeleton={1}>
        {(f: FieldsView) =>
          f.fields.length ? (
            <ul className="chips">
              {f.fields.map((x) => (
                <li key={x.key} className="chip t-open">
                  {x.label || x.key}
                  <span className="sr-only">: </span>
                  <span className="mute-s">{td("b3.fld.sens", x.sensitivity, x.sensitivity)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("v4.fields.none")}</p>
          )
        }
      </Await>
    </section>
  );
}

function HiddenVersions({ id }: { id: string }) {
  const { t } = useI18n();
  const idx = useApi(() => wikiApi.index(id), [id]);
  const [pid, setPid] = useState("");
  const pages = useMemo(() => idx.data?.pages ?? [], [idx.data]);
  return (
    <section className="asec" aria-labelledby="hv-h">
      <h2 id="hv-h" className="sub">
        {t("v4.hidden")}
      </h2>
      <p className="muted">{t("v4.hidden.lead")}</p>
      <div className="addrow">
        <label className="sr-only" htmlFor="hv-page">
          {t("v4.hidden.pick")}
        </label>
        <select
          id="hv-page"
          className="select big"
          value={pid}
          onChange={(e) => setPid(e.target.value)}
        >
          <option value="">{t("v4.hidden.pick")}</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        {pid ? (
          <Link
            className="btn soft"
            to={`/brains/${encodeURIComponent(id)}/pages/${encodeURIComponent(pid)}/versions`}
          >
            {t("v4.hidden.open")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export function AccessPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const access = useApi(() => v3.access(id), [id]);
  const [pendingNow, setPendingNow] = useState(false);
  return (
    <BrainFrame id={id} title={t("v4.members.access")} width="narrow">
      {(b) => (
        <Await state={access} skeleton={3}>
          {(view) => {
            const waiting = (view.members ?? []).filter((m) => m.state === "pending").length;
            return (
              <div className="stack access4">
                {waiting > 0 || pendingNow ? (
                  <div className="banner" role="status" data-testid="pending-banner">
                    <b>{t("b3.acc.banner.title")}</b>{" "}
                    <span>{t("b3.acc.banner.lead", { n: Math.max(waiting, 1) })}</span>{" "}
                    <Link to="/settings/members">{t("b3.acc.banner.link")}</Link>
                  </div>
                ) : null}
                {view.type === "personal" ? (
                  <div className="banner info" role="note">
                    {t("b3.acc.personal")}
                  </div>
                ) : null}
                {!view.canManage ? (
                  <p className="muted" role="note">
                    {t("b3.acc.readonly")}
                  </p>
                ) : null}
                <Members
                  id={id}
                  view={view}
                  reload={access.reload}
                  onPending={() => setPendingNow(true)}
                />
                <PublicationSection
                  id={id}
                  view={view}
                  reload={access.reload}
                  onPending={() => setPendingNow(true)}
                />
                <BusinessFields id={id} b={b} />
                <HiddenVersions id={id} />
              </div>
            );
          }}
        </Await>
      )}
    </BrainFrame>
  );
}
