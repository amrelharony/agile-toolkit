/**
 * The page behind a playing intro is unreachable (components/intro/intro-inert):
 * the siblings along the overlay's chain of ancestors are inert while it plays,
 * those that mount mid-intro too, what was inert before stays so, an owner's
 * own mid-intro word is kept for the end, and focus still goes back to the
 * opener when it ends, in a browser that won't focus anything inside [inert].
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntroOverlay } from "@/app/(tools)/comics/components/intro/intro-parts";
import { ReplayIntro } from "@/app/(tools)/comics/components/intro/replay-intro";
import {
  INTRO_ATTR,
  INTRO_BOOT_SCRIPT,
  INTRO_RUN_ATTR,
  OVERLAY_ATTR,
  RETURN_ATTR,
} from "@/lib/comics/intro";
import { stopIntro } from "@/lib/comics/play-intro";

const root = document.documentElement;

/** A reduced-motion query whose answer the test can change, telling listeners. */
const motion = {
  matches: false,
  listeners: new Set<() => void>(),
  turnDown() {
    this.matches = true;
    for (const listener of Array.from(this.listeners)) listener();
  },
};

function stubMotion() {
  motion.matches = false;
  motion.listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return motion.matches && query.includes("prefers-reduced-motion");
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => motion.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => motion.listeners.delete(listener),
  }));
}

/** Where focus() was asked to go, and whether that element was inert then. */
let focusCalls: { el: HTMLElement; inert: boolean }[] = [];

/** Like a browser: focus() does nothing to an element inside [inert]. */
function stubFocus() {
  const real = HTMLElement.prototype.focus;
  focusCalls = [];
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions
  ) {
    const inert = this.closest("[inert]") !== null;
    focusCalls.push({ el: this, inert });
    if (!inert) real.call(this, options);
  });
}

/** An app around the book's overlay: a header, a closed drawer, the gallery. */
function Page() {
  return (
    <>
      <header data-testid="header">
        <button type="button">Menu</button>
      </header>
      <aside data-testid="drawer">
        <a href="/retro">Retro</a>
      </aside>
      <main data-testid="main">
        <section data-testid="gallery">
          <ReplayIntro kind="book" />
        </section>
        <IntroOverlay kind="book" label="Agile at Work intro">
          <p>Agile at Work</p>
        </IntroOverlay>
      </main>
    </>
  );
}

function overlay(): HTMLElement {
  return document.querySelector<HTMLElement>(`[${OVERLAY_ATTR}="book"]`)!;
}

/** The MutationObserver reports after the current task's microtasks. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Render the page, close the drawer the way the sidebar does, and replay the intro from its button. */
async function replay() {
  const page = render(<Page />);
  const drawer = screen.getByTestId("drawer");
  drawer.setAttribute("inert", "");
  const button = screen.getByRole("button", { name: "Replay intro" });
  button.focus();
  fireEvent.click(button);
  await settle();
  return { page, drawer, button };
}

beforeAll(() => {
  // As on a page load: the head script installs Skip, Escape and the end.
  window.history.replaceState(null, "", "/retro");
  new Function(INTRO_BOOT_SCRIPT)();
});

beforeEach(() => {
  stubMotion();
  stubFocus();
});

afterEach(() => {
  cleanup();
  root.removeAttribute(INTRO_ATTR);
  root.removeAttribute(INTRO_RUN_ATTR);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("while an intro plays", () => {
  it("makes the siblings along the overlay's ancestors inert, and not the overlay or its ancestors", async () => {
    await replay();
    expect(root.getAttribute(INTRO_ATTR)).toBe("book");
    expect(screen.getByTestId("header")).toHaveAttribute("inert");
    expect(screen.getByTestId("gallery")).toHaveAttribute("inert");
    for (let node: Element | null = overlay(); node; node = node.parentElement) {
      expect(node.hasAttribute("inert"), node.tagName).toBe(false);
    }
    // Inside the overlay nothing is touched: Skip is where focus is.
    expect(overlay().querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Skip intro" }));
  });

  it("holds the page for an arrival's intro too, from the moment it mounts", () => {
    root.setAttribute(INTRO_RUN_ATTR, "0");
    root.setAttribute(INTRO_ATTR, "book");
    render(<Page />);
    expect(screen.getByTestId("header")).toHaveAttribute("inert");
    expect(screen.getByTestId("gallery")).toHaveAttribute("inert");
  });

  it("holds what mounts beside the page mid-intro too, and lets it go at the end", async () => {
    // As the app shell's late parts do: Amr's launcher beside the page's
    // wrapper, and a portal straight into <body>.
    const portal = document.createElement("div");
    try {
      await replay();
      const main = screen.getByTestId("main");
      const late = main.appendChild(document.createElement("button"));
      const ownInert = main.appendChild(document.createElement("div"));
      ownInert.setAttribute("inert", "");
      document.body.appendChild(portal);
      await settle();
      expect(late).toHaveAttribute("inert");
      expect(portal).toHaveAttribute("inert");
      expect(overlay()).not.toHaveAttribute("inert");
      fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
      expect(late).not.toHaveAttribute("inert");
      expect(portal).not.toHaveAttribute("inert");
      // Inert of its own when it came, so it stays inert.
      expect(ownInert).toHaveAttribute("inert");
    } finally {
      portal.remove();
    }
  });

  it("leaves the page alone when no intro of its kind plays", async () => {
    render(<Page />);
    root.setAttribute(INTRO_ATTR, "poster");
    await settle();
    expect(document.querySelector("[inert]")).toBeNull();
  });
});

describe("when it ends", () => {
  it("leaves what was inert before still inert, and releases the rest", async () => {
    const { drawer } = await replay();
    expect(drawer).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
    expect(drawer).toHaveAttribute("inert");
    expect(screen.getByTestId("header")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("gallery")).not.toHaveAttribute("inert");
  });

  it("leaves each part as its owner last asked, as the sidebar does on a rotation", async () => {
    const { drawer } = await replay();
    const header = screen.getByTestId("header");
    // Turned below 768 px: the sidebar closes its drawer on a part held here.
    header.setAttribute("inert", "");
    // Turned above it: the drawer, inert before, is opened by its owner.
    drawer.removeAttribute("inert");
    await settle();
    // The intro still holds the page while it plays.
    expect(drawer).toHaveAttribute("inert");
    expect(header).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    expect(header).toHaveAttribute("inert");
    expect(drawer).not.toHaveAttribute("inert");
    expect(screen.getByTestId("gallery")).not.toHaveAttribute("inert");
  });

  it("reads an owner's word written in the same moment the intro ends", async () => {
    const { drawer } = await replay();
    const header = screen.getByTestId("header");
    header.setAttribute("inert", "");
    drawer.removeAttribute("inert");
    // No await: the observer hasn't reported yet when Skip ends the intro.
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    expect(header).toHaveAttribute("inert");
    expect(drawer).not.toHaveAttribute("inert");
  });

  it.each(["Skip", "Escape", "the overlay's animation", "stopIntro"])(
    "gives focus back to Replay on %s, which is no longer inert when it's focused",
    async (how) => {
      const { button } = await replay();
      expect(screen.getByTestId("gallery")).toHaveAttribute("inert");
      focusCalls = [];
      if (how === "Skip") fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
      else if (how === "Escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } else if (how === "stopIntro") stopIntro();
      else overlay().dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
      const toOpener = focusCalls.filter((call) => call.el === button);
      expect(toOpener).toHaveLength(1);
      expect(toOpener[0].inert).toBe(false);
      expect(document.activeElement).toBe(button);
      expect(button).not.toHaveAttribute(RETURN_ATTR);
    }
  );

  it("ends the intro and releases everything when motion is turned down mid-intro", async () => {
    const { drawer, button } = await replay();
    act(() => motion.turnDown());
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
    expect(Array.from(document.querySelectorAll("[inert]"))).toEqual([drawer]);
    expect(document.activeElement).toBe(button);
  });

  it("releases the page if the overlay goes mid-play", async () => {
    // Something beside the app in <body>, as a portal would be.
    const portal = document.body.appendChild(document.createElement("div"));
    try {
      const { page } = await replay();
      expect(portal).toHaveAttribute("inert");
      page.unmount();
      expect(portal).not.toHaveAttribute("inert");
    } finally {
      portal.remove();
    }
  });
});
