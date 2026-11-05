import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { parseSse, ux2 } from "../uxv2/api";
import type { Question, TreeNode } from "../uxv2/types";
import { Ask } from "../views/ask/Ask";
import { BrainTree } from "../views/brain/Tree";
import { QuestionCard } from "../views/questions/Questions";

const say = vi.fn();
vi.mock("../state", () => ({
  useApp: () => ({
    say,
    epoch: 0,
    openNode: vi.fn(),
    me: { principal: { id: "u_consultant", email: "c@example.invalid", roleIds: ["consultant"] } },
  }),
}));

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  say.mockReset();
  vi.restoreAllMocks();
});

describe("Ask: streaming answer", () => {
  it("shows the stage while streaming, then the answer, citations as links to Brain, and the usage footer", async () => {
    wrap(<Ask />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "How do we run a project handover?" }),
    );
    expect(await screen.findByTestId("stage")).toHaveTextContent("Reading the index");
    const answer = await screen.findByTestId("answer", {}, { timeout: 4000 });
    expect(answer).toHaveTextContent("Delivery handbook");
    const chip = within(screen.getByRole("group", { name: "Sources" })).getByRole("link", {
      name: "Delivery handbook",
    });
    expect(chip).toHaveAttribute("href", "/brain?ws=core&page=delivery-handbook");
    const foot = await screen.findByTestId("usage-foot", {}, { timeout: 4000 });
    expect(foot).toHaveTextContent("tokens used");
    expect(foot).toHaveTextContent("Saved 96% by reading the index first");
  });

  it("says the brain does not know instead of guessing", async () => {
    wrap(<Ask />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en["ask.label"]), "Zebra quantum xylophone budget");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    const unknown = await screen.findByTestId("unknown", {}, { timeout: 4000 });
    expect(unknown).toHaveTextContent("The brain does not know this yet");
    expect(screen.queryByTestId("answer")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("suggests questions for the role", async () => {
    wrap(<Ask />);
    expect(await screen.findByRole("list", { name: "Questions to start with" })).toHaveTextContent(
      "How do we run a project handover?",
    );
  });
});

describe("SSE parsing", () => {
  it("yields named events across chunk boundaries", async () => {
    const enc = new TextEncoder();
    const chunks = [
      'event: status\ndata: {"stage":"in',
      'dex"}\n\nevent: answer\ndata: {"markdown":"Hi","unknown":false}\n\n',
      "event: done\ndata: {}\n\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(enc.encode(x));
        c.close();
      },
    });
    const seen: string[] = [];
    for await (const ev of parseSse(body)) seen.push(ev.event);
    expect(seen).toEqual(["status", "answer", "done"]);
  });
});

describe("Brain tree", () => {
  const roots: TreeNode[] = [
    {
      id: "core",
      label: "Company Global",
      kind: "workspace",
      access: "full",
      children: [
        {
          id: "core/offer",
          label: "Offers",
          kind: "folder",
          access: "full",
          count: 1,
          children: [{ id: "p1", label: "Analytics retainer offer", kind: "page", access: "full" }],
        },
        { id: "core/contact", label: "Contacts", kind: "folder", access: "locked" },
      ],
    },
  ];
  const props = {
    groups: [{ key: "company", title: "Company Brain", nodes: roots }],
    selected: null,
    onPage: vi.fn(),
    onFolder: vi.fn(),
  };

  it("shows a locked folder by name only and never as a control", () => {
    render(<BrainTree {...props} />);
    const locked = screen.getByTestId("tree-locked");
    expect(locked).toHaveTextContent("Contacts");
    expect(locked).toHaveTextContent("Locked");
    expect(within(locked).queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render what the API left out", () => {
    render(<BrainTree {...props} />);
    expect(screen.queryByText("Bids")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).not.toContain("Contacts");
  });

  it("opens a folder and picks a page", async () => {
    const onPage = vi.fn();
    render(<BrainTree {...props} onPage={onPage} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Offers/ }));
    await user.click(screen.getByRole("button", { name: "Analytics retainer offer" }));
    expect(onPage).toHaveBeenCalledWith("core", "p1");
  });
});

describe("Questions: contradiction", () => {
  const q: Question = {
    id: "q1",
    kind: "contradiction",
    title: "Acme renewal date",
    workspaceId: "a_acme",
    createdAt: "2026-11-05T12:00:00.000Z",
    summary: "Two sources disagree.",
    options: [
      { action: "keep_current", label: "Keep the current page" },
      { action: "prefer_incoming", label: "Use the new source" },
    ],
    detail: {
      current: { text: "Due 2027-03-31.", sources: [{ id: "c1", title: "Contract summary" }] },
      incoming: { text: "Moved to 2027-06-30.", sources: [{ id: "k1", title: "Kickoff record" }] },
    },
  };

  it("shows both sides with their sources and sends the chosen side", async () => {
    const answer = vi.spyOn(ux2, "answer").mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    wrap(<QuestionCard q={q} onDone={onDone} />);
    expect(screen.getByRole("group", { name: "Which is right?" })).toBeInTheDocument();
    expect(screen.getByText("Due 2027-03-31.")).toBeInTheDocument();
    expect(screen.getByText("Moved to 2027-06-30.")).toBeInTheDocument();
    expect(screen.getByText(/Contract summary/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "This one is right: New source" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("q1"));
    expect(answer).toHaveBeenCalledWith("q1", { action: "prefer_incoming" });
  });

  it("shows the server's reason when a decision is refused", async () => {
    vi.spyOn(ux2, "answer").mockRejectedValue(new ApiError(403, "Not yours to decide."));
    const onDone = vi.fn();
    wrap(<QuestionCard q={q} onDone={onDone} />);
    await userEvent.click(
      screen.getByRole("button", { name: "This one is right: On the page now" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Not yours to decide.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows two-person status on an approval and sends the revision it names", async () => {
    const answer = vi.spyOn(ux2, "answer").mockResolvedValue({ ok: true });
    const rel: Question = {
      id: "q2",
      kind: "release",
      title: "Release: Bid playbook",
      workspaceId: "core",
      createdAt: "2026-11-05T12:00:00.000Z",
      summary: "Needs two people.",
      options: [{ action: "approve", label: "Approve release" }],
      detail: { approvals: 1, required: 2, revisionHash: "b".repeat(64) },
    };
    wrap(<QuestionCard q={rel} onDone={vi.fn()} />);
    expect(screen.getByTestId("two-person")).toHaveTextContent("1 of 2 approvals");
    await userEvent.click(screen.getByRole("button", { name: "Approve release" }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith("q2", {
        action: "approve",
        revisionHash: "b".repeat(64),
      }),
    );
  });
});

describe("FR/EN parity for UX v2", () => {
  it("has a French string for every new key and no em dash", () => {
    const keys = Object.keys(en).filter((k) => /^(ask2?|brain|q|rt|usage)\./.test(k));
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      const f = (fr as Record<string, string>)[k];
      expect(f, k).toBeTruthy();
      expect(f, k).not.toContain("—");
      expect((en as Record<string, string>)[k], k).not.toContain("—");
    }
  });
});
