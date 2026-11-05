import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContributeSheet } from "../components/ContributeSheet";
import { scanSensitive } from "../sensitive";
import type { PersonalItem } from "../types";

const item: PersonalItem = {
  id: "p_head_bid_1",
  kind: "note",
  title: "Retail renewal points",
  updatedAt: "2026-11-03T18:20:00Z",
  body: "Saved EUR 120,000 per year, under NDA. Contact: sample.contact@example.invalid",
};

describe("Contribute to Company", () => {
  it("flags sensitive spans before sharing", () => {
    const kinds = scanSensitive(`${item.title}\n${item.body}`).map((f) => f.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["Amount", "Confidentiality marker", "Email address"]),
    );
  });

  it("shows flagged spans and requires the confirm checkbox before sending", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ContributeSheet item={item} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByText("sample.contact@example.invalid")).toBeInTheDocument();
    expect(screen.getByText("EUR 120,000")).toBeInTheDocument();

    const send = screen.getByRole("button", { name: "Send for review" });
    expect(send).toBeDisabled();

    const select = await screen.findByLabelText("Company scope");
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, "c_bid");
    expect(send).toBeDisabled();

    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(send).toBeEnabled();

    await user.click(box);
    expect(send).toBeDisabled();
  });

  it("does not send without a scope, even when confirmed", async () => {
    const user = userEvent.setup();
    render(<ContributeSheet item={item} onClose={vi.fn()} onDone={vi.fn()} />);
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Send for review" })).toBeDisabled();
  });
});
