export function tokenFromRequest(request: Request): { ok: true; token: string } | { ok: false; reason: string };
export function verifyRemoteJwt(
  token: string,
  env: unknown,
  audience: string,
  fetchImpl?: typeof fetch,
  now?: number,
): Promise<{ ok: true; email: string; sub: string } | { ok: false; reason: string }>;
export function admittedTenant(email: string, mapJson?: string): string | null;
export function resetJwksCache(): void;
export function boundedMaxAge(header: string | null): number;
export function resolveJwksTarget(env: {
  AUTH_ISSUER?: string;
  AUTH_JWKS_URL?: string;
  AUTH_ALLOW_LOOPBACK_JWKS?: string;
}): { issuer: string; url: string };
export const PRODUCTION_ISSUER: string;
export const PRODUCTION_JWKS_URL: string;
