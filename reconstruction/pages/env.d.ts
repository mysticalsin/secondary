/**
 * NEW RECONSTRUCTION for secondary-pages-dev. Not recovered source.
 * PAGES is the bucket the recovered handler reads. Page HTML is not in the source archive.
 */
import type { PageCounter } from "./worker/src/counter.ts";

declare global {
  interface Env {
    PAGES: R2Bucket;
    COUNTER: DurableObjectNamespace<PageCounter>;
    DO_JURISDICTION?: string;
    EVENTS_PER_MIN?: string;
    EVENTS_PER_VISITOR_MIN?: string;
    LOCAL_DEV?: string;
  }
}
export {};
