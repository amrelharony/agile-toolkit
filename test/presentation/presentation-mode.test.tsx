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

  it("ends from the Exit button", () => {
    render(<PresentationController />);
    act(() => usePresentation.getState().set(true));
    fireEvent.click(screen.getByRole("button", { name: /Exit presentation/ }));
    expect(usePresentation.getState().presenting).toBe(false);
  });
});
