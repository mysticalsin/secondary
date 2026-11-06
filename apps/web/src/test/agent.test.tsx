// My Agent in jsdom: streaming, the renderer against hostile input, actions, pinning, locked views,
// the AI-off note, the token line, the keyboard and the panel.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentButton, AgentHostProvider, AgentPanelSlot } from "../agent/host";
import PinnedGrid from "../agent/PinnedGrid";
import { AgentRender, LockedCard } from "../agent/Renderer";
import { clearResolveCache } from "../agent/resolve";
import SharedView from "../agent/SharedView";
import { writeSettings } from "../agent/settings";
import * as streamMod from "../agent/stream";
import { Thread } from "../agent/Thread";
import { viewsApi } from "../agent/views";
import * as mockAgent from "../mock/agent";
import { AppProvider } from "../state";

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);
beforeEach(() => {
  // The dev mock paces its lines in real time (70 ms each), so a long answer took about a second on an idle
  // machine and longer under load, past Testing Library's one second default wait. Pace is not under test.
  mockAgent.setMockLinePace(0);
  window.localStorage.clear();
  persona("ceo");
  clearResolveCache();
});
afterEach(() => vi.restoreAllMocks());

function app(ui: React.ReactNode, at = "/") {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AppProvider>
        <AgentHostProvider>{ui}</AgentHostProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

const ask = async (text: string) => {
  const box = await screen.findByRole("textbox", { name: "Ask My Agent" });
  await userEvent.type(box, `${text}{Enter}`);
};

/** A stream the test feeds by hand, line by line. */
function scripted() {
  let h: streamMod.TurnEvents | null = null;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => {
    finish = r;
  });
  const spy = vi.spyOn(streamMod, "streamTurn").mockImplementation(async (_b, _s, handlers) => {
    h = handlers;
    handlers.onMeta?.({ turnId: "t1", mode: "deterministic", reason: "ai_disabled" });
    await done;
  });
  return {
    spy,
    line: (l: string) => act(() => h?.onLine?.(l)),
    reset: () => act(() => h?.onReset?.()),
    end: () =>
      act(() => {
        h?.onUsage?.({ inputTokens: 0, outputTokens: 0, model: null });
        h?.onDone?.({ turnId: "t1", lines: 0 });
        finish();
      }),
  };
}

describe("streaming", () => {
  it("a reset withdraws the lines so far and the next lines start a clean answer", async () => {
    app(<Thread variant="page" />);
    const s = scripted();
    await ask("Show me bid");
    await s.line("root = Stack([c1])");
    await s.line('c1 = InsightCard("Early draft", [f1])');
    await s.line('f1 = Funnel("c_bid", "30d")');
    expect(await screen.findByRole("heading", { name: "Early draft" })).toBeInTheDocument();
    await s.reset();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Early draft" })).toBeNull());
    await s.line("root = Stack([c1])");
    await s.line('c1 = InsightCard("Final answer", [f1])');
    await s.line('f1 = Funnel("c_bid", "7d")');
    expect(await screen.findByRole("heading", { name: "Final answer" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Early draft" })).toBeNull();
    await s.end();
  });

  it("draws cards while the lines arrive, then the rest", async () => {
    app(<Thread variant="page" />);
    const s = scripted();
    await ask("Show me bid");
    await s.line("root = Stack([c1, c2])");
    expect(screen.queryAllByTestId("agent-card")).toHaveLength(0);
    expect(await screen.findByTestId("agent-streaming")).toBeInTheDocument();
    await s.line('c1 = InsightCard("Flow card", [f1])');
    await s.line('f1 = Funnel("c_bid", "30d")');
    const first = await screen.findAllByTestId("agent-card");
    expect(first).toHaveLength(1);
    expect(
      within(first[0] as HTMLElement).getByRole("heading", { name: "Flow card" }),
    ).toBeInTheDocument();
    // The chart itself resolves through the existing endpoint.
    expect(await screen.findByTestId("agent-funnel")).toBeInTheDocument();
    expect(screen.getByTestId("agent-streaming")).toBeInTheDocument();
    await s.line('c2 = InsightCard("Health card", [b1])');
    await s.line('b1 = Beeswarm("c_bid")');
    expect(await screen.findAllByTestId("agent-card")).toHaveLength(2);
    await s.end();
    await waitFor(() => expect(screen.queryByTestId("agent-streaming")).toBeNull());
    expect(await screen.findByTestId("agent-beeswarm")).toBeInTheDocument();
    expect(screen.getByTestId("agent-live")).toHaveTextContent("Your view is ready");
  });

  it("aborts the stream when the thread unmounts", async () => {
    const seen: AbortSignal[] = [];
    vi.spyOn(streamMod, "streamTurn").mockImplementation(async (_b, signal) => {
      seen.push(signal);
      await new Promise(() => {});
    });
    const { unmount } = app(<Thread variant="page" />);
    await ask("hello there");
    await waitFor(() => expect(seen).toHaveLength(1));
    unmount();
    expect(seen[0]?.aborted).toBe(true);
  });
});

describe("hostile answers", () => {
  it("draws none of a delete button, an unknown component, a Query or html in a note", async () => {
    app(<Thread variant="page" />);
    const s = scripted();
    await ask("anything");
    for (const l of [
      "root = Stack([c1, d, h, n])",
      'c1 = InsightCard("Safe card", [f1])',
      'f1 = Funnel("c_bid", "30d")',
      'd = Button("Delete everything", "open_brain", {brain: "c_bid"})',
      'h = Script("alert(1)")',
      'q = Query("select * from pages", {})',
      'n = Callout("info", "empty", "<img src=x onerror=alert(1)>")',
    ])
      await s.line(l);
    await s.end();
    expect(await screen.findByRole("heading", { name: "Safe card" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByText(/alert\(1\)/, { selector: "script, h4, h3" })).toBeNull();
    expect(document.querySelector("img, script, iframe, [onerror]")).toBeNull();
    // A note is plain text: React escapes it, there is no markup path.
    expect(screen.getByTestId("agent-render").innerHTML).not.toContain("<img");
  });

  it("the renderer itself draws only registered nodes", () => {
    const node = (
      id: string,
      type: string,
      props: Record<string, unknown> = {},
      children: unknown[] = [],
    ) => ({ id, type, props, children }) as never;
    const { container } = render(
      <MemoryRouter>
        <AppProvider>
          <AgentRender
            root={node("root", "Stack", {}, [
              node("a", "Script", { src: "x" }),
              node("b", "DangerousHtml", { html: "<b>boo</b>" }),
              node("c", "Callout", { tone: "info", template: "empty" }),
            ])}
          />
        </AppProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("agent-callout")).toBeInTheDocument();
    expect(container.textContent).not.toContain("boo");
    expect(container.querySelector("script, [data-html]")).toBeNull();
  });
});

describe("actions and refinements", () => {
  it("a button posts a structured action and the next answer is the focus panel", async () => {
    const spy = vi.spyOn(mockAgent, "agentTurnResponse");
    app(<Thread variant="page" />);
    await ask("Show me where Bid & Pre-sales stands this month");
    expect(
      await screen.findByRole("heading", { name: /Bid & Pre-sales: Knowledge flow/ }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("agent-funnel")).toBeInTheDocument();
    expect(await screen.findByTestId("agent-beeswarm")).toBeInTheDocument();
    expect(await screen.findByTestId("agent-pagelist")).toBeInTheDocument();
    // AI off: the answer says so quietly.
    expect(await screen.findByTestId("agent-det-note")).toHaveTextContent("AI is switched off");
    await userEvent.click(await screen.findByRole("button", { name: "Focus: Bid & Pre-sales" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[0]).toMatchObject({
      action: { action: "focus", values: { brain: "c_bid" } },
    });
    expect(spy.mock.calls[1]?.[0]).not.toHaveProperty("text");
    expect(
      await screen.findByRole("heading", { name: /Bid & Pre-sales: In focus/ }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("agent-fit")).toBeInTheDocument();
    expect(await screen.findByTestId("agent-activity")).toBeInTheDocument();
  });

  it("refine sends the previous program, and density and language come from the device settings", async () => {
    writeSettings({ density: "compact", lang: "fr" });
    const spy = vi.spyOn(mockAgent, "agentTurnResponse");
    app(<Thread variant="page" />);
    await ask("Show me where Bid & Pre-sales stands");
    const pin = await screen.findByRole("button", { name: "Pin" });
    expect(pin).toBeEnabled();
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ lang: "fr", density: "compact" });
    await userEvent.click(screen.getByRole("button", { name: "Refine" }));
    const box = await screen.findByRole("textbox", { name: "Refine this answer" });
    await userEvent.type(box, "make this denser{Enter}");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const body = spy.mock.calls[1]?.[0] as { previous?: string; text?: string };
    expect(body.text).toBe("make this denser");
    expect(body.previous).toContain("root = Stack(");
    await waitFor(() => expect(document.querySelectorAll(".ag-grid").length).toBeGreaterThan(0));
  });

  it("shows tokens only behind the setting", async () => {
    app(<Thread variant="page" />);
    await ask("What needs my attention?");
    await screen.findByRole("button", { name: "Pin" });
    expect(screen.queryByTestId("agent-tokens")).toBeNull();
    act(() => {
      writeSettings({ tokens: true });
    });
    expect(await screen.findByTestId("agent-tokens")).toHaveTextContent("No AI used");
  });

  it("explains a refused turn and offers a retry", async () => {
    vi.spyOn(mockAgent, "agentTurnResponse").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }),
    );
    app(<Thread variant="page" />);
    await ask("one more thing");
    const err = await screen.findByRole("alert");
    expect(err).toHaveTextContent("My Agent could not answer");
    expect(err).toHaveTextContent("too many times");
    await userEvent.click(within(err).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("Enter sends, Shift and Enter add a line, 500 characters at most", async () => {
    const spy = vi.spyOn(mockAgent, "agentTurnResponse");
    app(<Thread variant="page" />);
    const box = (await screen.findByRole("textbox", {
      name: "Ask My Agent",
    })) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(500);
    await userEvent.type(box, "first{Shift>}{Enter}{/Shift}second");
    expect(box.value).toBe("first\nsecond");
    expect(spy).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(box.value).toBe("");
  });

  it("answers in French when the app is French", async () => {
    window.localStorage.setItem("secondary.lang", "fr");
    app(<Thread variant="page" />);
    expect(
      await screen.findByRole("textbox", { name: "Poser une question à Mon agent" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Montre-moi où en est/)).toBeInTheDocument();
  });
});

describe("saved views", () => {
  it("pins an answer, and after a reload it is read again and drawn", async () => {
    const first = app(<Thread variant="page" />);
    await ask("Show me where Bid & Pre-sales stands this month");
    await userEvent.click(await screen.findByRole("button", { name: "Pin" }));
    const dlg = await screen.findByRole("dialog", { name: "Pin this view" });
    const name = within(dlg).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Monday bid review");
    await userEvent.click(within(dlg).getByRole("button", { name: "Pin view" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pin this view" })).toBeNull());
    // Plan only: the stored view has a program and no data.
    const stored = await viewsApi.list("home");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.program).toContain("Funnel(");
    expect(JSON.stringify(stored[0])).not.toMatch(/publishRate|dots|points/);
    first.unmount();
    clearResolveCache();
    app(<PinnedGrid />);
    expect(await screen.findByRole("heading", { name: "Monday bid review" })).toBeInTheDocument();
    expect(await screen.findByTestId("agent-funnel")).toBeInTheDocument();
    expect(screen.getByTestId("agent-grid")).toBeInTheDocument();
  });

  it("pins to a brain's My view tab", async () => {
    app(<Thread variant="page" />);
    await ask("Show me where Bid & Pre-sales stands");
    await userEvent.click(await screen.findByRole("button", { name: "Pin" }));
    const dlg = await screen.findByRole("dialog", { name: "Pin this view" });
    await userEvent.click(within(dlg).getByRole("radio", { name: "Brain > My view" }));
    const sel = await within(dlg).findByRole("combobox", { name: "Brain" });
    await waitFor(() => expect(within(sel).getAllByRole("option").length).toBeGreaterThan(1));
    await userEvent.selectOptions(sel, "c_bid");
    await userEvent.click(within(dlg).getByRole("button", { name: "Pin view" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await viewsApi.list("c_bid")).toHaveLength(1);
    expect(await viewsApi.list("home")).toHaveLength(0);
  });

  it("a shared view shows a lower persona locked cards and nothing more", async () => {
    const program = [
      "root = Stack([c1, c2])",
      'c1 = InsightCard("Sales secrets", [f1])',
      'f1 = Funnel("c_sales", "30d")',
      'c2 = InsightCard("Bid flow", [f2])',
      'f2 = Funnel("c_bid", "30d")',
    ].join("\n");
    persona("ceo");
    const v = await viewsApi.create({ name: "Both", program, pin: "home" });
    const own = await viewsApi.list("home");
    expect(own[0]?.tree?.children.map((c) => c.type)).toEqual(["InsightCard", "InsightCard"]);
    const { shareId, path } = await viewsApi.share(v.id);
    expect(path).toBe(`/agent/shared/${shareId}`);
    persona("head_bid");
    clearResolveCache();
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <AgentHostProvider>
            <Routes>
              <Route path="/agent/shared/:shareId" element={<SharedView />} />
            </Routes>
          </AgentHostProvider>
        </AppProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Bid flow" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("agent-locked")).toHaveLength(1);
    // No title, brain id or text from the locked card reaches the page.
    expect(document.body.textContent).not.toMatch(/Sales secrets|c_sales/);
    expect(await screen.findByTestId("agent-funnel")).toBeInTheDocument();
  });

  it("a locked tree draws placeholders with generic text only", () => {
    const locked = (id: string) =>
      ({ id, type: "Locked", props: { reason: "no_access" }, children: [] }) as never;
    render(
      <AppProvider>
        <AgentRender
          root={
            { id: "root", type: "Stack", props: {}, children: [locked("a"), locked("b")] } as never
          }
        />
      </AppProvider>,
    );
    const all = screen.getAllByTestId("agent-locked");
    expect(all).toHaveLength(2);
    for (const el of all)
      expect(el).toHaveTextContent(/^LockedThis card needs access you do not have\.$/);
    render(<LockedCard />);
  });
});

describe("panel", () => {
  it("opens with Ctrl+J, closes with Escape and gives focus back", async () => {
    app(
      <>
        <AgentButton />
        <AgentPanelSlot />
      </>,
    );
    const btn = screen.getByRole("button", { name: /My Agent/ });
    btn.focus();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    const dlg = await screen.findByRole("dialog", { name: "My Agent panel" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "My Agent panel" })).toBeNull(),
    );
    expect(document.activeElement).toBe(btn);
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "My Agent panel" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "My Agent panel" })).toBeNull(),
    );
  });
});
