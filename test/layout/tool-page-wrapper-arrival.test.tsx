/**
 * ToolPageWrapper's entrance when a card's frame lands on its header: the
 * frame is the entrance, so the root leaves motion-safe:animate-rise out. It
 * decides once, on its first render, so a later render (after the change has
 * ended and the flag is gone) never adds the rise back, which would make the
 * page jump after the frame landed. A change skipped at the cap clears the
 * flag before the late page renders, so that page rises (and its header
 * grows, test/motion/grow-from.test.tsx). Without a card, nothing changes:
 * the root is what the server renders (test/design/rise-animation.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import TransitionLink from "@/components/motion/transition-link";
import {
  HOLD_CAP_MS,
  isFrameLanding,
  notifyRouteCommitted,
  registerNavigator,
} from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import {
  flush,
  installViewTransitions,
  removeViewTransitions,
} from "../motion/fake-view-transitions";

const SERVER_ROOT = ["container-tool", "isolate", "motion-safe:animate-rise"];

function Page({ title = "Kanban Board" }: { title?: string }) {
  return (
    <ToolPageWrapper title={title} description="Visualise work" showInsights={false}>
      <p>Board</p>
    </ToolPageWrapper>
  );
}

const rootClasses = (container: HTMLElement) =>
  (container.firstElementChild as HTMLElement).className.split(/\s+/).filter(Boolean);

let unregister = () => {};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  unregister = registerNavigator({ push: vi.fn(), replace: vi.fn() });
});

afterEach(async () => {
  skipViewTransition();
  notifyRouteCommitted("/__test-end");
  await flush();
  cleanup();
  unregister();
  vi.useRealTimers();
  removeViewTransitions();
});

/** Taps a card's main link that may frame; the card is removed again, as the old page goes. */
function tapCard() {
  const vt = installViewTransitions();
  const { unmount } = render(
    <div data-vt-card="">
      <TransitionLink href="/kanban" frame>
        Kanban
      </TransitionLink>
    </div>
  );
  fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
  unmount();
  return vt;
}

describe("the server render", () => {
  it("is unchanged: the rise is there", () => {
    const html = renderToString(<Page />);
    const classes = /^<div class="([^"]*)"/.exec(html)![1].split(/\s+/);
    expect(classes).toEqual(SERVER_ROOT);
  });
});

describe("when a card's frame lands", () => {
  it("the root leaves the rise out, keeps container-tool and isolate, and gains nothing else", async () => {
    tapCard();
    expect(isFrameLanding()).toBe(true);
    const { container } = render(<Page />);
    expect(rootClasses(container)).toEqual(["container-tool", "isolate"]);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttributeNames().sort()).toEqual(["class"]);
  });

  it("stays without the rise when it renders again after the flag has gone", async () => {
    const { made } = tapCard();
    await flush();
    window.history.replaceState(null, "", "/kanban");
    const { container, rerender } = render(<Page />);
    notifyRouteCommitted("/kanban");
    await flush();
    made[0].endAnimation();
    await flush();
    expect(isFrameLanding()).toBe(false);
    rerender(<Page title="Kanban Board, renamed" />);
    expect(screen.getByRole("heading", { name: "Kanban Board, renamed" })).toBeInTheDocument();
    expect(rootClasses(container)).toEqual(["container-tool", "isolate"]);
  });
});

describe("when the change is skipped at the cap", () => {
  it("the flag is cleared before the late page renders, so it rises", async () => {
    vi.useFakeTimers();
    tapCard();
    await vi.advanceTimersByTimeAsync(HOLD_CAP_MS);
    expect(isFrameLanding()).toBe(false);
    const { container } = render(<Page />);
    expect(rootClasses(container)).toEqual(SERVER_ROOT);
  });
});

describe("without a card", () => {
  it("leaves the root exactly as the server renders it", () => {
    const { container } = render(<Page />);
    expect(rootClasses(container)).toEqual(SERVER_ROOT);
  });

  it("after a plain link's change, too", () => {
    installViewTransitions();
    render(<TransitionLink href="/kanban">Kanban</TransitionLink>);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(isFrameLanding()).toBe(false);
    const { container } = render(<Page />);
    expect(rootClasses(container)).toEqual(SERVER_ROOT);
  });
});
