import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { AppProvider } from "../state";
import { adm } from "../views/admin/api";
import { Admin } from "../views/admin/Console";

const caps = {
  principalId: "u_x",
  configure: true,
  steward: false,
  auditor: false,
  elevation: null,
};
const view = (tab: string) =>
  render(
    <MemoryRouter initialEntries={[`/admin?tab=${tab}`]}>
      <AppProvider>
        <Admin />
      </AppProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe("Admin console", () => {
  it("shows the six tabs", async () => {
    vi.spyOn(adm, "caps").mockResolvedValue(caps);
    vi.spyOn(adm, "roles").mockResolvedValue([]);
    vi.spyOn(adm, "changes").mockResolvedValue([]);
    view("roles");
    for (const n of ["Roles", "Memberships", "Requests", "Elevations", "NDA grants", "Audit"])
      expect(screen.getByRole("tab", { name: n })).toBeInTheDocument();
  });

  it("shows the server's reason when a tab is denied", async () => {
    vi.spyOn(adm, "caps").mockResolvedValue({ ...caps, configure: false });
    vi.spyOn(adm, "roles").mockRejectedValue(
      new ApiError(403, "Configuration needs the Platform admin"),
    );
    vi.spyOn(adm, "changes").mockResolvedValue([]);
    view("roles");
    expect(await screen.findByText("Configuration needs the Platform admin")).toBeInTheDocument();
  });

  it("offers approve only where the server allows it, and shows its refusal", async () => {
    vi.spyOn(adm, "caps").mockResolvedValue(caps);
    vi.spyOn(adm, "roles").mockResolvedValue([]);
    const base = {
      kind: "role_upsert" as const,
      status: "pending" as const,
      title: "Role edit",
      payload: { role: { label: "CEO" } },
      scopeKey: "role:ceo",
      needsSecond: true,
      proposedBy: "u_platform_admin",
      proposedByEmail: "a@example.invalid",
      proposedAt: 1,
      expiresAt: 2,
      decidedBy: null,
      decidedAt: null,
      note: null,
      targetEmail: null,
      canWithdraw: false,
    };
    vi.spyOn(adm, "changes").mockResolvedValue([
      { ...base, id: "chg_1", canDecide: true },
      { ...base, id: "chg_2", canDecide: false },
    ]);
    vi.spyOn(adm, "approveChange").mockRejectedValue(
      new ApiError(
        403,
        "Two-person rule: you proposed this change, so someone else must decide it",
      ),
    );
    view("roles");
    const approve = await screen.findAllByRole("button", { name: "Approve" });
    expect(approve).toHaveLength(1);
    expect(screen.getByText(/you cannot decide your own proposal/i)).toBeInTheDocument();
    await userEvent.setup().click(approve[0] as HTMLElement);
    await waitFor(() => expect(screen.getByText(/Two-person rule/)).toBeInTheDocument());
  });

  it("sends an elevation request with hours and reason", async () => {
    vi.spyOn(adm, "caps").mockResolvedValue(caps);
    vi.spyOn(adm, "elevation").mockResolvedValue({
      eligible: { roleId: "ceo", actions: ["edit"], maxHours: 4, needsApproval: false },
      active: null,
      pending: null,
    });
    vi.spyOn(adm, "elevations").mockResolvedValue([]);
    const spy = vi.spyOn(adm, "requestElevation").mockResolvedValue({});
    view("elevations");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Reason"), "Incident review");
    await user.click(screen.getByRole("button", { name: "Elevate now" }));
    expect(spy).toHaveBeenCalledWith({ hours: 2, reason: "Incident review" });
  });
});
