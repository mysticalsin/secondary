import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { Drawer } from "../components/Drawer";
import { AppProvider, useApp } from "../state";
import type { NodeDetail } from "../types";
import { adm } from "../views/admin/api";

afterEach(() => vi.restoreAllMocks());

const locked: NodeDetail = {
  node: {
    id: "d_finance",
    label: "Finance",
    kind: "department",
    plane: "TEAM_RESTRICTED",
    access: "locked",
    counts: null,
    freshnessDays: null,
    signals: { open: false, star: false, gap: false },
    facts: {},
    badges: ["Locked"],
  },
  items: [],
  backlinks: [],
  actions: [
    {
      action: "request_access",
      label: "Request access",
      group: "Collaborate",
      allowed: true,
      reason: "Sends a request to the steward",
    },
  ],
};

function Open() {
  const { openNode } = useApp();
  return (
    <button type="button" onClick={() => openNode("d_finance")}>
      open
    </button>
  );
}

describe("drawer: request access", () => {
  it("posts to the governance access-request API with a reason, not to /v1/actions", async () => {
    vi.spyOn(api, "node").mockResolvedValue(locked);
    const act = vi.spyOn(api, "act");
    const send = vi.spyOn(adm, "requestAccess").mockResolvedValue({});
    render(
      <MemoryRouter>
        <AppProvider>
          <Open />
          <Drawer />
        </AppProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByRole("button", { name: "Request access" }));
    const submit = await screen.findByRole("button", { name: "Send request" });
    // A reason is required: the steward reads it.
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why do you need it/), "Quarter close support");
    await userEvent.click(submit);
    expect(send).toHaveBeenCalledWith("d_finance", "Quarter close support");
    expect(act).not.toHaveBeenCalled();
    expect(await screen.findByText("Request sent to the steward queue.")).toBeInTheDocument();
  });
});
