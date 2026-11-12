import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Wall mode on top of Present mode: large, refreshing by itself, nothing to
 * press, and gone when Present mode ends. The Sprint Cockpit wires its own
 * (P1.12); this is the reusable piece and its button.
 */

import {
  WALL_VIEW_MIN_REFRESH_MS,
  WallView,
  WallViewButton,
} from "@/components/presentation/wall-view";
import {
  PresentationController,
  usePresentation,
} from "@/components/presentation/presentation-mode";

const NOW = Date.parse("2026-11-12T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  act(() => usePresentation.getState().set(false));
});
afterEach(() => {
  vi.useRealTimers();
  act(() => usePresentation.getState().set(false));
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** An example dashboard: what the Cockpit would put on the wall. */
function ExampleTiles({ n, now }: { n: number; now: number }) {
  return (
    <ul aria-label="Sprint tiles">
      <li>Done: {12 + n} points</li>
      <li>Refreshed {new Date(now).toISOString()}</li>
      <li>
        <button type="button">Edit</button>
      </li>
    </ul>
  );
}

describe("WallViewButton", () => {
  it("opens the wall in Present mode, large, with nothing to press", () => {
    render(
      <>
        <WallViewButton title="Sprint 42">
          {({ n, now }) => <ExampleTiles n={n} now={now} />}
        </WallViewButton>
        <PresentationController />
      </>
    );
    expect(document.querySelector("[data-wall-view]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    expect(usePresentation.getState().presenting).toBe(true);
    expect(screen.getByRole("heading", { name: "Sprint 42" })).toBeInTheDocument();
    const content = document.querySelector("[data-wall-content]") as HTMLElement;
    expect(content).toHaveAttribute("inert");
    expect(content).toHaveClass("pointer-events-none", "select-none");
    expect(content).toHaveTextContent("Done: 12 points");
  });

  it("refreshes by itself on its interval, and tells the page to re-read", () => {
    const onRefresh = vi.fn();
    render(
      <WallViewButton title="Sprint 42" refreshMs={30_000} onRefresh={onRefresh}>
        {({ n, now }) => <ExampleTiles n={n} now={now} />}
      </WallViewButton>
    );
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    expect(onRefresh).not.toHaveBeenCalled();
    advance(30_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-wall-content]")).toHaveTextContent("Done: 13 points");
    expect(document.querySelector("[data-wall-content]")).toHaveTextContent(
      new Date(NOW + 30_000).toISOString()
    );
    advance(30_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("never refreshes faster than every 5 seconds", () => {
    const onRefresh = vi.fn();
    render(
      <WallViewButton title="Sprint 42" refreshMs={100} onRefresh={onRefresh}>
        <p>Tiles</p>
      </WallViewButton>
    );
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    advance(WALL_VIEW_MIN_REFRESH_MS - 1);
    expect(onRefresh).not.toHaveBeenCalled();
    advance(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("closes with Present mode: Exit presentation, or Escape", () => {
    render(
      <>
        <WallViewButton title="Sprint 42">
          <p>Tiles</p>
        </WallViewButton>
        <PresentationController />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    fireEvent.click(screen.getByRole("button", { name: /Exit presentation/ }));
    expect(document.querySelector("[data-wall-view]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Wall mode" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-wall-view]")).toBeNull();
    expect(usePresentation.getState().presenting).toBe(false);
  });
});

describe("WallView", () => {
  it("renders nothing while closed, and stops refreshing once closed", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <WallView open={false} onClose={() => {}} title="Sprint 42" onRefresh={onRefresh}>
        <p>Tiles</p>
      </WallView>
    );
    expect(document.querySelector("[data-wall-view]")).toBeNull();
    rerender(
      <WallView open onClose={() => {}} title="Sprint 42" onRefresh={onRefresh} refreshMs={10_000}>
        <p>Tiles</p>
      </WallView>
    );
    expect(screen.getByText("Tiles")).toBeInTheDocument();
    rerender(
      <WallView
        open={false}
        onClose={() => {}}
        title="Sprint 42"
        onRefresh={onRefresh}
        refreshMs={10_000}
      >
        <p>Tiles</p>
      </WallView>
    );
    advance(60_000);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(usePresentation.getState().presenting).toBe(false);
  });
});
