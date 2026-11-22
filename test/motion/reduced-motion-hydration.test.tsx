/**
 * Reduced motion must not change the first client render.
 *
 * The server can't read media queries, so it renders every page as if none
 * matches. A component that read `prefers-reduced-motion` during its first
 * client render (framer-motion's `useReducedMotion`, or a `useState`
 * initialiser calling `matchMedia`) drew different markup at hydration for
 * anyone with the setting on: the header's kudos beacon threw React #418
 * (four times) and #423 on every page, and the whole root fell back to a
 * client render.
 *
 * Each test renders the server HTML while nothing matches, then turns the
 * setting on (as the visitor's browser has it) before hydrating, and checks
 * that hydration raises nothing and the reduced variant still lands after.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));

import { useMediaQuery, usePrefersReducedMotion } from "@/hooks/use-media-query";
import { KudosHeaderBeacon } from "@/lib/kudos/beacon/header-beacon";

type Listener = (e: { matches: boolean; media: string }) => void;

/**
 * A matchMedia whose answers can change while the page runs: `.matches` is
 * live, and listeners hear a "change" when their query's answer flips (as
 * framer-motion's own listener does).
 */
function controllableMedia() {
  let matching: (query: string) => boolean = () => false;
  const listeners = new Map<Listener, string>();
  const matchMedia = (query: string) => ({
    media: query,
    get matches() {
      return matching(query);
    },
    onchange: null,
    addEventListener: (_type: string, cb: Listener) => void listeners.set(cb, query),
    removeEventListener: (_type: string, cb: Listener) => void listeners.delete(cb),
    addListener: (cb: Listener) => void listeners.set(cb, query),
    removeListener: (cb: Listener) => void listeners.delete(cb),
    dispatchEvent: () => false,
  });
  return {
    matchMedia,
    set(next: (query: string) => boolean) {
      const entries = Array.from(listeners.entries());
      const before = entries.map(([, q]) => matching(q));
      matching = next;
      entries.forEach(([cb, q], i) => {
        if (before[i] !== matching(q)) cb({ matches: matching(q), media: q });
      });
    },
  };
}

const media = controllableMedia();
const NOTHING = () => false;
/** Both spellings: framer-motion asks "(prefers-reduced-motion)". */
const REDUCED = (q: string) => /\(prefers-reduced-motion(\s*:\s*reduce)?\)/.test(q);

/** The server's HTML: rendered while no media query matches. */
function serverHtml(element: ReactElement): string {
  media.set(NOTHING);
  return renderToString(element);
}

/** Hydrates `html` with `element`, and reports what React complained about. */
async function hydrate(element: ReactElement, html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const recoverable = vi.fn();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: recoverable });
    });
  } finally {
    errors.mockRestore();
  }
  const mismatches = errors.mock.calls
    .map((args) => args.map(String).join(" "))
    .filter((line) => /did not match|hydrat|Expected server HTML/i.test(line));
  return {
    container,
    recoverable,
    mismatches,
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

beforeAll(() => {
  vi.stubGlobal("matchMedia", media.matchMedia);
});

afterEach(() => {
  cleanup();
  media.set(NOTHING);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function Probe({ seen }: { seen?: boolean[] }) {
  const reduce = usePrefersReducedMotion();
  seen?.push(reduce);
  return <span data-testid="probe">{reduce ? "still" : "moving"}</span>;
}

function Wide() {
  return <span data-testid="wide">{String(useMediaQuery("(min-width: 768px)"))}</span>;
}

describe("useMediaQuery", () => {
  it("is false in the server's render, whatever the browser would say", () => {
    media.set(REDUCED);
    expect(renderToString(<Probe />)).toContain("moving");
  });

  it("hydrates as the server rendered, then takes the browser's answer", async () => {
    const html = serverHtml(<Probe />);
    media.set(REDUCED);
    const seen: boolean[] = [];
    const h = await hydrate(<Probe seen={seen} />, html);
    try {
      expect(h.recoverable).not.toHaveBeenCalled();
      expect(h.mismatches).toEqual([]);
      expect(seen[0]).toBe(false);
      expect(h.container.textContent).toBe("still");
    } finally {
      h.unmount();
    }
  });

  it("gives a component mounted after hydration the real answer on its first render", () => {
    media.set(REDUCED);
    const seen: boolean[] = [];
    render(<Probe seen={seen} />);
    // No flash of the moving variant first (BUG-W31).
    expect(seen[0]).toBe(true);
    expect(screen.getByTestId("probe")).toHaveTextContent("still");
  });

  it("follows the setting when it changes", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("moving");
    act(() => media.set(REDUCED));
    expect(screen.getByTestId("probe")).toHaveTextContent("still");
    act(() => media.set(NOTHING));
    expect(screen.getByTestId("probe")).toHaveTextContent("moving");
  });

  it("is false where matchMedia doesn't exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    try {
      render(<Wide />);
      expect(screen.getByTestId("wide")).toHaveTextContent("false");
    } finally {
      vi.stubGlobal("matchMedia", media.matchMedia);
    }
  });
});

describe("the header's kudos beacon (on every page)", () => {
  const beacon = (c: HTMLElement) => c.querySelector("#kudos-header-beacon") as HTMLElement;
  const pulseWrapper = (c: HTMLElement) => beacon(c).querySelector(":scope > span.inline-flex");
  const bareIcon = (c: HTMLElement) => beacon(c).querySelector(":scope > svg");

  it("hydrates without a mismatch when the visitor has reduced motion on", async () => {
    const html = serverHtml(<KudosHeaderBeacon />);
    media.set(REDUCED);
    const h = await hydrate(<KudosHeaderBeacon />, html);
    try {
      expect(h.recoverable).not.toHaveBeenCalled();
      expect(h.mismatches).toEqual([]);
      // The still icon (no pulse wrapper) once hydration is done.
      expect(pulseWrapper(h.container)).toBeNull();
      expect(bareIcon(h.container)).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("hydrates without a mismatch and keeps the pulse when reduced motion is off", async () => {
    const html = serverHtml(<KudosHeaderBeacon />);
    const h = await hydrate(<KudosHeaderBeacon />, html);
    try {
      expect(h.recoverable).not.toHaveBeenCalled();
      expect(h.mismatches).toEqual([]);
      expect(pulseWrapper(h.container)).not.toBeNull();
    } finally {
      h.unmount();
    }
  });
});
