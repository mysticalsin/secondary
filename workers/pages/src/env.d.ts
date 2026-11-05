// Values that are not in wrangler.jsonc, so `wrangler types` cannot see them.
interface Env {
  /** Tests only: "yes" lets DO_JURISDICTION=off skip the EU pinning. Never set in a deployed config. */
  LOCAL_DEV?: string;
}
