import { getPersona, request } from "../../api";
import type {
  MeetingInput,
  WikiAnswer,
  WikiFact,
  WikiHealthRow,
  WikiIndex,
  WikiLogEntry,
  WikiPage,
  WikiProposal,
  WikiProposalRow,
  WikiRevision,
  WikiSearchHit,
} from "./types";

const q = encodeURIComponent;
const base = (ws: string) => `/v1/wiki/${q(ws)}`;

// The map asks for every wiki's health on each visit. A short cache per persona keeps that cheap.
let healthCache: { at: number; persona: string | null; rows: Promise<WikiHealthRow[]> } | null =
  null;
const fetchHealth = (): Promise<WikiHealthRow[]> => {
  const persona = getPersona();
  if (healthCache && healthCache.persona === persona && Date.now() - healthCache.at < 30_000)
    return healthCache.rows;
  const rows = request<WikiHealthRow[]>("GET", "/v1/wiki/health");
  healthCache = { at: Date.now(), persona, rows };
  rows.catch(() => {
    healthCache = null;
  });
  return rows;
};

export const wikiApi = {
  health: fetchHealth,
  index: (ws: string) => request<WikiIndex>("GET", `${base(ws)}/index`),
  page: (ws: string, id: string, rev?: number) =>
    request<WikiPage>("GET", `${base(ws)}/pages/${q(id)}${rev ? `?rev=${rev}` : ""}`),
  history: (ws: string, id: string) =>
    request<WikiRevision[]>("GET", `${base(ws)}/pages/${q(id)}/history`),
  facts: (ws: string) => request<WikiFact[]>("GET", `${base(ws)}/facts?all=1`),
  log: (ws: string) => request<WikiLogEntry[]>("GET", `${base(ws)}/log`),
  search: (ws: string, text: string) =>
    request<{ results: WikiSearchHit[] }>("GET", `${base(ws)}/search?q=${q(text)}`),
  ask: (ws: string, text: string) => request<WikiAnswer>("GET", `${base(ws)}/ask?q=${q(text)}`),
  proposals: (ws: string) => request<WikiProposalRow[]>("GET", `${base(ws)}/proposals`),
  proposal: (ws: string, id: string) =>
    request<WikiProposal>("GET", `${base(ws)}/proposals/${q(id)}`),
  decide: (ws: string, id: string, decision: "approve" | "reject") =>
    request<{ ok: boolean; status: string }>("POST", `${base(ws)}/proposals/${q(id)}/decide`, {
      decision,
    }),
  editProposal: (ws: string, id: string, pageId: string, markdown: string) =>
    request<{ ok: boolean }>("POST", `${base(ws)}/proposals/${q(id)}/edit`, { pageId, markdown }),
  propose: (ws: string, body: { title: string; markdown: string; pageId?: string }) =>
    request<{ ok: boolean; proposalId: string }>("POST", `${base(ws)}/propose`, body),
  meeting: (ws: string, body: MeetingInput) =>
    request<{ id: string; queued: boolean }>("POST", `${base(ws)}/meetings`, body),
  run: (ws: string, jobs?: ("lint" | "dream")[]) =>
    request<{ ok: boolean; results: Record<string, unknown>[] }>(
      "POST",
      `${base(ws)}/run`,
      jobs ? { jobs } : {},
    ),
  verify: (ws: string, factId: number) =>
    request<{ ok: boolean }>("POST", `${base(ws)}/facts/${factId}/verify`, {}),
  settings: (ws: string, body: { autoAccept?: boolean; freshnessDays?: number }) =>
    request<{ autoAccept: boolean; freshnessDays: number }>("PUT", `${base(ws)}/settings`, body),
  promote: (
    ws: string,
    page: string,
    body: {
      user_validated: { by: string; at: string; revision: number };
      acknowledged_flags: string[];
    },
  ) =>
    request<{ ok: boolean; candidateId: string }>(
      "POST",
      `${base(ws)}/pages/${q(page)}/promote`,
      body,
    ),
};

/** The wiki workspace of a policy node id: your own Personal Brain is `me`. */
export const wikiWsOf = (nodeId: string): string => (nodeId.startsWith("pb:") ? "me" : nodeId);
