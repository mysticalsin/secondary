import { useApi } from "../useApi";
import { rulesApi } from "./api";

/**
 * Does this viewer have a Rules surface? The API answers 404 when it does not exist for them, so a
 * failed read means no Rules tab. Null while the answer is on its way, and when `enabled` is false.
 * Kept apart from Rules.tsx so the page itself loads only on first use.
 */
export function useRulesAccess(brain?: string, enabled = true): boolean | null {
  const state = useApi(
    () =>
      enabled
        ? rulesApi.list(brain).then(
            () => true,
            () => false,
          )
        : Promise.resolve(null),
    [brain, enabled],
  );
  if (!enabled) return false;
  return state.data;
}
