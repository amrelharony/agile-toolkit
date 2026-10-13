import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReaderToolbar } from "@/app/(tools)/agile-at-work/components/reader-toolbar";

/**
 * The page scrubber's keyboard steps in spread mode. The thumb sits on the
 * view's first page, so a plain "+1 page" step from the "2–3" spread would
 * land on page 3 — already on screen — and never leave the spread.
 */

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function renderToolbar(view: number[], spread: boolean) {
  const onNext = vi.fn();
  const onPrev = vi.fn();
  const onGoTo = vi.fn();
  render(
    <ReaderToolbar
      numPages={24}
      view={view}
      spread={spread}
      onPrev={onPrev}
      onNext={onNext}
      onGoTo={onGoTo}
      mode={spread ? "spread" : "single"}
      onModeChange={() => {}}
      isFullscreen={false}
      onToggleFullscreen={() => {}}
      src="/comics/agile-at-work.pdf"
      size={null}
    />
  );
  const thumb = screen.getByRole("slider", { name: "Go to page" });
  act(() => thumb.focus());
  return { thumb, onNext, onPrev, onGoTo };
}

describe("ReaderToolbar scrubber keyboard", () => {
  it("steps forward by a whole spread", () => {
    const { thumb, onNext, onGoTo } = renderToolbar([2, 3], true);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onGoTo).not.toHaveBeenCalled();
  });

  it("steps back by a whole spread, anchored like the Prev button", () => {
    const { thumb, onNext, onPrev, onGoTo } = renderToolbar([4, 5], true);
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onGoTo).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("still jumps straight to a page with Home in a spread", () => {
    const { thumb, onPrev, onGoTo } = renderToolbar([4, 5], true);
    fireEvent.keyDown(thumb, { key: "Home" });
    expect(onGoTo).toHaveBeenCalledWith(1);
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("steps one page at a time in single-page mode", () => {
    const { thumb, onNext, onGoTo } = renderToolbar([2], false);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onGoTo).toHaveBeenCalledWith(3);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("does not leave a keyboard preview behind in the label", () => {
    const { thumb } = renderToolbar([2], false);
    fireEvent.keyDown(thumb, { key: "End" });
    // The parent never moved the view (onGoTo is a spy), so the label and
    // the thumb still show the real page rather than a stale preview.
    expect(screen.getByText("Page 2 of 24")).toBeInTheDocument();
    expect(thumb).toHaveAttribute("aria-valuenow", "2");
  });
});
