/**
 * NEW RECONSTRUCTION for secondary-ops-dev. Not recovered source.
 * No secret values. BACKUPS and API are the bindings the recovered routes call.
 */
declare global {
  interface Env {
    BACKUPS: R2Bucket;
    API: Fetcher;
    ENVIRONMENT: string;
    ACCESS_AUD?: string;
    ACCESS_TEAM_DOMAIN?: string;
    BACKUP_KEY?: string;
    BACKUP_KEY_PREVIOUS?: string;
    BACKUP_RETENTION_DAYS?: string;
    OPS_ADMIN_KEY?: string;
    OPS_HMAC_KEY?: string;
    OPS_HMAC_KID?: string;
    RESTORE_ENABLED?: string;
  }
}
export {};
