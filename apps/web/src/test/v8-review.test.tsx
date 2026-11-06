import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../state";
import { ux2 } from "../uxv2/api";
import { Desk } from "../views/review-desk/Desk";

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("secondary.lang", "en");
  vi.restoreAllMocks();
});

const open = (path = "/review") => {
  persona("head_bid");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Routes>
          <Route path="/review/:id?" element={<Desk />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
};
const rows = () => screen.getAllByTestId("rv-row");
const current = () => rows().find((r) => r.getAttribute("aria-current") === "true");

describe("Review desk", () => {
  it("shows the sections, the dark strip with its KPIs and an overdue badge", async () => {
    open();
    const queue = await screen.findByRole("navigation", { name: "Review queue" });
    for (const h of ["Your decision", "Contradictions", "Mentions", "Snoozed", "FYI"])
      expect(within(queue).getByRole("heading", { name: new RegExp(h) })).toBeVisible();
    expect(within(queue).getAllByText(/Overdue/).length).toBeGreaterThan(0);
    const strip = screen.getByTestId("rv-strip");
    expect(within(strip).getByTestId("rv-kpi-waiting")).toHaveTextContent("Waiting");
    expect(within(strip).getByTestId("rv-kpi-median")).toHaveTextContent("Median time to decision");
    expect(within(strip).getByTestId("rv-kpi-overdue")).toHaveTextContent("Overdue");
    expect(within(strip).getByTestId("rv-kpi-cleared")).toHaveTextContent("Cleared this week");
    // The top row is the highest priority: the overdue change with risk flags.
    expect(rows()[0]).toHaveTextContent("Pricing guide: payment terms");
    expect(rows()[0]).toHaveTextContent("Personal data");
    expect(rows()[0]).toHaveTextContent("~1 min");
  });

  it("has a table twin for the strip", async () => {
    open();
    const user = userEvent.setup();
    const strip = await screen.findByTestId("rv-strip");
    await user.click(within(strip).getByRole("button", { name: "Show as table" }));
    expect(within(strip).getByRole("table")).toBeVisible();
    expect(within(strip).getAllByRole("row")).toHaveLength(15);
  });

  it("J and K move the selection, ? opens the shortcut list", async () => {
    open();
    await screen.findByRole("navigation", { name: "Review queue" });
    const user = userEvent.setup();
    const first = current();
    expect(first).toBe(rows()[0]);
    await user.keyboard("j");
    await waitFor(() => expect(current()).toBe(rows()[1]));
    await user.keyboard("k");
    await waitFor(() => expect(current()).toBe(rows()[0]));
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps Approve off until every change is seen, and A sends what was seen", async () => {
    const answer = vi.spyOn(ux2, "answer").mockResolvedValue({ ok: true });
    open("/review/q_prop_1");
    const approve = await screen.findByTestId("rv-approve");
    expect(approve).toBeDisabled();
    expect(approve).toHaveTextContent("3 changes left to see");
    const user = userEvent.setup();
    await user.keyboard("a");
    expect(answer).not.toHaveBeenCalled();
    for (const n of [1, 2, 3])
      await user.click(
        screen.getByRole("button", { name: new RegExp(`Mark as seen.*Change ${n} of 3`) }),
      );
    expect(approve).toBeEnabled();
    await user.keyboard("a");
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]?.[1]).toMatchObject({
      action: "approve",
      revisionHash: "e".repeat(64),
      seenChanges: { revisionHash: "e".repeat(64), indexes: [0, 1, 2] },
    });
  });

  it("warns before a comment with personal data and posts when confirmed", async () => {
    open("/review/q_prop_2");
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Add a comment");
    await user.type(box, "Call her on +1 514 555 0199 first");
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    const warn = await screen.findByRole("alert");
    expect(warn).toHaveTextContent("personal data");
    expect(warn).toHaveTextContent("a phone number");
    const thread = screen.getByTestId("rv-thread");
    expect(within(thread).queryByRole("list")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send anyway" }));
    expect(await within(thread).findByRole("list")).toHaveTextContent("555 0199");
  });

  it("reassigns only to someone the list offers", async () => {
    open("/review/q_prop_2");
    const user = userEvent.setup();
    await screen.findByTestId("rv-decide");
    await user.click(screen.getByRole("button", { name: "Reassign" }));
    const dlg = await screen.findByRole("dialog", { name: "Reassign this review" });
    // The list comes with the row's detail, which loads after the row: wait for it.
    const options = (await within(dlg).findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Chief Executive", "Head of Bid", "Knowledge Reviewer"]);
  });
});
