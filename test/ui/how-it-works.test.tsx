import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("ends the open guide with Hide guide, which closes it and goes back to the header", async () => {
    const { container } = render(<HowItWorks toolId="wsjf" />);
    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    await screen.findByText(/cost of delay ÷ job size/);
    details.open = true;

    const hide = screen.getByRole("button", { name: "Hide guide" });
    // It comes after the guide's last section, so it's where a reader ends up.
    const sections = Array.from(details.querySelectorAll("h3"));
    expect(
      sections[sections.length - 1].compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(hide);
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });

  it("brings the header back clear of the sticky app bar, not under it", () => {
    // Firefox scrolls a focused element to the nearest edge (the top), where
    // the sticky header sits; the scroll margin keeps the summary below it.
    const { container } = render(<HowItWorks toolId="wsjf" />);
    expect(container.querySelector("summary")).toHaveClass("scroll-mt-20");
  });

  it("keeps desktop as it was: the Hide guide row is gone from lg up", async () => {
    render(<HowItWorks toolId="wsjf" />);
    const hide = await screen.findByRole("button", { name: "Hide guide" });
    expect(hide).toHaveAttribute("type", "button");
    expect(hide.parentElement).toHaveClass("lg:hidden");
  });
});
