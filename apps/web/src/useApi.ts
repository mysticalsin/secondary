import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { useApp } from "./state";

export interface Async<T> {
  data: T | null;
  error: string | null;
  status: number | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch as the current viewer. Refetches on persona change and when deps change. */
export function useApi<T>(fn: () => Promise<T>, deps: DependencyList): Async<T> {
  const { epoch } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let live = true;
    setLoading(true);
    fnRef.current().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setStatus(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!live) return;
        setData(null);
        setError(
          e instanceof ApiError
            ? e.reason
            : e instanceof Error
              ? e.message
              : "Something went wrong.",
        );
        setStatus(e instanceof ApiError ? e.status : null);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [...deps, epoch, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, status, loading, reload };
}
