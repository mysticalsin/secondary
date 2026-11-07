export function browserAudience(env: { AUTH_BROWSER_AUD?: string; AUTH_AUDIENCE?: string }): string;
export function verifyReleaseJwt(
  token: string,
  env: {
    AUTH_JWKS_URL?: string;
    LOCAL_JWKS?: string;
    AUTH_ISSUER?: string;
    AUTH_BROWSER_AUD?: string;
    AUTH_AUDIENCE?: string;
    AUTH_ALLOW_LOOPBACK_JWKS?: string;
  },
  now?: Date,
): Promise<{ ok: true; email: string; sub: string } | { ok: false; reason: string }>;
