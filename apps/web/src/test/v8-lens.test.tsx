import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHostProvider } from "../agent/host";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v8LensEn, v8LensFr } from "../i18n/v8lens";
import { fold, rank, score } from "../palette/match";
import { OPEN_PALETTE, Palette } from "../palette/Palette";
import { clearRecents, pushRecent, readRecents } from "../palette/recents";
import { AppProvider } from "../state";
import { clip, H, layoutGraph, W } from "../views/lens/graph";
import { PeopleList } from "../views/lens/PeopleList";
import { roleFill } from "../views/lens/roles";
import type { GraphNode, PersonRow } from "../views/lens/types";
import { daysBetween } from "../views/pulse/colors";

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("i18n", () => {
  it("fr defines every v8 key of en and none is empty", () => {
    expect(Object.keys(v8LensFr).sort()).toEqual(Object.keys(v8LensEn).sort());
    for (const k of Object.keys(v8LensEn)) {
      expect((fr as Record<string, string>)[k], k).toBeTruthy();
      expect((en as Record<string, string>)[k], k).toBeTruthy();
    }
  });
  it("writes no em dash", () => {
    for (const v of [...Object.values(v8LensEn), ...Object.values(v8LensFr)])
      expect(v).not.toContain("—");
  });
});

describe("palette matching", () => {
  it("ignores accents and case, needs every word, and ranks a start of label first", () => {
    expect(fold("Épingler")).toBe("epingler");
    const items = [
      { label: "Open the review desk", keywords: "waiting approve" },
      { label: "Review settings" },
      { label: "New page" },
    ];
    expect(rank("review", items).map((i) => i.label)).toEqual([
      "Review settings",
      "Open the review desk",
    ]);
    expect(rank("page new", items).map((i) => i.label)).toEqual(["New page"]);
    expect(rank("approve desk", items).map((i) => i.label)).toEqual(["Open the review desk"]);
    expect(score("zzz", items[0] as { label: string })).toBe(0);
    expect(rank("", items).length).toBe(3);
  });
});

describe("palette recents", () => {
  it("keeps six, newest first, per person, and drops a path that is not local", () => {
    for (let i = 0; i < 8; i++) pushRecent("u1", { id: `r${i}`, label: `R${i}`, to: `/x/${i}` });
    const list = readRecents("u1");
    expect(list.length).toBe(6);
    expect(list[0]?.id).toBe("r7");
    expect(readRecents("u2")).toEqual([]);
    window.localStorage.setItem(
      "secondary.palette.recents.u3",
      JSON.stringify([
        { id: "a", label: "A", to: "https://evil.example" },
        { id: "b", label: "B", to: "/ok" },
      ]),
    );
    expect(readRecents("u3").map((r) => r.id)).toEqual(["b"]);
    clearRecents("u1");
    expect(readRecents("u1")).toEqual([]);
  });
  it("survives broken storage", () => {
    window.localStorage.setItem("secondary.palette.recents.u1", "{not json");
    expect(readRecents("u1")).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => pushRecent("u1", { id: "a", label: "A", to: "/a" })).not.toThrow();
  });
});

describe("local graph layout", () => {
  const node = (id: string, hop: 0 | 1 | 2): GraphNode => ({
    key: `b:${id}`,
    brainId: "b",
    brainName: "B",
    id,
    title: id,
    type: "t",
    collection: "T",
    hop,
  });
  it("puts the page in the middle, keeps every node inside the card and is repeatable", () => {
    const nodes = [
      node("c", 0),
      ...["a", "b", "d", "e", "f"].map((i) => node(i, 1)),
      node("x", 2),
      node("y", 2),
    ];
    const edges = [
      { from: "b:c", to: "b:a" },
      { from: "b:c", to: "b:b" },
      { from: "b:a", to: "b:x" },
      { from: "b:b", to: "b:y" },
    ];
    const one = layoutGraph(nodes, edges);
    const two = layoutGraph(nodes, edges);
    expect(one).toEqual(two);
    const c = one.placed.find((p) => p.hop === 0);
    expect(c).toMatchObject({ x: W / 2, y: H / 2 });
    for (const p of one.placed) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(W);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(H);
    }
    expect(one.lines.length).toBe(4);
  });
  it("draws a lone page and clips long titles on a word", () => {
    expect(layoutGraph([node("c", 0)], []).placed.length).toBe(1);
    expect(layoutGraph([], []).placed).toEqual([]);
    expect(clip("Bid qualification checklist", 15)).toBe("Bid qualificat…");
    expect(clip("Gate review checklist now", 20)).toBe("Gate review…");
    expect(clip("Short", 15)).toBe("Short");
  });
});

describe("pulse days", () => {
  it("lists every calendar day, oldest first", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("people list", () => {
  const rows: PersonRow[] = [
    {
      id: "u1",
      name: "Grace Hopper",
      role: "steward",
      brainId: "c_bid",
      brainName: "Bid & Pre-sales",
      contributions: 7,
      pages: 3,
      lastAt: "2026-11-01T00:00:00.000Z",
      score: 5,
    },
    {
      id: "u2",
      name: "Ada Lovelace",
      role: "contributor",
      brainId: "core",
      brainName: "Company Global",
      contributions: 1,
      pages: 1,
      lastAt: "2026-10-01T00:00:00.000Z",
      score: 1,
    },
  ];
  it("names the role and the brain in words, and the avatar is decorative", () => {
    render(
      <MemoryRouter>
        <AppProvider>
          <PeopleList people={rows} label="Who knows" />
        </AppProvider>
      </MemoryRouter>,
    );
    const list = screen.getByRole("list", { name: "Who knows" });
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    expect(first).toHaveTextContent("Grace Hopper");
    expect(first).toHaveTextContent("Steward");
    expect(first).toHaveTextContent("Bid & Pre-sales");
    expect(first).toHaveTextContent("7 approved changes");
    expect(first.querySelector(".av8")).toHaveAttribute("aria-hidden", "true");
    expect(roleFill("steward")).not.toBe(roleFill("owner"));
    expect(roleFill("nobody")).toBe("#4a4a55");
  });
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function shell(initial = "/") {
  persona("head_bid");
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AppProvider>
        <AgentHostProvider>
          <Palette />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </AgentHostProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe("command palette keyboard", () => {
  it("opens with Ctrl+K and with the event, is a labelled combobox, and Escape closes it", async () => {
    shell();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dlg = await screen.findByRole("dialog", { name: "Search and commands" });
    const input = within(dlg).getByRole("combobox", { name: /Search pages, brains and commands/ });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", "pal-list");
    expect(within(dlg).getByRole("listbox")).toHaveAttribute("id", "pal-list");
    expect(dlg).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    window.dispatchEvent(new Event(OPEN_PALETTE));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("moves with the arrows, wraps, keeps aria-activedescendant on the selected option", async () => {
    shell();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");
    const options = () => within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]?.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options()[1]?.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const n = options().length;
    expect(options()[n - 1]).toHaveAttribute("aria-selected", "true");
    // exactly one option is selected at any time
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true").length).toBe(1);
  });

  it("filters commands as you type, announces the count, and runs the selected one with Enter", async () => {
    shell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    const user = userEvent.setup();
    await user.type(input, "all brains");
    const list = screen.getByRole("listbox");
    await waitFor(() =>
      expect(within(list).getByRole("option", { name: /All brains/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/\d+ results?/);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/brains"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // and it is a recent item the next time
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("dialog");
    // Recents hold items that carry a path (brains, pages, settings), not plain commands.
  });

  it("> shows commands only, and Alt+Enter runs the full search", async () => {
    shell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    const user = userEvent.setup();
    await user.type(input, ">review");
    const opts = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Open the review desk"),
    ]);
    await user.clear(input);
    await user.type(input, "type:method pricing");
    fireEvent.keyDown(input, { key: "Enter", altKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/search?q=type%3Amethod%20pricing"),
    );
  });

  it("finds a page for a role that may read it, and nothing from a brain it may not", async () => {
    shell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    const user = userEvent.setup();
    await user.type(input, "pricing guide");
    expect(
      await within(screen.getByRole("listbox")).findByRole("option", { name: /Pricing guide/ }),
    ).toBeVisible();
  });

  it("French labels", async () => {
    window.localStorage.setItem("secondary.lang", "fr");
    shell();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Recherche et commandes" })).toBeVisible();
  });
});
