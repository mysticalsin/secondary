import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { resetGroupMock } from "../mock/v7group";
import { AppProvider } from "../state";
import { PrivacyGroup } from "../views/settings/PrivacyGroup";
import { Settings } from "../views/settings/Settings";

beforeEach(() => {
  window.localStorage.clear();
  resetGroupMock();
});

const mount = (ui: JSX.Element, persona: string, path = "/") => {
  window.localStorage.setItem("secondary.persona", persona);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>{ui}</AppProvider>
    </MemoryRouter>,
  );
};

describe("privacy approver group in Settings", () => {
  it("an admin sees the empty group, adds a person from the directory and removes them", {
    timeout: 20_000,
  }, async () => {
    const user = userEvent.setup();
    mount(<PrivacyGroup />, "platform_admin");
    await screen.findByText(/Nobody is named yet/);
    const select = screen.getByLabelText("Add a person");
    await user.selectOptions(select, within(select).getAllByRole("option")[1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Add" }));
    // Two-person: the first request waits for a second admin, who makes the same change.
    expect(await screen.findByText(/Waiting for a second Platform admin/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));
    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await user.click(within(list).getByRole("button", { name: /Remove/ }));
    await screen.findByText(/Waiting for a second Platform admin/);
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Remove/ }));
    await screen.findByText(/Nobody is named yet/);
  });

  it("shows the tab to admins only, and a non-admin who opens the route is sent away", async () => {
    mount(<Settings />, "platform_admin", "/settings/profile");
    expect(await screen.findByRole("link", { name: "Privacy group" })).toBeInTheDocument();
  });

  it("a person without the configure grant has no tab", async () => {
    mount(<Settings />, "consultant", "/settings/profile");
    await screen.findByRole("link", { name: "Profile" });
    expect(screen.queryByRole("link", { name: "Privacy group" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Privacy approver group")).not.toBeInTheDocument(),
    );
  });
});
