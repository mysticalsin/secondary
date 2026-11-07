export function canonicalPath(pathname: string): string;
export function releaseDecision(
  pathname: string,
  mode: string | undefined,
):
  | { kind: "closed"; status: number; reason: string }
  | { kind: "deny"; status: number; reason: string }
  | { kind: "mcp"; auth: string }
  | { kind: "browser"; auth: string }
  | { kind: "asset"; auth: string };
export const DEV_IDENTITY_HEADERS: string[];
