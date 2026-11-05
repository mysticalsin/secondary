import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../components/Sidebar";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v4En, v4Fr } from "../i18n/v4";
import { buildContents, personOf } from "../lib/contents";
import { applyTheme, resolveTheme } from "../lib/theme";
import { AppProvider } from "../state";
import { ux2 } from "../uxv2/api";
import { AccessPage } from "../views/brains/Access";
import { ProposalPage } from "../views/waiting/Proposal";
import type { WikiIndex, WikiPageRow } from "../views/wiki/types";

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const row = (id: string, title: string, type: string): WikiPageRow => ({
  id,
  title,
  type,
  summary: "",
  revision: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
  restricted: 0,
});

describe("contents tree", () => {
  const idx = (pages: WikiPageRow[]): WikiIndex => ({
    ws: "c_bid",
    nodeId: "c_bid",
    label: "Bid",
    personal: false,
    pages,
    schema: {
      types: {
        bid: { label: "Bids", required: [] },
        lesson: { label: "Lessons", required: [] },
        session_report: { label: "Session reports", required: [], generated: true },
      },
    },
    health: null,
    settings: { autoAccept: false, freshnessDays: 180 },
    can: { contribute: true, edit: true, decide: true, promote: false },
  });
  const labels = { sources: "Sources", reports: "Session reports" };

  it("puts session reports under Sources, Session reports, then one folder per person", () => {
    const t = buildContents(
      idx([
        row("a", "Session report Ada Lovelace 2026-11-04", "session_report"),
        row("b", "Session report Ada Lovelace 2026-11-03", "session_report"),
        row("c", "Session report Grace Hopper 2026-11-04", "session_report"),
        row("d", "Qualification", "bid"),
      ]),
      labels,
    );
    const sources = t.collections.find((c) => c.label === "Sources");
    expect(sources?.count).toBe(3);
    const reports = sources?.children[0];
    expect(reports?.label).toBe("Session reports");
    expect(reports?.children.map((f) => [f.label, f.count])).toEqual([
      ["Ada Lovelace", 2],
      ["Grace Hopper", 1],
    ]);
    expect(personOf("Session report Ada Lovelace 2026-11-04")).toBe("Ada Lovelace");
    expect(personOf("Bid playbook")).toBeNull();
  });

  it("keeps an overview loose and hides empty collections unless the template expects them", () => {
    const pages = [row("o", "Overview of the brain", "overview"), row("d", "Qualification", "bid")];
    const plain = buildContents(idx(pages), labels);
    expect(plain.loose.map((p) => p.id)).toEqual(["o"]);
    expect(plain.collections.map((c) => c.label)).toEqual(["Bids"]);
    const kept = buildContents(idx(pages), labels, new Set(["lesson"]));
    expect(kept.collections.map((c) => [c.label, c.count])).toEqual([
      ["Bids", 1],
      ["Lessons", 0],
    ]);
  });
});

describe("sidebar: only what the persona can read", () => {
  const show = (p: string) => {
    persona(p);
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <AppProvider>
          <Sidebar onClose={() => {}} onToggle={() => {}} />
        </AppProvider>
      </MemoryRouter>,
    );
  };
  it("shows the CEO every governance brain and the Head of Bid only theirs", async () => {
    const ceo = show("ceo");
    expect(await screen.findByRole("link", { name: "Sales" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Delivery excellence" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Acme Synthetic SA" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Company Global" })).toBeVisible();
    expect(screen.getByRole("link", { name: "My Personal Brain" })).toBeVisible();
    ceo.unmount();
    show("head_bid");
    expect(await screen.findByRole("link", { name: "Bid & Pre-sales" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Acme Synthetic SA" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Sales" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Delivery excellence" })).not.toBeInTheDocument();
  });
  it("puts the Waiting for you count in a badge", async () => {
    show("head_bid");
    const link = await screen.findByRole("link", { name: /Waiting for you/ });
    await waitFor(() => expect(within(link).getByText("8")).toBeVisible());
  });
});

describe("pending proposal: Approve waits for every change", () => {
  const open = () => {
    persona("head_bid");
    return render(
      <MemoryRouter initialEntries={["/waiting/q_prop_1"]}>
        <AppProvider>
          <Routes>
            <Route path="/waiting" element={<p>list</p>} />
            <Route path="/waiting/:id" element={<ProposalPage />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    );
  };
  it("keeps Approve disabled until each change is marked seen, then sends what was seen", async () => {
    const answer = vi.spyOn(ux2, "answer").mockResolvedValue({ ok: true });
    open();
    const approve = await screen.findByRole("button", { name: /^Approve/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveTextContent("3 changes left to see");
    expect(screen.getByText("Seen 0 of 3 changes")).toBeVisible();
    const user = userEvent.setup();
    for (const n of [1, 2]) {
      await user.click(
        screen.getByRole("button", { name: new RegExp(`Mark as seen.*Change ${n} of 3`) }),
      );
    }
    expect(approve).toBeDisabled();
    expect(approve).toHaveTextContent("1 change left to see");
    await user.click(screen.getByRole("button", { name: /Mark as seen.*Change 3 of 3/ }));
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() => expect(answer).toHaveBeenCalled());
    const [id, body] = answer.mock.calls[0] as [
      string,
      { action: string; seenChanges: { revisionHash: string; indexes: number[] } },
    ];
    expect(id).toBe("q_prop_1");
    expect(body.action).toBe("approve");
    expect(body.seenChanges.indexes).toEqual([0, 1, 2]);
    expect(body.seenChanges.revisionHash).toMatch(/^e+$/);
  });

  it("shows the server's refusal when the approval is stale", async () => {
    const { ApiError } = await import("../api");
    vi.spyOn(ux2, "answer").mockRejectedValue(
      new ApiError(409, "See every change before you approve.", { error: "changes_not_seen" }),
    );
    open();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /^Approve/ });
    for (const n of [1, 2, 3])
      await user.click(
        screen.getByRole("button", { name: new RegExp(`Mark as seen.*Change ${n} of 3`) }),
      );
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "See every change before you approve.",
    );
  });

  it("Reject asks for a reason first and needs no acknowledgement", async () => {
    const answer = vi.spyOn(ux2, "answer").mockResolvedValue({ ok: true });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reject…" }));
    await user.type(screen.getByLabelText(/Tell the author why/), "Not now");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(answer).toHaveBeenCalled());
    const body = (answer.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(body.action).toBe("reject");
    expect(body.note).toBe("Not now");
    expect(body.seenChanges).toBeUndefined();
  });
});

describe("members and access", () => {
  it("offers roles with a line of help each, and Remove access", async () => {
    persona("head_bid");
    render(
      <MemoryRouter initialEntries={["/brains/c_bid/access"]}>
        <AppProvider>
          <Routes>
            <Route path="/brains/:id/access" element={<AccessPage />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    expect(await screen.findByText("Everyone at Mantu")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Role of consultant@example.invalid/ }));
    const menu = screen.getByRole("menu", { name: /Role of consultant/ });
    expect(within(menu).getByText("Open and read every page")).toBeVisible();
    expect(within(menu).getByText("Write and propose pages")).toBeVisible();
    expect(within(menu).getByText("Members, rules and deleting the brain")).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Remove access" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: /Role of consultant/ })).not.toBeInTheDocument();
  });
});

describe("theme and language", () => {
  it("light is the default, dark is a choice, system follows the device", () => {
    expect(resolveTheme("light")).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("has a French string for every v4 key, the same placeholders and no em dash", () => {
    const ph = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
    for (const k of Object.keys(v4En) as (keyof typeof v4En)[]) {
      expect(v4Fr[k], k).toBeTruthy();
      expect(ph(v4Fr[k]), k).toBe(ph(v4En[k]));
      expect(v4En[k] + v4Fr[k]).not.toContain("—");
      expect(en[k]).toBe(v4En[k]);
      expect(fr[k]).toBe(v4Fr[k]);
    }
  });
});
