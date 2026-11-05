// Dev-only demo personas (role ids from packages/policy). Shown only when the API reports env=dev.
export const PERSONAS: { id: string; label: string }[] = [
  { id: "ceo", label: "CEO" },
  { id: "head_bid", label: "Head of Bid & Pre-sales" },
  { id: "acme_lead", label: "Account lead, Acme" },
  { id: "consultant", label: "Consultant, Delivery" },
  { id: "reviewer", label: "Knowledge reviewer" },
  { id: "platform_admin", label: "Platform admin" },
  { id: "auditor", label: "Auditor" },
];

/**
 * Authors come back as principal ids: u_head_bid for a seeded persona, u_head_bid_<hash> for a dev
 * tester who picked that persona. Show the role label when the id names a persona.
 */
export function whoIs(
  principalId: string,
  label: (roleId: string, fallback: string) => string = (_id, f) => f,
): string {
  const role = principalId.startsWith("u_") ? principalId.slice(2) : principalId;
  const hit = PERSONAS.find((p) => role === p.id || role.startsWith(`${p.id}_`));
  return hit ? label(hit.id, hit.label) : principalId;
}
