import { request } from "../../api";
import type { Picked, Saved, SearchResult } from "./types";

const q = encodeURIComponent;

export const searchApi = {
  pages: (text: string, picked: Picked = {}, limit?: number) => {
    const p = new URLSearchParams({ q: text });
    for (const [k, v] of Object.entries(picked)) if (v?.length) p.set(k, v.join(","));
    if (limit) p.set("limit", String(limit));
    return request<SearchResult>("GET", `/v1/search/pages?${p}`);
  },
  /** For the palette: a few hits, no facet counts. */
  suggest: (text: string) =>
    request<SearchResult>("GET", `/v1/search/pages?q=${q(text)}&limit=6&facets=0`),
  saved: () => request<{ saved: Saved[] }>("GET", "/v1/search/saved"),
  save: (name: string, text: string) =>
    request<{ saved: Saved[] }>("POST", "/v1/search/saved", { name, q: text }),
  remove: (id: string) => request<{ ok: boolean }>("DELETE", `/v1/search/saved/${q(id)}`),
};
