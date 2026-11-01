import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HowItWorks } from "@/components/tool-frame/how-it-works";

describe("HowItWorks", () => {
  it("shows the method guide for a tool", async () => {
    render(<HowItWorks toolId="wsjf" />);
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
    expect(await screen.findByText(/cost of delay ÷ job size/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /modified Fibonacci/ })).toBeInTheDocument();
  });

  it("renders nothing for tools without a guide", async () => {
    const { container } = render(<HowItWorks toolId="comics" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders its header at once, collapsed, so the page doesn't shift when the guide loads", async () => {
    const { container } = render(<HowItWorks toolId="kanban" />);
    // Before the guide text arrives the header is already in place.
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect((await screen.findAllByText(/The Sprint board shows/)).length).toBeGreaterThan(0);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});
