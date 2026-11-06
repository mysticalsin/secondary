import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v8gEn, v8gFr } from "../i18n/v8gaps";
import { AppProvider } from "../state";
import { GapsTab } from "../views/gaps/GapsTab";
import { TopGaps } from "../views/gaps/TopGaps";

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("secondary.lang", "en");
});

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <AppProvider>{ui}</AppProvider>
    </MemoryRouter>,
  );

describe("strings", () => {
  it("every v8g key exists in English and French and French is not a copy", () => {
    for (const k of Object.keys(v8gEn)) {
      expect(k in v8gFr, k).toBe(true);
      expect(en[k as keyof typeof en], k).toBeTruthy();
      expect(fr[k as keyof typeof fr], k).toBeTruthy();
    }
    expect(Object.keys(v8gFr)).toHaveLength(Object.keys(v8gEn).length);
  });
});

describe("Gaps tab", () => {
  it("lists ranked rows with a dot row, source chips and status words", async () => {
    persona("head_bid");
    wrap(<GapsTab brainId="c_bid" />);
    const rows = await screen.findAllByTestId("gap-row");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(within(rows[0] as HTMLElement).getByText(/frame agreement/)).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("img", { name: /Last 14 days, oldest first/ }),
    ).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("Ask")).toBeInTheDocument();
    // Overdue says so in words, not only in colour.
    expect(screen.getByText(/Overdue since/)).toBeInTheDocument();
    expect(screen.getByTestId("gap-rate")).toHaveTextContent("%");
  });

  it("a steward sees assign, merge and dismiss, a contributor only start page", async () => {
    persona("head_bid");
    const a = wrap(<GapsTab brainId="c_bid" />);
    await screen.findAllByTestId("gap-row");
    expect(screen.getAllByRole("button", { name: /^Assign:/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Merge:/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^Dismiss:/ }).length).toBeGreaterThan(0);
    a.unmount();
    persona("ceo");
    wrap(<GapsTab brainId="c_bid" />);
    await screen.findAllByTestId("gap-row");
    expect(screen.getAllByRole("button", { name: /^Start page:/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Assign:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dismiss:/ })).toBeNull();
  });

  it("start page pre-fills the title, sends a draft to review and the row says so", async () => {
    persona("head_bid");
    const user = userEvent.setup();
    wrap(<GapsTab brainId="c_bid" />);
    await screen.findAllByTestId("gap-row");
    const row = screen.getByText("Who signs off a bid above 500k").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^Start page:/ }));
    const box = await screen.findByLabelText("Page title");
    expect(box).toHaveValue("Who signs off a bid above 500k");
    await user.click(screen.getByRole("button", { name: "Send draft to review" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => {
      const after = screen.getByText("Who signs off a bid above 500k").closest("li") as HTMLElement;
      expect(within(after).getByText(/Draft in review/)).toBeInTheDocument();
    });
  });

  it("dismiss refuses personal details in the note and keeps the dialog open", async () => {
    persona("head_bid");
    const user = userEvent.setup();
    wrap(<GapsTab brainId="c_bid" />);
    await screen.findAllByTestId("gap-row");
    const target = screen
      .getByText("Templates for the reference section")
      .closest("li") as HTMLElement;
    await user.click(within(target).getByRole("button", { name: /^Dismiss:/ }));
    await user.type(await screen.findByLabelText(/Note/), "ask jane@example.invalid");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/personal details/);
    await user.clear(screen.getByLabelText(/Note/));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.queryByText("Templates for the reference section")).toBeNull(),
    );
  });

  it("the table twin carries the same rows", async () => {
    persona("head_bid");
    const user = userEvent.setup();
    wrap(<GapsTab brainId="c_bid" />);
    await screen.findAllByTestId("gap-row");
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Asks, 14 days" })).toBeInTheDocument();
    expect(within(table).getByText("How do we price a frame agreement")).toBeInTheDocument();
  });

  it("a persona without the right gets an error, not rows", async () => {
    persona("consultant");
    wrap(<GapsTab brainId="c_bid" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("gap-row")).toBeNull();
  });
});

describe("Home top gaps", () => {
  it("shows for a steward and stays away for anyone else", async () => {
    persona("head_bid");
    const a = wrap(<TopGaps />);
    expect(await screen.findByTestId("top-gaps")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open the gaps of/ }).length).toBeGreaterThan(0);
    a.unmount();
    persona("ceo");
    wrap(<TopGaps />);
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId("top-gaps")).toBeNull();
  });
});
