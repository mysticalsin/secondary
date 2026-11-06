// Saved views client (docs/API-CONTRACT.md "Saved views"): plan and layout only, never data.
import type {
  AgentNode,
  SavedViewInputValue,
  ViewLayoutItemValue,
} from "@secondary/contracts/agent-ui";
import { request } from "../api";
import { sanitizeTree } from "./tree";

export type Pin = "home" | { brain: string };

export interface SavedView {
  id: string;
  name: string;
  pin: Pin;
  layout?: ViewLayoutItemValue | undefined;
  program: string;
  updatedAt: string;
  shared: boolean;
  /** Parsed, checked and re-resolved for this viewer by the server, then checked again here. */
  tree: AgentNode | null;
}

interface WireView extends Omit<SavedView, "tree"> {
  tree?: unknown;
}

const q = encodeURIComponent;
const fix = (v: WireView): SavedView => ({ ...v, tree: sanitizeTree(v.tree) });

export const viewsApi = {
  list: async (pin?: "home" | string): Promise<SavedView[]> => {
    const r = await request<WireView[] | { views: WireView[] }>(
      "GET",
      `/v1/views${pin ? `?pin=${q(pin)}` : ""}`,
    );
    return (Array.isArray(r) ? r : r.views).map(fix);
  },
  create: async (input: SavedViewInputValue): Promise<SavedView> =>
    fix(await request<WireView>("POST", "/v1/views", input)),
  update: async (id: string, patch: Partial<SavedViewInputValue>): Promise<SavedView> =>
    fix(await request<WireView>("PUT", `/v1/views/${q(id)}`, patch)),
  remove: (id: string) => request<null>("DELETE", `/v1/views/${q(id)}`),
  share: (id: string) =>
    request<{ shareId: string; path: string }>("POST", `/v1/views/${q(id)}/share`, {}),
  unshare: (id: string) => request<null>("DELETE", `/v1/views/${q(id)}/share`),
  shared: async (shareId: string): Promise<{ name: string; tree: AgentNode | null }> => {
    const r = await request<{ name: string; tree?: unknown }>(
      "GET",
      `/v1/views/shared/${q(shareId)}`,
    );
    return { name: String(r.name ?? ""), tree: sanitizeTree(r.tree) };
  },
};
