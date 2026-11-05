import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NodeDetailView } from "../components/Drawer";
import type { NodeDetail } from "../types";

const detail: NodeDetail = {
  node: {
    id: "c_bid",
    label: "Bid & Pre-sales",
    kind: "circle",
    plane: "TEAM",
    access: "full",
    counts: { items: 120, topics: 5, open: 2, gaps: 1, stars: 1 },
    freshnessDays: 10,
    signals: { open: true, star: false, gap: false },
    facts: { Status: "approved", Revision: "r3" },
    badges: [],
  },
  items: [
    {
      title: "Pricing models: checklist",
      source: "Wiki page",
      ownerRole: "Steward",
      revision: "r2",
      evidence: "supported",
      plane: "TEAM",
      reviewedBy2: true,
    },
  ],
  backlinks: [{ id: "d_amaris", label: "Amaris", type: "department" }],
  actions: [
    {
      action: "comment",
      label: "Comment",
      group: "Collaborate",
      allowed: true,
      reason: "Granted.",
    },
    {
      action: "edit",
      label: "Edit",
      group: "Collaborate",
      allowed: false,
      reason: "Your role has no edit grant here.",
    },
    {
      action: "approve_release",
      label: "Approve release",
      group: "Govern",
      allowed: false,
      reason: "You contributed this revision.",
    },
    {
      action: "configure",
      label: "Configure",
      group: "Admin",
      allowed: false,
      reason: "Platform admins only.",
    },
  ],
};

describe("Drawer", () => {
  it("renders disabled actions with their reasons inline", () => {
    render(<NodeDetailView detail={detail} onOpen={vi.fn()} onAct={vi.fn()} />);
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit).toBeDisabled();
    expect(screen.getByText("Your role has no edit grant here.")).toBeVisible();
    expect(edit).toHaveAccessibleDescription("Your role has no edit grant here.");
    expect(screen.getByRole("button", { name: "Approve release" })).toBeDisabled();
    expect(screen.getByText("You contributed this revision.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Configure" })).toBeDisabled();
  });

  it("enables allowed actions and calls back", async () => {
    const onAct = vi.fn();
    render(<NodeDetailView detail={detail} onOpen={vi.fn()} onAct={onAct} />);
    const comment = screen.getByRole("button", { name: "Comment" });
    expect(comment).toBeEnabled();
    await userEvent.click(comment);
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ action: "comment" }));
  });

  it("groups actions and disables Open in source and Ask this node", () => {
    render(<NodeDetailView detail={detail} onOpen={vi.fn()} onAct={vi.fn()} />);
    const actions = screen
      .getByRole("heading", { name: "Actions" })
      .closest("section") as HTMLElement;
    for (const g of ["Collaborate", "Govern", "Admin"])
      expect(within(actions).getByText(g)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open in source/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Ask this node/ })).toBeDisabled();
  });

  it("explains a locked node and hides counts", () => {
    const locked: NodeDetail = {
      ...detail,
      node: {
        ...detail.node,
        access: "locked",
        counts: null,
        badges: ["Locked", "NDA"],
        facts: {},
      },
      items: [],
      actions: [
        {
          action: "request_access",
          label: "Request access",
          group: "Collaborate",
          allowed: true,
          reason: "Sends a request.",
        },
      ],
    };
    render(<NodeDetailView detail={locked} onOpen={vi.fn()} onAct={vi.fn()} />);
    expect(screen.getByText(/content and counts stay hidden/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Counts" })).not.toBeInTheDocument();
    expect(screen.getByText("NDA")).toBeInTheDocument();
  });
});
