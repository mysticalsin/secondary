/**
 * NEW RECONSTRUCTION test harness. Not the original shell and not a recovered route.
 * Presets are synthetic. A query string cannot change tenant, persona, or permission.
 */
import { readContext, ViewBoundary } from "./boundary.ts";

export const HARNESS_BANNER = "NEW reconstruction harness. Not the original shell.";

const boundary = new ViewBoundary();

const presets = {
  company: {
    environment: "dev",
    tenantId: "tenant_reconstruction",
    principalId: "u_consultant",
    sessionTenantId: "tenant_reconstruction",
    scope: "company",
    persona: "consultant",
    admittedNodeIds: ["a_acme"],
    plan: {
      version: 1,
      title: "Account overview",
      components: [
        { type: "AccountSummary", props: { accountId: "a_acme" } },
        { type: "KpiRow", props: { nodeId: "a_acme", metrics: ["items", "open"] } },
      ],
    },
  },
  personal: {
    environment: "dev",
    tenantId: "tenant_reconstruction",
    principalId: "u_consultant",
    sessionTenantId: "tenant_reconstruction",
    scope: "personal",
    persona: "consultant",
    admittedNodeIds: ["p_self"],
    plan: {
      version: 1,
      title: "My Secondary",
      components: [{ type: "Callout", props: { template: "personal_private", tone: "info", nodeId: "p_self" } }],
    },
  },
  mismatch: {
    environment: "dev",
    tenantId: "tenant_other",
    principalId: "u_consultant",
    sessionTenantId: "tenant_reconstruction",
    scope: "company",
    persona: null,
    admittedNodeIds: ["a_acme"],
    plan: {
      version: 1,
      title: "Account overview",
      components: [{ type: "NodeCard", props: { nodeId: "a_acme" } }],
    },
  },
} as const;

export function harnessResponse(presetName: string): { status: number; html: string } {
  const preset = presets[presetName as keyof typeof presets];
  if (!preset) return { status: 404, html: "This view is not available." };
  const result = boundary.show(readContext(preset) ?? preset, preset.plan);
  return { status: result.ok ? 200 : 403, html: result.html };
}

export function harnessIgnoresQuery(presetName: string, search: URLSearchParams): { status: number; html: string } {
  const preset = presets[presetName as keyof typeof presets];
  if (!preset) return { status: 404, html: "This view is not available." };
  const forged = {
    ...preset,
    header: { "X-Demo-Persona": search.get("persona") ?? "ceo" },
    query: { tenantId: search.get("tenant") ?? "tenant_other" },
  };
  const result = boundary.show(forged, preset.plan);
  return { status: result.ok ? 200 : 403, html: result.html };
}
