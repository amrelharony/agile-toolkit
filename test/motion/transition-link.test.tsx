/**
 * TransitionLink is next/link plus a cross-fade. It renders next/link's own
 * anchor, leaves every click a page change may not take to next/link or the
 * browser, and calls no next/navigation hook, so it works where no app router
 * is mounted (the card tests render it bare). Nothing here mocks
 * next/navigation.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import TransitionLink from "@/components/motion/transition-link";
import { registerNavigator, notifyRouteCommitted } from "@/lib/motion/page-transition";
import { skipViewTransition } from "@/lib/motion/view-transition";
import { flush, installViewTransitions, removeViewTransitions } from "./fake-view-transitions";

const ROOT = path.resolve(__dirname, "../..");

function appRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  };
}

/** Whether the click reached the browser unprevented; stops jsdom's own navigation after. */
const reachedBrowser: boolean[] = [];
function watchBrowser(event: Event) {
  reachedBrowser.push(!event.defaultPrevented);
  event.preventDefault();
}

beforeEach(() => {
  reachedBrowser.length = 0;
  window.addEventListener("click", watchBrowser);
  window.history.replaceState(null, "", "/");
});

afterEach(async () => {
  skipViewTransition();
  notifyRouteCommitted("/__test-end");
  await flush();
  cleanup();
  window.removeEventListener("click", watchBrowser);
  removeViewTransitions();
  vi.restoreAllMocks();
});

function withRouter(router: ReturnType<typeof appRouter>, ui: ReactNode) {
  return <AppRouterContext.Provider value={router}>{ui}</AppRouterContext.Provider>;
}

describe("the source", () => {
  const src = readFileSync(path.join(ROOT, "src/components/motion/transition-link.tsx"), "utf8");

  it("imports nothing from next/navigation and calls no router hook", () => {
    expect(src).not.toMatch(/from\s+["']next\/navigation["']/);
    expect(src).not.toMatch(/\b(useRouter|usePathname|useSearchParams)\b/);
  });

  it("is a default export", () => {
    expect(src).toMatch(/export default TransitionLink;/);
  });
});

describe("what it renders", () => {
  it("renders the same anchor as next/link, without its own prop", () => {
    const props = {
      href: "/retro",
      className: "card-link",
      prefetch: false,
      "aria-label": "Retro",
    };
    const plain = render(<Link {...props}>Retro board</Link>).container.innerHTML;
    cleanup();
    const ours = render(
      <TransitionLink {...props} frame>
        Retro board
      </TransitionLink>
    ).container.innerHTML;
    expect(ours).toBe(plain);
    expect(ours).not.toContain("frame");
  });

  it("forwards its ref to the anchor (Button asChild needs it)", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <TransitionLink ref={ref} href="/retro">
        Retro
      </TransitionLink>
    );
    expect(ref.current).toBe(screen.getByRole("link", { name: "Retro" }));
  });
});

describe("without a registered navigator", () => {
  it("renders and navigates through next/link with no app router at all", () => {
    render(<TransitionLink href="/retro">Retro</TransitionLink>);
    expect(() => fireEvent.click(screen.getByRole("link", { name: "Retro" }))).not.toThrow();
    // next/link leaves a click it has no router for to the browser.
    expect(reachedBrowser).toEqual([true]);
  });

  it("leaves the click to next/link, which pushes on the app router", () => {
    installViewTransitions();
    const router = appRouter();
    render(withRouter(router, <TransitionLink href="/retro">Retro</TransitionLink>));
    fireEvent.click(screen.getByRole("link", { name: "Retro" }));
    expect(router.push).toHaveBeenCalledWith("/retro", { scroll: true });
    expect(document.documentElement.hasAttribute("data-vt")).toBe(false);
  });
});

describe("with a registered navigator", () => {
  let navigator = { push: vi.fn(), replace: vi.fn() };
  let unregister = () => {};

  beforeEach(() => {
    navigator = { push: vi.fn(), replace: vi.fn() };
    unregister = registerNavigator(navigator);
  });
  afterEach(() => unregister());

  it("runs the caller's onClick first, then takes the change over from next/link", async () => {
    const { start } = installViewTransitions();
    const router = appRouter();
    const seen: string[] = [];
    const onClick = vi.fn((event: React.MouseEvent) => {
      seen.push(`caller:${event.defaultPrevented}:${start.mock.calls.length}`);
    });
    render(
      withRouter(
        router,
        <TransitionLink href="/kanban" onClick={onClick}>
          Kanban
        </TransitionLink>
      )
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(seen).toEqual(["caller:false:0"]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(reachedBrowser).toEqual([false]);
    expect(router.push).not.toHaveBeenCalled();
    await flush();
    expect(navigator.push).toHaveBeenCalledWith("/kanban", { scroll: true });
  });

  it("passes replace and scroll on", async () => {
    installViewTransitions();
    render(
      <TransitionLink href="/kanban" replace scroll={false}>
        Kanban
      </TransitionLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    await flush();
    expect(navigator.replace).toHaveBeenCalledWith("/kanban", { scroll: false });
  });

  it("does nothing when the caller's onClick prevents the click", () => {
    const { start } = installViewTransitions();
    const router = appRouter();
    render(
      withRouter(
        router,
        <TransitionLink href="/kanban" onClick={(e) => e.preventDefault()}>
          Kanban
        </TransitionLink>
      )
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(start).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(navigator.push).not.toHaveBeenCalled();
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["the middle button", { button: 1 }],
  ])("leaves a %s click to the browser", (_name, init) => {
    const { start } = installViewTransitions();
    render(<TransitionLink href="/kanban">Kanban</TransitionLink>);
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }), init);
    expect(start).not.toHaveBeenCalled();
    expect(navigator.push).not.toHaveBeenCalled();
    expect(reachedBrowser).toEqual([true]);
  });

  it.each([
    ["target=_blank", { target: "_blank" }],
    ["a download", { download: "" }],
  ])("leaves %s to the browser", (_name, attrs) => {
    const { start } = installViewTransitions();
    render(
      <TransitionLink href="/kanban" {...attrs}>
        Kanban
      </TransitionLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(start).not.toHaveBeenCalled();
    expect(reachedBrowser).toEqual([true]);
  });

  it("never starts a transition for prefetch={false}: next/link changes the page", () => {
    const { start } = installViewTransitions();
    const router = appRouter();
    render(
      withRouter(
        router,
        <TransitionLink href="/comics?ep=30" prefetch={false}>
          Story 30
        </TransitionLink>
      )
    );
    fireEvent.click(screen.getByRole("link", { name: "Story 30" }));
    expect(start).not.toHaveBeenCalled();
    expect(navigator.push).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/comics?ep=30", { scroll: true });
  });

  it("leaves the click to next/link when the change is refused up front", () => {
    // No view transitions in this browser: preventDefault is not called.
    const router = appRouter();
    render(withRouter(router, <TransitionLink href="/kanban">Kanban</TransitionLink>));
    fireEvent.click(screen.getByRole("link", { name: "Kanban" }));
    expect(navigator.push).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/kanban", { scroll: true });
  });
});
