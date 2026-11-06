import { useApp } from "../state";
import { useApi } from "../useApi";
import { v3 } from "../views/brains/api";

/**
 * What Settings may show of the Operate pages. Sources need the configure grant. Health is for admins and
 * for people who manage a shared brain (stewards). The API re-checks every call; this only hides links.
 * `known` is false until the nav has loaded, so a route waits instead of redirecting.
 */
export function useOpsRights(): { sources: boolean; health: boolean; known: boolean } {
  const { me } = useApp();
  const nav = useApi(() => v3.nav(), []);
  const configure = !!me?.capabilities?.configure;
  const steward = (nav.data?.items ?? [])
    .flatMap((i) => (i.children?.length ? i.children : [i]))
    .some((b) => b.type !== "personal" && b.manages);
  return {
    sources: configure,
    health: configure || steward,
    known: !!me && (configure || !nav.loading),
  };
}
