import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { BriefView } from "../views/brief/BriefView";
import { PrepareBrief } from "../views/brief/PrepareBrief";
import type { BriefResponse } from "../views/brief/types";

const openNode = vi.fn();
const say = vi.fn();
vi.mock("../state", () => ({ useApp: () => ({ openNode, say }) }));

const result: BriefResponse = {
  saved: null,
  brief: {
    target: { accountId: "a_acme", nodeId: "a_acme", meetingId: null },
    question: null,
    title: "Acme brief",
    sections: [
      {
        heading: "Where things stand",
        claims: [
          { text: "The renewal decision is open.", citations: ["E1"], unknown: false },
          { text: "The budget owner is not named.", citations: [], unknown: true },
        ],
      },
    ],
    evidence: [
      { id: "E1", nodeId: "a_acme:dec:0", title: "Renewal decision", plane: "ACCOUNT_RESTRICTED" },
    ],
    excluded: [
      { evidenceId: "E1", line: 3, category: "health", excerpt: "My knee surgery is booked" },
    ],
    insufficientEvidence: false,
    dropped: { uncited: 1, badCitations: 2 },
    disclosure: {
      processor: "Anthropic API",
      model: "claude-sonnet-5-5",
      region: "Anthropic API, processing location per Anthropic terms",
      generatedAt: "2026-11-05T12:00:00.000Z",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  },
};

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  vi.restoreAllMocks();
  openNode.mockClear();
});

describe("BriefView", () => {
  it("cites sources that open the source item, and marks unknowns", async () => {
    wrap(<BriefView result={result} />);
    await userEvent.click(screen.getByRole("button", { name: /Open source: Renewal decision/ }));
    expect(openNode).toHaveBeenCalledWith("a_acme:dec:0");
    const unknown = screen.getByText(/budget owner is not named/).closest("li");
    expect(unknown).toHaveClass("unknown");
    expect(unknown).toHaveTextContent("Unknown");
  });

  it("shows the disclosure, what was excluded and what was dropped", () => {
    wrap(<BriefView result={result} />);
    expect(
      screen.getByText(/Processed by Anthropic API, model claude-sonnet-5-5/),
    ).toBeInTheDocument();
    expect(screen.getByText(/processing location per Anthropic terms/)).toBeInTheDocument();
    expect(screen.getByText(/Excluded as personal \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 statement without a valid source was removed/)).toBeInTheDocument();
  });

  it("saves to My Secondary", async () => {
    const save = vi
      .spyOn(api, "saveBrief")
      .mockResolvedValue({ saved: { id: "pi:abc", revision: 2 } });
    wrap(<BriefView result={result} />);
    await userEvent.click(screen.getByRole("button", { name: /Save to My Secondary/ }));
    expect(save).toHaveBeenCalledOnce();
    expect(await screen.findByText("Saved r2")).toBeInTheDocument();
  });
});

describe("PrepareBrief", () => {
  const ready = {
    state: "ready" as const,
    reason: null,
    processor: "Anthropic API",
    model: "claude-sonnet-5-5",
    region: "x",
  };

  it("says the processor is not configured and keeps the button off", async () => {
    vi.spyOn(api, "aiStatus").mockResolvedValue({
      ...ready,
      state: "not_configured",
      reason: "AI processor not configured",
      model: null,
    });
    wrap(<PrepareBrief accountId="a_acme" aiProcessing="allowed" />);
    expect(await screen.findByText("AI processor not configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prepare brief/ })).toBeDisabled();
  });

  it("is off when the contract record does not allow AI", async () => {
    vi.spyOn(api, "aiStatus").mockResolvedValue(ready);
    wrap(<PrepareBrief accountId="a_ember" aiProcessing="unknown" />);
    expect(await screen.findByText(/says AI processing is unknown/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prepare brief/ })).toBeDisabled();
  });

  it("requests a brief without saving it, then shows it", async () => {
    vi.spyOn(api, "aiStatus").mockResolvedValue(ready);
    const brief = vi.spyOn(api, "brief").mockResolvedValue(result);
    wrap(<PrepareBrief accountId="a_acme" meetingId="a_acme:m0" aiProcessing="allowed" />);
    const button = screen.getByRole("button", { name: /Prepare brief/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.type(screen.getByLabelText(/Question for the brief/), "open risks?");
    await userEvent.click(button);
    expect(brief).toHaveBeenCalledWith({
      accountId: "a_acme",
      meetingId: "a_acme:m0",
      question: "open risks?",
      save: false,
    });
    expect(await screen.findByText("Acme brief")).toBeInTheDocument();
  });
});
