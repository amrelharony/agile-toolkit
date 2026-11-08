import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  PresentButton,
  PresentationController,
  usePresentation,
} from "@/components/presentation/presentation-mode";

beforeEach(() => {
  act(() => usePresentation.getState().set(false));
});

describe("presentation mode", () => {
  it("marks the page as presenting, offers a way out, and ends on Escape", () => {
    render(
      <>
        <PresentButton />
        <PresentationController />
      </>
    );
    expect(document.documentElement.dataset.presenting).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(document.documentElement.dataset.presenting).toBe("true");
    expect(screen.getByRole("button", { name: /Exit presentation/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.documentElement.dataset.presenting).toBeUndefined();
    expect(screen.queryByRole("button", { name: /Exit presentation/ })).toBeNull();
  });

  it("on phones Exit is a 44px icon that keeps its name, in a strip clear of the title", () => {
    const { container } = render(<PresentationController />);
    expect(container.querySelector("[data-exit-strip]")).toBeNull();
    act(() => usePresentation.getState().set(true));

    const exit = screen.getByRole("button", { name: "Exit presentation (Escape)" });
    expect(exit).toHaveClass("fixed", "max-sm:size-11", "max-sm:px-0");
    // The visible label hides below sm only; screen readers always hear it.
    expect(screen.getByText("Exit presentation")).toHaveClass("max-sm:sr-only");

    const strip = container.querySelector("[data-exit-strip]");
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip).toHaveClass("h-14", "max-sm:block");
  });

  it("keeps the strip on touch screens of any width, where Exit is 44px tall", () => {
    const { container } = render(<PresentationController />);
    act(() => usePresentation.getState().set(true));

    const strip = container.querySelector("[data-exit-strip]");
    // Landscape phones and tablets are >= sm but still touch: the strip stays.
    expect(strip).toHaveClass("pointer-coarse:block");
    // Mouse screens from sm up (desktop) get no strip, so they look the same.
    expect(strip).toHaveClass("hidden");
    expect(strip?.className).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl|2xl):block\b/);
    expect(strip?.className).not.toContain("pointer-fine:block");
  });

  it("ends from the Exit button", () => {
    render(<PresentationController />);
    act(() => usePresentation.getState().set(true));
    fireEvent.click(screen.getByRole("button", { name: /Exit presentation/ }));
    expect(usePresentation.getState().presenting).toBe(false);
  });
});
