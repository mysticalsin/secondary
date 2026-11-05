import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../views/brains/api";
import { ImportWizard } from "../views/brains/Import";
import type { BrainHome, ImportPreview } from "../views/brains/types";

vi.mock("../state", () => ({ useApp: () => ({ say: vi.fn(), epoch: 0, me: null }) }));

const preview: ImportPreview = {
  ok: true,
  dryRun: true,
  format: "okf",
  pages: [
    {
      path: "topic/a.md",
      pageId: "alpha",
      title: "Alpha page",
      type: "topic",
      verdict: "ingest",
      reason: "Work content, nothing sensitive found",
      excluded: {},
      replaces: false,
      state: "draft",
    },
    {
      path: "topic/b.md",
      pageId: "beta",
      title: "Beta contact",
      type: "topic",
      verdict: "ask",
      reason: "Contains contact details; they would be masked",
      excluded: {},
      replaces: true,
      state: "draft",
    },
  ],
  skipped: [{ path: "topic/hr.md", reason: "HR matter" }],
  asked: 1,
};

const brain = { id: "c_bid", type: "team", name: "Bid & Pre-sales" } as unknown as BrainHome;

beforeEach(() => vi.restoreAllMocks());

describe("Import wizard shows the verdicts before anything is submitted", () => {
  it("runs a dry run on the check step and only imports on the final button", async () => {
    const spy = vi.spyOn(api, "importArchive").mockImplementation((async (
      _id: string,
      _f: string,
      _file: File,
      dry?: true,
    ) =>
      dry
        ? preview
        : {
            ok: true,
            format: "okf",
            imported: [{ pageId: "alpha", title: "Alpha page", state: "draft", proposalId: "p1" }],
            skipped: [],
            asked: 1,
          }) as typeof api.importArchive);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ImportWizard b={brain} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.upload(
      document.querySelector("#imp-file") as HTMLInputElement,
      new File(["PK"], "vault.zip", { type: "application/zip" }),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    const box = await screen.findByTestId("import-preview");
    expect(box).toHaveTextContent("Alpha page");
    expect(box).toHaveTextContent("Contains contact details");
    expect(box).toHaveTextContent("Edit proposal for an existing page");
    expect(box).toHaveTextContent("HR matter");
    // Only the dry run has happened.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[3]).toBe(true);
    await user.click(screen.getByRole("button", { name: "Run the import" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[3]).toBeUndefined();
    expect(await screen.findByTestId("import-results")).toBeVisible();
  });

  it("keeps the import button off while the check runs and when the check fails", async () => {
    vi.spyOn(api, "importArchive").mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ImportWizard b={brain} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.upload(
      document.querySelector("#imp-file") as HTMLInputElement,
      new File(["PK"], "vault.zip"),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Run the import" })).toBeDisabled();
  });
});
