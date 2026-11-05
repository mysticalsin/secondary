import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { Review } from "../views/Review";
import { wikiApi } from "../views/wiki/api";
import { Markdown } from "../views/wiki/Markdown";
import type { WikiIndex, WikiProposal } from "../views/wiki/types";
import { WikiProposalDetail } from "../views/wiki/WikiProposalDetail";
import { WikiTab } from "../views/wiki/WikiTab";

const say = vi.fn();
vi.mock("../state", () => ({
  useApp: () => ({
    openNode: vi.fn(),
    say,
    epoch: 0,
    me: { principal: { id: "u_acme_lead", email: "a@example.invalid", roleIds: ["acme_lead"] } },
  }),
}));

const proposal: WikiProposal = {
  id: "cand:a_acme:0a1b2c3d",
  kind: "wiki_ingest",
  status: "candidate",
  title: "Ingest: Pricing review",
  rationale: "7 facts from the deterministic extractor",
  detail: "",
  authorId: "svc:wiki:a_acme",
  createdAt: "2026-11-05T12:00:00.000Z",
  revision: 1,
  revisionHash: "a".repeat(64),
  approvals: 0,
  required: 1,
  pages: [
    {
      pageId: "decision-log",
      type: "decision_log",
      title: "Decision log",
      before: null,
      after: "# Decision log\n- Adopt fixed fee: status decided {src:mtg:a_acme:1}",
      edited: false,
      stale: false,
      diff: [
        { type: "add", text: "# Decision log" },
        { type: "add", text: "- Adopt fixed fee: status decided {src:mtg:a_acme:1}" },
      ],
    },
  ],
  facts: [
    {
      subject: "decision: Adopt fixed fee",
      predicate: "status",
      object: "decided",
      validAt: "2026-11-03T00:00:00.000Z",
      origin: "agent",
      sources: [{ id: "mtg:a_acme:1", title: "Pricing review" }],
    },
  ],
  invalidate: [
    {
      factId: 4,
      at: "2026-11-03T00:00:00.000Z",
      subject: "decision: Adopt fixed fee",
      predicate: "status",
      object: "open",
    },
  ],
  confirm: [],
  archive: [],
  reingest: [],
  sources: [{ id: "mtg:a_acme:1", hash: "abc", title: "Pricing review" }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  say.mockClear();
});

describe("Markdown", () => {
  it("numbers citations, lists the sources, and links pages", async () => {
    const onLink = vi.fn();
    render(
      <MemoryRouter>
        <Markdown
          md={
            "# T\n\n## Decisions\n- Fixed fee {src:s1}{src:src:abcdef:0a}\n- See [[risk-register]]"
          }
          citations={{
            s1: { title: "Pricing review", kind: "item" },
            "src:abcdef:0a": { title: "Terms.md", kind: "source" },
          }}
          links={[{ id: "risk-register", title: "Risk register", local: true }]}
          onLink={onLink}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Source 1: Pricing review/ })).toHaveAttribute(
      "href",
      "#wiki-src-1",
    );
    const list = screen.getByRole("list", { name: "Sources" });
    expect(within(list).getByText("Pricing review")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Terms.md" })).toHaveAttribute(
      "href",
      "/sources/src%3Aabcdef%3A0a",
    );
    await userEvent.click(screen.getByRole("button", { name: "Risk register" }));
    expect(onLink).toHaveBeenCalledWith("risk-register");
    expect(document.body.innerHTML).not.toContain("{src:");
  });
});

describe("a wiki proposal", () => {
  it("shows the diff, the facts it adds, the facts it ends, and approves through the wiki review", async () => {
    vi.spyOn(wikiApi, "proposal").mockResolvedValue(proposal);
    const decide = vi.spyOn(wikiApi, "decide").mockResolvedValue({ ok: true, status: "approved" });
    const done = vi.fn();
    render(
      <MemoryRouter>
        <WikiProposalDetail ws="a_acme" id={proposal.id} onDone={done} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Ingest: Pricing review" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Proposed by Wiki agent/)).toBeInTheDocument();
    const diff = screen.getByRole("group", { name: "Changes to Decision log" });
    expect(within(diff).getByText(/Adopt fixed fee: status decided/)).toBeInTheDocument();
    expect(screen.getByText("New page")).toBeInTheDocument();
    expect(screen.getByText(/Ends these facts/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("a_acme", proposal.id, "approve", proposal.revisionHash),
    );
    expect(done).toHaveBeenCalledWith("Approved. The wiki is updated.");
  });

  it("lets a reviewer put their own wording on a page before approving", async () => {
    vi.spyOn(wikiApi, "proposal").mockResolvedValue(proposal);
    const edit = vi.spyOn(wikiApi, "editProposal").mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <WikiProposalDetail ws="a_acme" id={proposal.id} onDone={vi.fn()} />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Edit text/ }));
    const box = screen.getByLabelText("Page text for Decision log");
    await userEvent.clear(box);
    await userEvent.type(box, "# Decision log");
    await userEvent.click(screen.getByRole("button", { name: "Save my wording" }));
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith("a_acme", proposal.id, "decision-log", "# Decision log"),
    );
  });

  it("blocks approval when the page moved on since the draft", async () => {
    vi.spyOn(wikiApi, "proposal").mockResolvedValue({
      ...proposal,
      pages: proposal.pages.map((p) => ({ ...p, stale: true })),
    });
    render(
      <MemoryRouter>
        <WikiProposalDetail ws="a_acme" id={proposal.id} onDone={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/changed after the draft/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});

describe("the review queue", () => {
  it("shows wiki items beside ordinary candidates and opens them in the wiki review", async () => {
    vi.spyOn(api, "review").mockResolvedValue([
      {
        id: proposal.id,
        nodeId: proposal.id,
        title: proposal.title,
        scopeLabel: "Acme Synthetic SA",
        plane: "ACCOUNT_RESTRICTED",
        author: "svc:wiki:a_acme",
        revision: "1",
        previousRevision: null,
        submittedAt: proposal.createdAt,
        diff: [],
        flags: [],
        twoPerson: { required: false, approvals: 0, needed: 1 },
        approve: { allowed: true, reason: "ok" },
        requestChanges: { allowed: false, reason: "" },
        origin: "candidate",
        release: "scope",
        kind: "wiki_ingest",
      },
    ]);
    const get = vi.spyOn(wikiApi, "proposal").mockResolvedValue(proposal);
    render(
      <MemoryRouter>
        <Review />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: /Ingest: Pricing review/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("group", { name: "Changes to Decision log" }),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("a_acme", proposal.id);
  });
});

describe("the wiki tab", () => {
  const index: WikiIndex = {
    ws: "a_acme",
    nodeId: "a_acme",
    label: "Acme Synthetic SA",
    personal: false,
    pages: [
      {
        id: "decision-log",
        title: "Decision log",
        type: "decision_log",
        summary: "Adopt fixed fee",
        revision: 2,
        updatedAt: "2026-11-05T12:00:00.000Z",
        restricted: 1,
      },
    ],
    schema: { types: {} },
    health: {
      pages: 1,
      facts: 3,
      unverified: 2,
      openFindings: 1,
      openProposals: 1,
      stale: 0,
      lastLintAt: null,
      score: 70,
    },
    settings: { autoAccept: false, freshnessDays: 180 },
    can: { contribute: true, edit: true, decide: true, promote: false },
  };

  it("shows the index, health, restricted claims and the page with its citations", async () => {
    vi.spyOn(wikiApi, "index").mockResolvedValue(index);
    vi.spyOn(wikiApi, "page").mockResolvedValue({
      id: "decision-log",
      type: "decision_log",
      title: "Decision log",
      revision: 2,
      current: 2,
      markdown: "# Decision log\n\n## Decisions\n- Adopt fixed fee {src:m1}",
      summary: "Adopt fixed fee",
      citations: { m1: { title: "Pricing review", kind: "item" } },
      restricted: 1,
      links: [],
      uncited: 0,
      updatedAt: "2026-11-05T12:00:00.000Z",
    });
    render(
      <MemoryRouter>
        <WikiTab ws="a_acme" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Wiki health 70 of 100")).toBeInTheDocument();
    expect(screen.getByText("2 unverified facts")).toBeInTheDocument();
    expect(await screen.findByText(/1 claims are hidden/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Review (1)" })).toBeInTheDocument();
    expect(screen.getAllByText(/Pricing review/).length).toBeGreaterThan(0);
  });

  it("says the dev mock does not hold wikis, instead of failing silently", async () => {
    const { ApiError } = await import("../api");
    vi.spyOn(wikiApi, "index").mockRejectedValue(new ApiError(501, "Not part of the dev mock"));
    render(
      <MemoryRouter>
        <WikiTab ws="a_acme" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("needs the live stack");
  });
});

describe("FR and EN stay in step", () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("every wiki key exists in both languages with the same placeholders", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("wiki."));
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      const f = (fr as Record<string, string>)[k];
      expect(f, k).toBeTruthy();
      expect(vars(f as string), k).toEqual(vars((en as Record<string, string>)[k] as string));
    }
  });
});
