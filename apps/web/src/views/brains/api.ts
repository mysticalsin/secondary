import { ApiError, getPersona, MOCK, request } from "../../api";
import { getLang, translate } from "../../i18n";
import type {
  AccessView,
  AgentHost,
  BatchResult,
  BrainCard,
  BrainHome,
  BrainRole,
  BrainType,
  CoachProposal,
  CoachView,
  Everyone,
  FieldDef,
  FieldsView,
  ImportFormat,
  ImportPreview,
  ImportResult,
  JournalDays,
  MemberResult,
  PilotView,
  Publication,
  Template,
  Version,
} from "./types";

const q = encodeURIComponent;
const b = (id: string) => `/v1/brains/${q(id)}`;

export const v3 = {
  brains: (type?: BrainType | "", term?: string) => {
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (term) p.set("q", term);
    const s = p.toString();
    return request<{ brains: BrainCard[] }>("GET", `/v1/brains${s ? `?${s}` : ""}`);
  },
  brain: (id: string) => request<BrainHome>("GET", b(id)),
  setTemplate: (id: string, template: Template) =>
    request<{ ok: boolean; template: Template; added: string[] }>("POST", `${b(id)}/template`, {
      template,
    }),
  access: (id: string) => request<AccessView>("GET", `${b(id)}/access`),
  setAccess: (id: string, body: { publication?: Publication; everyone?: Everyone }) =>
    request<
      | { ok: true; publication: Publication; everyone: Everyone }
      | { ok: true; status: "pending"; needs: "second_person" }
    >("PUT", `${b(id)}/access`, body),
  setMember: (id: string, principalId: string, role: BrainRole) =>
    request<MemberResult>("PUT", `${b(id)}/access/members/${q(principalId)}`, { role }),
  removeMember: (id: string, principalId: string) =>
    request<MemberResult>("DELETE", `${b(id)}/access/members/${q(principalId)}`),
  fields: (id: string) => request<FieldsView>("GET", `${b(id)}/fields`),
  saveFields: (id: string, fields: FieldDef[]) =>
    request<{ ok: true }>("PUT", `${b(id)}/fields`, { fields }),
  versions: (id: string, pid: string) =>
    request<{ versions: Version[] }>("GET", `${b(id)}/pages/${q(pid)}/versions`),
  hide: (id: string, pid: string, rev: number, reason: string) =>
    request<{ ok: true }>("POST", `${b(id)}/pages/${q(pid)}/versions/${rev}/hide`, { reason }),
  restore: (id: string, pid: string, rev: number) =>
    request<{ ok: true }>("POST", `${b(id)}/pages/${q(pid)}/versions/${rev}/restore`, {}),
  journal: (id: string) => request<JournalDays>("GET", `${b(id)}/journal`),
  runJournal: (id: string, date?: string) =>
    request<{ ok: true; pageId: string | null; created: boolean }>(
      "POST",
      `${b(id)}/journal/run`,
      date ? { date } : {},
    ),
  coach: (id: string) => request<CoachView>("GET", `${b(id)}/coach`),
  propose: (id: string, answers: Record<string, unknown>) =>
    request<CoachProposal>("POST", `${b(id)}/coach/propose`, { answers }),
  apply: (id: string, proposalId: string, hash: string) =>
    request<{ ok: true; created: string[] }>("POST", `${b(id)}/coach/apply`, { proposalId, hash }),
  agents: () => request<{ hosts: AgentHost[] }>("GET", "/v1/agents"),
  agentConfig: () => request<{ mcpUrl: string | null }>("GET", "/v1/agents/config"),
  revokeConnection: (id: string) =>
    request<{ ok: true; revoked: number }>("POST", `/v1/agents/connections/${q(id)}/revoke`, {}),
  revokeHost: (host: string) =>
    request<{ ok: true; revoked: number }>("POST", `/v1/agents/hosts/${q(host)}/revoke`, {}),
  pilot: () => request<PilotView>("GET", "/v1/admin/pilot"),
  savePilot: (
    body: { name: string; members: string[]; flags: Record<string, boolean> },
    id?: string,
  ) =>
    id
      ? request<{ ok: true }>("PUT", `/v1/admin/pilot/${q(id)}`, body)
      : request<{ id: string }>("POST", "/v1/admin/pilot", body),
  deletePilot: (id: string) => request<{ ok: true }>("DELETE", `/v1/admin/pilot/${q(id)}`),
  flags: () => request<{ flags: Record<string, boolean> }>("GET", "/v1/me/flags"),
  batch: (items: { id: string; action: string; revisionHash?: string; note?: string }[]) =>
    request<BatchResult>("POST", "/v1/questions/batch", { items }),
};

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * POST the raw archive. The mock gets the file's name and size only (it makes up classifier results).
 * With `dryRun` the API answers with the classifier's verdicts and stores nothing.
 */
export function importArchive(id: string, format: ImportFormat, file: File): Promise<ImportResult>;
export function importArchive(
  id: string,
  format: ImportFormat,
  file: File,
  dryRun: true,
): Promise<ImportPreview>;
export async function importArchive(
  id: string,
  format: ImportFormat,
  file: File,
  dryRun?: true,
): Promise<ImportResult | ImportPreview> {
  const path = `${b(id)}/import?format=${format}${dryRun ? "&dryRun=1" : ""}`;
  if (MOCK)
    return request<ImportResult | ImportPreview>("POST", path, {
      fileName: file.name,
      size: file.size,
    });
  const persona = getPersona();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": file.name.toLowerCase().endsWith(".json")
        ? "application/json"
        : "application/zip",
      ...(persona ? { "X-Demo-Persona": persona } : {}),
    },
    body: file,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(
      res.status,
      typeof data.reason === "string"
        ? data.reason
        : translate(getLang(), "err.failed", { status: res.status }),
      data,
    );
  return data as unknown as ImportResult | ImportPreview;
}
