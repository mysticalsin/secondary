import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sanitizePlan } from "../genui/plan";
import { ViewRenderer } from "../genui/ViewRenderer";

describe("GenUI renderer", () => {
  const plan = {
    version: 1,
    title: "Test view",
    components: [
      { type: "Hologram", props: { note: "unknown" } },
      { type: "Callout", props: { text: "Visible callout", tone: "info" } },
      { type: "NodeCard", props: {} },
      { type: "Callout", props: { text: "Second callout", tone: "attention" } },
    ],
  };

  it("drops unknown types and components with invalid props", () => {
    const clean = sanitizePlan(plan);
    expect(clean?.components.map((c) => c.type)).toEqual(["Callout", "Callout"]);
  });

  it("rejects a plan with the wrong version", () => {
    expect(sanitizePlan({ ...plan, version: 2 })).toBeNull();
    expect(sanitizePlan("nope")).toBeNull();
  });

  it("renders only catalog components", () => {
    render(<ViewRenderer plan={plan} />);
    expect(screen.getByText("Visible callout")).toBeInTheDocument();
    expect(screen.getByText("Second callout")).toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });

  it("shows a safe message for an invalid plan", () => {
    render(<ViewRenderer plan={{ nope: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not valid/i);
  });

  it("renders callout text as text, not markup", () => {
    render(
      <ViewRenderer
        plan={{
          version: 1,
          title: "x",
          components: [{ type: "Callout", props: { text: "<img src=x onerror=alert(1)>" } }],
        }}
      />,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});
