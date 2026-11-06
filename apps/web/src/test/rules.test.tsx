import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { v7En, v7Fr } from "../i18n/v7";
import { handle } from "../mock/index";
import { resetRulesMock } from "../mock/rules";
import { rulesApi } from "../rules/api";
import { RuleEditor } from "../rules/Editor";
import RulesPage from "../rules/Rules";
import { AppProvider } from "../state";

const BRAINS = [
  { id: "c_bid", label: "Bid & Pre-sales", type: "team" },
  { id: "core", label: "Company Global", type: "global" },
  { id: "a_acme", label: "Acme Synthetic SA", type: "account" },
];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("secondary.persona", "platform_admin");
  window.localStorage.setItem("secondary.lang", "en");
  resetRulesMock();
  vi.restoreAllMocks();
});

const editor = (ruleId: string | null) =>
  render(
    <AppProvider>
      <RuleEditor ruleId={ruleId} brains={BRAINS} admin onClose={() => {}} onChanged={() => {}} />
    </AppProvider>,
  );

const SLOW = { timeout: 4000 };

describe("rule editor", () => {
  it("shows a hard floor's reason inline and keeps Publish disabled while the rule is refused", async () => {
    const user = userEvent.setup();
    editor(null);
    await user.type(
      await screen.findByRole("textbox", { name: "Rule name" }),
      "Promotions go straight through",
    );
    await user.type(
      screen.getByRole("combobox", { name: "Values for check 1" }),
      "Promote to Global{Enter}",
    );
    await user.selectOptions(screen.getByLabelText("Effect"), "notify");
    await user.click(screen.getByRole("radio", { name: "Enforced" }));
    // Debounced check against POST /v1/rules/validate: a 422 with a floor issue.
    const issue = await screen.findByTestId("rule-issue", {}, SLOW);
    expect(issue).toHaveTextContent("Hard floor");
    expect(issue).toHaveTextContent(
      "A release to Global always needs two approvers: a rule cannot lower that.",
    );
    expect(screen.getByRole("button", { name: /^Publish v1$/ })).toBeDisabled();
    // Fix it: asking for review is not below the floor's needs once two approvers are asked.
    await user.selectOptions(screen.getByLabelText("Effect"), "two_approvers");
    await waitFor(() => expect(screen.queryByTestId("rule-issue")).toBeNull(), SLOW);
    await waitFor(
      () => expect(screen.getByRole("button", { name: /^Publish v1$/ })).toBeEnabled(),
      SLOW,
    );
  });

  it("switches the THEN rows with the effect", async () => {
    const user = userEvent.setup();
    editor(null);
    const effect = await screen.findByLabelText("Effect");
    expect(screen.queryByTestId("rule-approvers")).toBeNull();
    expect(screen.queryByTestId("rule-expires")).toBeNull();
    expect(screen.queryByTestId("rule-message")).toBeNull();
    await user.selectOptions(effect, "group");
    expect(screen.getByTestId("rule-approvers")).toBeInTheDocument();
    expect(within(screen.getByTestId("rule-approvers")).getByText("Stewards")).toBeInTheDocument();
    expect(screen.queryByTestId("rule-message")).toBeNull();
    await user.selectOptions(effect, "expire");
    expect(screen.getByTestId("rule-expires")).toBeInTheDocument();
    expect(screen.getByLabelText("Expires after")).toHaveValue(15);
    expect(screen.queryByTestId("rule-approvers")).toBeNull();
    await user.selectOptions(effect, "block");
    expect(screen.getByTestId("rule-message")).toBeInTheDocument();
    expect(screen.queryByTestId("rule-expires")).toBeNull();
    await user.selectOptions(effect, "review");
    expect(screen.queryByTestId("rule-message")).toBeNull();
    expect(screen.queryByTestId("rule-approvers")).toBeNull();
  });

  it("puts an AND label between conditions and none before the first", async () => {
    const user = userEvent.setup();
    editor("r_3");
    await screen.findByDisplayValue("Exports over 50 pages need approval");
    expect(screen.getAllByTestId("rule-condition")).toHaveLength(2);
    expect(screen.getAllByTestId("rule-and")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Add condition/ }));
    expect(screen.getAllByTestId("rule-and")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Remove condition 3" }));
    await user.click(screen.getByRole("button", { name: "Remove condition 2" }));
    expect(screen.queryAllByTestId("rule-and")).toHaveLength(0);
    // The last condition cannot be removed: a rule needs one.
    expect(screen.getByRole("button", { name: "Remove condition 1" })).toBeDisabled();
  });

  it("runs the impact preview when it opens and shows the simulator's real numbers", async () => {
    editor("r_3");
    const big = await screen.findByTestId("impact-number", {}, SLOW);
    const want = (await handle(
      "POST",
      "/v1/rules/simulate",
      { rule: (await rulesApi.get("r_3")).draft, days: 7 },
      "platform_admin",
    )) as {
      matches: number;
      total: number;
      split: { approval: number; blocked: number; allowed: number };
    };
    expect(want.matches).toBeGreaterThan(0);
    expect(big).toHaveTextContent(String(want.matches));
    expect(screen.getByTestId("impact-summary")).toHaveTextContent(
      `${want.matches} of ${want.total} requests would match: ${want.split.approval} need approval, ${want.split.blocked} blocked, ${want.split.allowed} allowed and notified.`,
    );
    // The legend names every non-zero part with its count, and a table twin shows the same numbers.
    expect(screen.getByText(`${want.split.approval} need approval`)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    const table = screen.getByTestId("impact-table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText(String(want.split.approval))).toBeInTheDocument();
    // Samples carry an effect chip and no content.
    const samples = screen.getByTestId("impact-samples");
    expect(within(samples).getAllByText("Approval").length).toBeGreaterThan(0);
    // The 30 day window changes the numbers.
    await user.selectOptions(screen.getByLabelText("Window"), "30");
    await waitFor(
      () =>
        expect(screen.getByTestId("impact-summary")).not.toHaveTextContent(
          `of ${want.total} requests`,
        ),
      SLOW,
    );
  });

  it("asks for a second person when a rule reaches a Global brain, and confirms it when someone else asked", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("secondary.mock.rules.other", "1");
    editor("r_2");
    await screen.findByDisplayValue("A client name in a Global candidate is blocked");
    await user.type(screen.getByRole("textbox", { name: "Rule name" }), " today");
    const publish = await screen.findByRole("button", { name: "Publish v2" }, SLOW);
    await waitFor(() => expect(publish).toBeEnabled(), SLOW);
    await user.click(publish);
    // Someone else asked first: this person sees the confirm state.
    const confirm = await screen.findByRole("button", { name: "Confirm publish v2" }, SLOW);
    expect(screen.getByTestId("rule-pending")).toHaveTextContent("Waiting for you");
    await waitFor(() => expect(confirm).toBeEnabled(), SLOW);
    await user.click(confirm);
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Publish v3" })).toBeInTheDocument(),
      SLOW,
    );
    expect(screen.getByText(/v2 · edited by/)).toBeInTheDocument();
  });
});

describe("rules list", () => {
  it("shows counts, the read-only floor row first, the hard floors and held actions", async () => {
    render(
      <AppProvider>
        <RulesPage />
      </AppProvider>,
    );
    const counts = await screen.findByTestId("rule-counts", {}, SLOW);
    expect(counts).toHaveTextContent("4");
    expect(counts).toHaveTextContent("+2 since");
    expect(counts).toHaveTextContent("3 enforced");
    expect(counts).toHaveTextContent("1 monitor · 0 draft");
    const list = screen.getByTestId("rule-list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Always on: agent proposals in shared brains need review");
    expect(within(list).getAllByTestId("rule-row")).toHaveLength(4);
    expect(screen.getByTestId("rule-floors")).toHaveTextContent("Hard floors");
    expect(within(screen.getByTestId("rule-floors")).getAllByRole("listitem")).toHaveLength(7);
    expect(within(screen.getByTestId("rule-holds")).getAllByTestId("rule-hold")).toHaveLength(2);
  });

  it("gives a person with no rules surface a 404", async () => {
    window.localStorage.setItem("secondary.persona", "consultant");
    await expect(rulesApi.list()).rejects.toMatchObject({ status: 404 });
    await expect(rulesApi.list()).rejects.toBeInstanceOf(ApiError);
    // A steward gets her brain's list: the tenant rule that reaches it is read only.
    window.localStorage.setItem("secondary.persona", "head_bid");
    const list = await rulesApi.list("c_bid");
    expect(list.brain).toEqual({ id: "c_bid", label: "Bid & Pre-sales" });
    expect(list.rules[0]?.id).toBe("floor:mcp_review");
    expect(list.rules.find((r) => r.id === "r_3")?.editable).toBe(false);
    expect(list.rules.find((r) => r.id === "r_5")?.editable).toBe(true);
    await expect(rulesApi.list("c_delivery")).rejects.toMatchObject({ status: 404 });
  });
});

describe("rules i18n (v7.*)", () => {
  const same = new Set([
    "v7.version", // "v{n}"
    "v7.hist.by", // "{who} · {when}"
    "v7.val.actor.claude",
    "v7.val.actor.chatgpt",
    "v7.val.actor.dust",
    "v7.val.actor.codex",
    "v7.val.actor.copilot",
    "v7.val.brain_type.global",
    "v7.scope.type.global",
    "v7.field.action",
    "v7.ed.min", // "min"
    "v7.ed.message", // "Message"
  ]);
  it("defines the same keys and {placeholders} in both languages, in the main dictionaries too", () => {
    expect(Object.keys(v7Fr).sort()).toEqual(Object.keys(v7En).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(v7En) as (keyof typeof v7En)[]) {
      expect(vars(v7Fr[k]), k).toEqual(vars(v7En[k]));
      expect(en[k], k).toBe(v7En[k]);
      expect(fr[k], k).toBe(v7Fr[k]);
    }
  });
  it("translates every French value except same-word cases, and never uses an em dash", () => {
    const untranslated = (Object.keys(v7En) as (keyof typeof v7En)[]).filter(
      (k) => v7En[k] === v7Fr[k] && !same.has(k),
    );
    expect(untranslated).toEqual([]);
    for (const v of [...Object.values(v7En), ...Object.values(v7Fr)]) expect(v).not.toContain("—");
  });
});
