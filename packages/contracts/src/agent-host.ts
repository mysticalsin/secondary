// Which host app an OAuth client is, from its registered redirect URIs and its name. Shared by the MCP
// worker (which labels each call) and its tests. A label for the connections list, never a permission.

export type HostId =
  | "claude_code"
  | "claude_ai"
  | "chatgpt"
  | "codex"
  | "dust"
  | "copilot_studio"
  | "other";

/** Which host an OAuth client is, from its registered redirect URIs and name. A hint, never a grant. */
export function hostOf(redirectUris: readonly string[], name: string): HostId {
  const hosts = redirectUris.flatMap((u) => {
    try {
      return [new URL(u).hostname.toLowerCase()];
    } catch {
      return [];
    }
  });
  const n = name.toLowerCase();
  if (hosts.some((h) => h === "claude.ai" || h === "claude.com")) return "claude_ai";
  if (hosts.some((h) => h.endsWith("chatgpt.com") || h.endsWith("openai.com"))) return "chatgpt";
  if (hosts.some((h) => h.endsWith("dust.tt"))) return "dust";
  if (
    hosts.some(
      (h) =>
        h.endsWith("microsoft.com") || h.endsWith("powerplatform.com") || h.includes("copilot"),
    )
  )
    return "copilot_studio";
  if (n.includes("codex")) return "codex";
  if (n.includes("claude code") || n.includes("claude-code")) return "claude_code";
  if (hosts.some((h) => h === "localhost" || h === "127.0.0.1"))
    return n.includes("claude") ? "claude_code" : "codex";
  return "other";
}
