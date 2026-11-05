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
      { type: "Callout", props: { template: "empty", tone: "info" } },
      { type: "NodeCard", props: {} },
      { type: "Callout", props: { template: "gap", tone: "warning" } },
      { type: "Callout", props: { template: "free_text_not_a_template" } },
      { type: "NodeCard", props: { nodeId: "c_bid", extra: "not in the schema" } },
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
    expect(screen.getByText(/Nothing to show here yet/)).toBeInTheDocument();
    expect(screen.getByText(/knowledge gap/i)).toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });

  it("shows a safe message for an invalid plan", () => {
    render(<ViewRenderer plan={{ nope: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not valid/i);
  });

  it("a callout shows fixed text chosen by key, never plan text", () => {
    render(
      <ViewRenderer
        plan={{
          version: 1,
          title: "x",
          components: [
            {
              type: "Callout",
              props: { template: "no_access", text: "<img src=x onerror=alert(1)>" },
            },
            { type: "Callout", props: { template: "no_access" } },
          ],
        }}
      />,
    );
    // The first carries a key outside the schema, so it is dropped. The second shows the fixed text.
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.queryByText(/onerror/)).not.toBeInTheDocument();
  });
});
