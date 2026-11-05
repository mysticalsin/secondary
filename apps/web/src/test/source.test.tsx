import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";
import { AppProvider } from "../state";
import { SourceView } from "../views/SourceView";

afterEach(() => vi.restoreAllMocks());

const record = {
  id: "src:sp_alpha:0123456789abcdef01234567",
  title: "Delivery handbook",
  kind: "source" as const,
  plane: "TEAM_RESTRICTED" as const,
  webUrl: "https://example.invalid/sites/delivery/handbook.md",
  mime: "text/markdown",
  size: 2048,
  body: "Step one\n<script>alert(1)</script>",
  syncedAt: Date.UTC(2026, 10, 4),
};

const page = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/sources/${encodeURIComponent(id)}`]}>
      <AppProvider>
        <Routes>
          <Route path="sources/:id" element={<SourceView />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );

describe("source files", () => {
  it("renders a synced file as text with a link to the source", async () => {
    vi.spyOn(api, "source").mockResolvedValue(record);
    page(record.id);
    expect(await screen.findByRole("heading", { name: "Delivery handbook" })).toBeInTheDocument();
    // The body is text, never markup.
    expect(screen.getByText(/Step one/)).toHaveTextContent("<script>alert(1)</script>");
    expect(document.querySelector("script")).toBeNull();
    const link = screen.getByRole("link", { name: /Open in source/ });
    expect(link).toHaveAttribute("href", record.webUrl);
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("never links a non-web address", async () => {
    vi.spyOn(api, "source").mockResolvedValue({ ...record, webUrl: "javascript:alert(1)" });
    page(record.id);
    await screen.findByRole("heading", { name: "Delivery handbook" });
    expect(screen.queryByRole("link", { name: /Open in source/ })).toBeNull();
  });

  it("says the source permission could not be confirmed", async () => {
    vi.spyOn(api, "source").mockRejectedValue(
      new ApiError(403, "source permission could not be confirmed"),
    );
    page(record.id);
    expect(await screen.findByText(/could not be confirmed at the source/)).toBeInTheDocument();
  });
});
