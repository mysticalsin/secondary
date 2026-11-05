import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { ContributeSheet } from "../components/ContributeSheet";
import { detectSensitivity } from "../mock/sensitive";
import { AppProvider } from "../state";
import type { PersonalItem } from "../types";

const draft = {
  title: "Retail renewal points",
  body: "Escalate to the family office. Contact: sample.contact@example.invalid",
};

function itemOf(over: Partial<PersonalItem> = {}): PersonalItem {
  return {
    id: "p_1",
    kind: "note",
    updatedAt: "2026-11-03T18:20:00Z",
    revision: 1,
    status: "draft",
    sensitivity_flags: detectSensitivity(draft),
    ...draft,
    ...over,
  };
}

const renderSheet = (item: PersonalItem, onDone = vi.fn()) =>
  render(
    <AppProvider>
      <ContributeSheet item={item} onClose={vi.fn()} onDone={onDone} />
    </AppProvider>,
  );

describe("Contribute to Company", () => {
  it("shows the server's flags (id, type, excerpt) before sharing", () => {
    renderSheet(itemOf());
    expect(screen.getByText("sample.contact@example.invalid")).toBeInTheDocument();
    expect(screen.getByText("Email address")).toBeInTheDocument();
    expect(screen.getByText("Family or private life")).toBeInTheDocument();
  });

  it("requires a scope and the confirmation, and sends the validation with each flag acknowledged", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const created = await api.personalCreate({ ...draft, kind: "note" });
    const spy = vi.spyOn(api, "contribute");
    renderSheet(created, onDone);

    const send = screen.getByRole("button", { name: "Send for review" });
    expect(send).toBeDisabled();
    const select = await screen.findByLabelText("Company scope");
    await waitFor(() => expect(select).toBeEnabled());
    const options = Array.from((select as HTMLSelectElement).options).filter((o) => o.value);
    expect(options.length).toBeGreaterThan(0);
    await user.selectOptions(select, options[0]?.value as string);
    expect(send).toBeDisabled();

    const box = screen.getByRole("checkbox");
    await user.click(box);
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(box);
    expect(send).toBeDisabled();
    await user.click(box);

    await user.click(send);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [, body] = spy.mock.calls[0] ?? [];
    expect(body?.acknowledged_flags).toEqual(created.sensitivity_flags.map((f) => f.id));
    expect(body?.user_validated).toMatchObject({ revision: created.revision });
    expect(body?.user_validated.by).toMatch(/^u_/);
    expect(Number.isNaN(Date.parse(body?.user_validated.at ?? ""))).toBe(false);
  });

  it("does not send without a scope, even when confirmed", async () => {
    const user = userEvent.setup();
    renderSheet(itemOf());
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Send for review" })).toBeDisabled();
  });
});
