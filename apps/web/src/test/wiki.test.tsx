import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { Markdown } from "../views/wiki/Markdown";
import type { WikiProposal } from "../views/wiki/types";

const say = vi.fn();
vi.mock("../state", () => ({
  useApp: () => ({
    openNode: vi.fn(),
    say,
    epoch: 0,
    me: { principal: { id: "u_acme_lead", email: "a@example.invalid", roleIds: ["acme_lead"] } },
  }),
}));

const _proposal: WikiProposal = {
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
