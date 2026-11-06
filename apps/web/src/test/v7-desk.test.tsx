import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { resetRulesMock } from "../mock/rules";
import { AppProvider } from "../state";
import { Desk } from "../views/review-desk/Desk";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("secondary.lang", "en");
  resetRulesMock();
});

const open = (persona: string) => {
  window.localStorage.setItem("secondary.persona", persona);
  return render(
    <MemoryRouter initialEntries={["/review"]}>
      <AppProvider>
        <Routes>
          <Route path="/review/:id?" element={<Desk />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
};

describe("rule items in the Review desk", () => {
  it("a steward sees the held action they may decide (not their own) and approves it", async () => {
    const user = userEvent.setup();
    open("head_bid");
    const items = await screen.findByTestId("rv-rule-items");
    // h_1 was asked by someone else; h_2 is this person's own and is never offered to them.
    expect(items.querySelectorAll("[data-hold]")).toHaveLength(1);
    expect(items.querySelector('[data-hold="h_1"]')).not.toBeNull();
    const queue = screen.getByRole("navigation", { name: "Review queue" });
    expect(within(queue).getByRole("heading", { name: /Your decision/ })).toBeVisible();
    await user.click(within(items).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByTestId("rv-rule-items")).toBeNull());
  });

  it("a person who cannot decide any rule item sees none", async () => {
    open("consultant");
    await screen.findByRole("navigation", { name: "Review queue" });
    await waitFor(() => expect(screen.queryByTestId("rv-rule-items")).toBeNull());
  });
});

describe("palette review path", () => {
  it("points at the desk route", async () => {
    const { REVIEW_PATH } = await import("../palette");
    expect(REVIEW_PATH).toBe("/review");
  });
});
