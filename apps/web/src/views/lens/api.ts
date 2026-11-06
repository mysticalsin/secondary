import { request } from "../../api";
import type { LensData, WhoKnows } from "./types";

const q = encodeURIComponent;

export const lensApi = {
  lens: (brain: string, page: string) =>
    request<LensData>("GET", `/v1/brains/${q(brain)}/pages/${q(page)}/lens`),
  whoKnows: (brain: string, by: { page?: string; collection?: string }, limit = 5) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (by.page) p.set("page", by.page);
    if (by.collection) p.set("collection", by.collection);
    return request<WhoKnows>("GET", `/v1/brains/${q(brain)}/who-knows?${p}`);
  },
  whoKnowsAbout: (text: string, brain?: string, limit = 5) => {
    const p = new URLSearchParams({ q: text, limit: String(limit) });
    if (brain) p.set("brain", brain);
    return request<WhoKnows>("GET", `/v1/who-knows?${p}`);
  },
  listing: () => request<{ listed: boolean }>("GET", "/v1/me/expert-listing"),
  setListing: (listed: boolean) =>
    request<{ listed: boolean }>("PUT", "/v1/me/expert-listing", { listed }),
};
