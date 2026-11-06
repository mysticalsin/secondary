// Resolving data for a card. A card names a brain and a few options; the numbers come from the
// existing endpoints as the current viewer. Requests are cached by key for a short while, so ten
// cards on one brain make one request. Errors are never cached.
import { useCallback, useEffect, useState } from "react";
import { ApiError, getPersona } from "../api";
import { insightsApi } from "../insights/api";
import type { InsightQuery, Insights } from "../insights/types";
import { useApp } from "../state";

const TTL = 20_000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();

export function cached<T>(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
  const full = `${getPersona() ?? "none"}|${key}`;
  const hit = cache.get(full);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
  const p = load();
  cache.set(full, { at: Date.now(), p });
  p.catch(() => {
    if (cache.get(full)?.p === p) cache.delete(full);
  });
  return p;
}

export const clearResolveCache = (): void => cache.clear();

/** One request for every card of a brain: options that match the defaults are left out of the key. */
export function insightsOf(brain: string, o: InsightQuery = {}): Promise<Insights> {
  const opts: InsightQuery = {};
  if (o.q) opts.q = o.q;
  if (o.mode && o.mode !== "relevance") opts.mode = o.mode;
  if (o.window && o.window !== "30d") opts.window = o.window;
  if (o.focus) opts.focus = o.focus;
  return cached(
    `insights|${brain}|${opts.q ?? ""}|${opts.mode ?? ""}|${opts.window ?? ""}|${opts.focus ?? ""}`,
    () => insightsApi.insights(brain, opts),
  );
}

export interface Resolved<T> {
  data: T | null;
  error: string | null;
  status: number | null;
  loading: boolean;
  retry: () => void;
}

export function useResolved<T>(key: string, load: () => Promise<T>): Resolved<T> {
  const { epoch } = useApp();
  const [st, setSt] = useState<{
    data: T | null;
    error: string | null;
    status: number | null;
    loading: boolean;
  }>({
    data: null,
    error: null,
    status: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setSt((s) => (s.data ? s : { ...s, loading: true }));
    load().then(
      (data) => live && setSt({ data, error: null, status: null, loading: false }),
      (e: unknown) =>
        live &&
        setSt({
          data: null,
          error: e instanceof Error ? e.message : "error",
          status: e instanceof ApiError ? e.status : null,
          loading: false,
        }),
    );
    return () => {
      live = false;
    };
  }, [key, epoch, tick]);
  const retry = useCallback(() => {
    clearResolveCache();
    setTick((n) => n + 1);
  }, []);
  return { ...st, retry };
}
