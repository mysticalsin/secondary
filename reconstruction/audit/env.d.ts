/**
 * NEW RECONSTRUCTION for secondary-audit-dev. Not recovered source.
 * Names are the env reads in that Worker's recovered files. No secret values.
 */
declare global {
  interface Env {
    AUDIT_LOG: R2Bucket;
    AUDIT_KEY_API?: string;
    AUDIT_KEY_MCP?: string;
    AUDIT_KEY_READ?: string;
    AUDIT_KEY_ERASE?: string;
  }
}
export {};
