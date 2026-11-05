import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setPersona } from "../api";
import { lp } from "../lp/api";
import type { LandingDraft, LpCandidate, LpChecks, LpReference, LpReviewDetail } from "../lp/types";
import { resetLpMock } from "../mock/lp";
import { Composer } from "../views/studio/lp/Composer";
import { LpEditor } from "../views/studio/lp/Editor";
import { LandingReview } from "../views/studio/lp/LandingReview";
import { ReferencesPanel } from "../views/studio/lp/Panels";

const say = vi.fn();
vi.mock("../state", () => ({
  useApp: () => ({ say, epoch: 0, openNode: vi.fn(), me: null }),
}));

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const cand = (n: number, permission: LpReference["permission"] = "named"): LpCandidate => ({
  pageId: `p${n}`,
  title: `Client ${n} programme`,
  summary: `Result ${n}`,
  permission,
  ...(permission === "generalised-only" ? { generalisedTitle: `A European retailer ${n}` } : {}),
});

const draft = (over: Partial<LandingDraft> = {}): LandingDraft => ({
  id: "lp_t",
  status: "draft",
  brand: "amaris",
  lang: "en",
  prospect: { firstName: "Mira", role: "Head of Digital", company: "Fabrikam" },
  slots: {
    hero: "AI that holds up in production.",
    intro: "Mira, you own this topic.",
    whyUs: "We ship in small steps.",
    caseStudyIntro: "Projects close to you.",
    cta: "Let's talk.",
  },
  references: [cand(1)],
  contact: { name: "Sam Rowe", title: "Sales owner", email: "sam@example.invalid" },
  revision: 3,
  revisionHash: "h".repeat(64),
  ...over,
});

beforeEach(() => {
  say.mockReset();
  vi.restoreAllMocks();
  resetLpMock();
  setPersona("head_bid");
});

describe("references panel", () => {
  const six = [1, 2, 3, 4, 5, 6].map((n) => cand(n));
  const all = [...six, cand(7), cand(8)];

  it("enforces the 6 reference maximum with a helpful message", async () => {
    vi.spyOn(lp, "references").mockResolvedValue(all);
    const onChange = vi.fn();
    render(<ReferencesPanel draftId="lp_t" references={six} lang="en" onChange={onChange} />);
    const add = await screen.findByRole("button", { name: "Add Client 7 programme" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("ref-count")).toHaveTextContent("6 of 6 used");
    await userEvent.click(add);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("ref-note")).toHaveTextContent("6 references at most");
    expect(screen.getByTestId("ref-note")).toHaveTextContent("Remove one to add another");
  });

  it("adds a reference while there is room", async () => {
    vi.spyOn(lp, "references").mockResolvedValue(all);
    const onChange = vi.fn();
    render(
      <ReferencesPanel draftId="lp_t" references={six.slice(0, 2)} lang="en" onChange={onChange} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Add Client 3 programme" }));
    expect(onChange).toHaveBeenCalledWith([
      ...six.slice(0, 2),
      expect.objectContaining({ pageId: "p3" }),
    ]);
  });

  it("badges Named and Generalised, and explains the customer permission", async () => {
    vi.spyOn(lp, "references").mockResolvedValue([]);
    const refs = [cand(1), cand(2, "generalised-only")];
    render(<ReferencesPanel draftId="lp_t" references={refs} lang="en" onChange={vi.fn()} />);
    const items = await screen.findAllByRole("listitem");
    const named = items[0] as HTMLElement;
    const gen = items[1] as HTMLElement;
    expect(within(named).getByText("Named")).toBeInTheDocument();
    expect(named).toHaveTextContent("Client 1 programme");
    expect(named).toHaveTextContent("customer permission covers this project");
    expect(within(gen).getByText("Generalised")).toBeInTheDocument();
    expect(gen).toHaveTextContent("Client 2 programme");
    expect(gen).toHaveTextContent("No permission on record");
    expect(gen).toHaveTextContent('The page shows "A European retailer 2" and hides the client');
  });
});

describe("editor", () => {
  const issues: LpChecks = {
    ok: false,
    issues: [
      {
        slot: "hero",
        kind: "customer-permission",
        detail: "Names a client without permission on record: Northwind.",
        fix: { label: "Replace with a generalised name", text: "AI for a European bank." },
      },
    ],
  };

  it("blocks Submit for review while a check is open", async () => {
    vi.spyOn(lp, "get").mockResolvedValue(draft());
    vi.spyOn(lp, "check").mockResolvedValue(issues);
    vi.spyOn(lp, "references").mockResolvedValue([]);
    const submit = vi.spyOn(lp, "submit");
    wrap(<LpEditor id="lp_t" />);
    const btn = await screen.findByRole("button", { name: "Submit for review" });
    await waitFor(() => expect(btn).toHaveAttribute("aria-disabled", "true"));
    await userEvent.click(btn);
    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByTestId("submit-blocked")).toHaveTextContent(
      "Fix the 1 open check first",
    );
    // The checks panel opens with the one-click fix.
    expect(
      await screen.findByRole("button", { name: /Replace with a generalised name/ }),
    ).toBeVisible();
  });

  it("submits once the checks pass", async () => {
    vi.spyOn(lp, "get").mockResolvedValue(draft());
    vi.spyOn(lp, "check").mockResolvedValue({ ok: true, issues: [] });
    vi.spyOn(lp, "references").mockResolvedValue([]);
    const submit = vi.spyOn(lp, "submit").mockResolvedValue(draft({ status: "in_review" }));
    wrap(<LpEditor id="lp_t" />);
    await userEvent.click(await screen.findByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("lp_t"));
    expect(await screen.findByText(/waiting for a reviewer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  });

  it("applies a one-click fix and saves it", async () => {
    vi.spyOn(lp, "get").mockResolvedValue(draft());
    vi.spyOn(lp, "check").mockResolvedValueOnce(issues).mockResolvedValue({ ok: true, issues: [] });
    vi.spyOn(lp, "references").mockResolvedValue([]);
    const save = vi.spyOn(lp, "save").mockResolvedValue(draft({ revision: 4 }));
    wrap(<LpEditor id="lp_t" />);
    await userEvent.click(await screen.findByRole("button", { name: /Checks/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Replace with a generalised name/ }),
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[1].slots.hero).toBe("AI for a European bank.");
    expect(save.mock.calls[0]?.[1].revision).toBe(3);
    expect(await screen.findByText("All checks pass. This page can go to review.")).toBeVisible();
  });

  it("says plainly when another save won (409) and offers both ways out", async () => {
    vi.spyOn(lp, "get").mockResolvedValue(draft());
    vi.spyOn(lp, "check").mockResolvedValue({ ok: true, issues: [] });
    vi.spyOn(lp, "references").mockResolvedValue([]);
    const save = vi
      .spyOn(lp, "save")
      .mockRejectedValueOnce(new ApiError(409, "This page changed since you opened it."))
      .mockResolvedValue(draft({ revision: 8 }));
    wrap(<LpEditor id="lp_t" />);
    const frame = (await screen.findByTestId("page-preview")) as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    await waitFor(() => expect(doc.querySelector('[data-slot="hero"]')).not.toBeNull());
    const slot = doc.querySelector('[data-slot="hero"]') as HTMLElement;
    slot.click();
    expect(slot.getAttribute("role")).toBe("textbox");
    slot.textContent = "A new headline.";
    slot.dispatchEvent(new Event("input", { bubbles: true }));
    const alert = await screen.findByTestId("conflict", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("This page changed somewhere else");
    expect(alert).toHaveTextContent("your last edit did not save");
    expect(screen.getByRole("button", { name: "Submit for review" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(within(alert).getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[1].slots.hero).toBe("A new headline.");
    await waitFor(() => expect(screen.queryByTestId("conflict")).not.toBeInTheDocument());
  });
});

describe("composer", () => {
  it("states that name and role are personal data kept on the page for 90 days", () => {
    render(<Composer onCreated={vi.fn()} onCancel={vi.fn()} />);
    const note = screen.getByTestId("lp-privacy");
    expect(note).toHaveTextContent("personal data");
    expect(note).toHaveTextContent("this page only");
    expect(note).toHaveTextContent("90 days");
  });

  it("asks for role, company and angle, and sends them", async () => {
    const compose = vi.spyOn(lp, "compose").mockResolvedValue(draft());
    const done = vi.fn();
    render(<Composer onCreated={done} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Compose" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add the role, the company and the angle.");
    expect(compose).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Prospect role"), "CFO");
    await userEvent.type(screen.getByLabelText("Company"), "Contoso");
    await userEvent.click(screen.getByRole("button", { name: "Cyber resilience" }));
    await userEvent.click(screen.getByRole("button", { name: "Compose" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(compose).toHaveBeenCalledWith({
      prospect: { role: "CFO", company: "Contoso" },
      angle: "Cyber resilience",
      brand: "amaris",
      lang: "en",
    });
  });
});

describe("release review", () => {
  it("renders the page and a diff against the previous revision", () => {
    const d = draft({ slots: { ...draft().slots, hero: "A sharper headline." } });
    const detail: LpReviewDetail = {
      id: d.id,
      draft: d,
      previous: { slots: draft().slots, references: d.references, contact: d.contact, revision: 2 },
    };
    render(<LandingReview detail={detail} />);
    const frame = screen.getByTestId("page-preview") as HTMLIFrameElement;
    expect(frame.contentDocument?.body.textContent).toContain("A sharper headline.");
    const diff = screen.getByRole("group", { name: "Changes since the previous revision" });
    expect(diff).toHaveTextContent("A sharper headline.");
    expect(diff).toHaveTextContent("AI that holds up in production.");
  });
});
