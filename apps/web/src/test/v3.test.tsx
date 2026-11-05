import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Question } from "../uxv2/types";
import { AgentsSection, commandFor, HostPanel, handleOf } from "../views/brains/Agents";
import { v3 } from "../views/brains/api";
import { CoachChat, CoachPage } from "../views/brains/Coach";
import { validate } from "../views/brains/Fields";
import type { AccessView, AgentHost, CoachView } from "../views/brains/types";
import { approvalOutcome, batchAction } from "../views/waiting/QuestionCard";

const say = vi.fn();
vi.mock("../state", () => ({
  useApp: () => ({
    say,
    epoch: 0,
    me: { principal: { id: "u_x", email: "tony.t@example.invalid", roleIds: ["head_bid"] } },
  }),
}));

const persona = (p: string) => window.localStorage.setItem("secondary.persona", p);

beforeEach(() => {
  say.mockReset();
  vi.restoreAllMocks();
  persona("head_bid");
});

const _accountAccess: AccessView = {
  brainId: "a_acme",
  type: "account",
  canManage: true,
  publication: {
    mode: "review",
    allowed: ["review"],
    forced: true,
    reason: "Account brains always need a review before anything is published.",
  },
  everyone: {
    level: "none",
    allowed: ["none"],
    reason: "Account and NDA brains are never open to everyone at Mantu.",
  },
  roles: [
    { id: "reader", label: "Reader", summary: "Reads.", actions: [] },
    { id: "owner", label: "Owner", summary: "Manages.", actions: [] },
  ],
  members: [],
};

const q = (over: Partial<Question>): Question => ({
  id: "x",
  kind: "release",
  title: "Release: Bid playbook",
  workspaceId: "core",
  createdAt: "2026-11-04T16:00:00.000Z",
  summary: "",
  options: [{ action: "approve", label: "Approve" }],
  detail: { approvals: 0, required: 2, revisionHash: "b".repeat(64) },
  ...over,
});

describe("Waiting items: batch rules", () => {
  it("says per item whether an approval is the first or the final one", () => {
    const items = [
      q({ id: "a", detail: { approvals: 0, required: 2, revisionHash: "a".repeat(64) } }),
      q({ id: "b", detail: { approvals: 0, required: 1, revisionHash: "b".repeat(64) } }),
      q({ id: "c", detail: { approvals: 1, required: 2, revisionHash: "c".repeat(64) } }),
    ];
    expect(items.map(approvalOutcome)).toEqual(["first", "final", "final"]);
  });

  it("leaves contradictions out of a batch: a side has to be chosen on the card", () => {
    expect(
      batchAction(
        q({
          kind: "contradiction",
          options: [
            { action: "keep_current", label: "Keep" },
            { action: "prefer_incoming", label: "Use new" },
          ],
        }),
      ),
    ).toBeNull();
    expect(batchAction(q({}))).toBe("approve");
  });
});

const coachView: CoachView = {
  brainId: "c_bid",
  questions: [
    {
      id: "template",
      prompt: "Start from which template?",
      kind: "choice",
      options: ["bid", "practice"],
    },
  ],
  templates: [],
  current: { template: "bid", collections: ["bid"] },
};

async function toProposal(manages: boolean) {
  persona("head_bid");
  render(
    <MemoryRouter>
      <CoachChat id="c_bid" view={coachView} manages={manages} />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "bid" }));
  await user.click(screen.getByRole("button", { name: "Propose a structure" }));
  await screen.findByTestId("coach-preview");
  return user;
}

describe("Structure coach: apply is for managers only", () => {
  it("offers Apply to a manager, and applies the proposal it was shown", async () => {
    const apply = vi.spyOn(v3, "apply");
    const user = await toProposal(true);
    await user.click(screen.getByRole("button", { name: "Apply this structure" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0]?.[0]).toBe("c_bid");
    expect(await screen.findByText(/collections created/)).toBeVisible();
  });

  it("shows no Apply button to someone who does not manage the brain", async () => {
    const apply = vi.spyOn(v3, "apply");
    await toProposal(false);
    expect(screen.queryByRole("button", { name: "Apply this structure" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only people who manage this brain can apply/)).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
  });

  it("the page tells a non-manager there is nothing to do here", async () => {
    persona("consultant");
    render(
      <MemoryRouter initialEntries={["/brains/c_delivery/coach"]}>
        <Routes>
          <Route path="/brains/:id/coach" element={<CoachPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("note")).toHaveTextContent("Only people who manage this brain");
    expect(screen.queryByRole("button", { name: "Propose a structure" })).not.toBeInTheDocument();
  });
});

const host: AgentHost = {
  id: "claude_code",
  label: "Claude Code",
  connected: true,
  lastCallAt: "2026-11-05T16:00:00.000Z",
  calls: 4,
  scopes: ["secondary.read"],
  connections: [
    {
      id: "cn_1",
      lastCallAt: "2026-11-05T16:00:00.000Z",
      lastTool: "search",
      scopes: ["secondary.read"],
      state: "active",
    },
  ],
};

describe("Agents: revoke needs an in-page confirmation", () => {
  it("asks first, revokes only on confirm, and can be cancelled", async () => {
    const revoke = vi.spyOn(v3, "revokeConnection").mockResolvedValue({ ok: true, revoked: 1 });
    const changed = vi.fn();
    render(<HostPanel host={host} handle="tony-t" onChange={changed} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const confirm = screen.getByRole("group", { name: "Revoke this connection?" });
    expect(confirm).toBeVisible();
    expect(revoke).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(
      screen.queryByRole("group", { name: "Revoke this connection?" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Revoke now" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("cn_1"));
    expect(changed).toHaveBeenCalled();
  });

  it("gives the exact per-user command and the agent instructions to copy", () => {
    render(<HostPanel host={host} handle="tony-t" onChange={() => {}} />);
    expect(
      screen.getByText(/claude mcp add --transport http --callback-port 3118 secondary-tony-t /),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Copy/ })).toHaveLength(2);
    expect(commandFor("claude_ai", "x", "https://h/mcp")).toBeNull();
    expect(handleOf("Tony.T@example.invalid")).toBe("tony-t");
  });
});

describe("Agents: the MCP URL comes from the API", () => {
  const load = async (mcpUrl: string | null) => {
    vi.spyOn(v3, "agents").mockResolvedValue({ hosts: [host] });
    vi.spyOn(v3, "agentConfig").mockResolvedValue({ mcpUrl });
    render(
      <MemoryRouter>
        <AgentsSection />
      </MemoryRouter>,
    );
    return screen.findByText(/claude mcp add --transport http/);
  };

  it("builds the connect command from the configured MCP_PUBLIC_URL", async () => {
    const cmd = await load("https://secondary-mcp-dev.tony-walteur.workers.dev/mcp");
    expect(cmd).toHaveTextContent(" https://secondary-mcp-dev.tony-walteur.workers.dev/mcp");
    expect(cmd).not.toHaveTextContent("localhost");
  });

  it("falls back to a guess from this page only when the API has no URL", async () => {
    const cmd = await load(null);
    expect(cmd).toHaveTextContent("http://localhost:8788/mcp");
  });

  it("also falls back when the config request fails", async () => {
    vi.spyOn(v3, "agents").mockResolvedValue({ hosts: [host] });
    vi.spyOn(v3, "agentConfig").mockRejectedValue(new Error("down"));
    render(
      <MemoryRouter>
        <AgentsSection />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/claude mcp add --transport http/)).toBeVisible();
  });
});

describe("Business fields rules", () => {
  it("flags a bad key, a duplicate, a choice with no options and a bad retention", () => {
    const f = (o: object) => ({
      key: "a",
      label: "A",
      type: "text" as const,
      sensitivity: "none" as const,
      retentionDays: null,
      appliesTo: [],
      ...o,
    });
    const bad = validate([
      f({ key: "Bad Key" }),
      f({ key: "dup" }),
      f({ key: "dup" }),
      f({ key: "c", type: "select" }),
      f({ key: "d", retentionDays: 5000 }),
    ]);
    expect(bad).toEqual({
      0: "b3.fld.err.key",
      2: "b3.fld.err.dup",
      3: "b3.fld.err.options",
      4: "b3.fld.err.retention",
    });
  });
});
