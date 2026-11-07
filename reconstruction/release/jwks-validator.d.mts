export function tokenFromRequest(request: Request): { ok: true; token: string } | { ok: false; reason: string };
export function verifyRemoteJwt(
  token: string,
  env: unknown,
  audience: string,
  fetchImpl?: typeof fetch,
  now?: number,
): Promise<{ ok: true; email: string; sub: string } | { ok: false; reason: string }>;
export function admittedTenant(email: string, mapJson?: string): string | null;
