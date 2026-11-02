/**
 * The parts every intro is built from, and "Replay intro". The head script runs
 * once for the file, as on a page load, since it installs Skip and the end.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  IntroAmr,
  IntroOverlay,
  IntroPanel,
} from "@/app/(tools)/comics/components/intro/intro-parts";
import { ReplayIntro } from "@/app/(tools)/comics/components/intro/replay-intro";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { POSES, SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { panelImageUrl } from "@/lib/comics/images";
import {
  INTRO_ATTR,
  INTRO_BOOT_SCRIPT,
  INTRO_RUN_ATTR,
  OVERLAY_ATTR,
  SKIP_ATTR,
  introSafetyMs,
} from "@/lib/comics/intro";
import { playIntro } from "@/lib/comics/play-intro";

const root = document.documentElement;

function setMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function setConnection(value: object | undefined) {
  Object.defineProperty(navigator, "connection", { value, configurable: true });
}

function BookOverlay() {
  return (
    <IntroOverlay kind="book" label="Agile at Work intro">
      <p>Agile at Work</p>
    </IntroOverlay>
  );
}

beforeAll(() => {
  window.history.replaceState(null, "", "/retro");
  new Function(INTRO_BOOT_SCRIPT)();
});

beforeEach(() => {
  setMotion(false);
  setConnection(undefined);
});

afterEach(() => {
  cleanup();
  root.removeAttribute(INTRO_ATTR);
  root.removeAttribute(INTRO_RUN_ATTR);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("IntroOverlay", () => {
  it("is a named modal dialog with a Skip button", () => {
    render(<BookOverlay />);
    const dialog = screen.getByRole("dialog", { name: "Agile at Work intro" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(OVERLAY_ATTR, "book");
    const skip = screen.getByRole("button", { name: "Skip intro" });
    expect(skip).toHaveAttribute(SKIP_ATTR);
    expect(dialog).toContainElement(skip);
  });

  it("keeps its words out of search snippets", () => {
    render(<BookOverlay />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-nosnippet");
  });

  it("uses the attribute names the head script looks for", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(tools)/comics/components/intro/intro-parts.tsx"),
      "utf8"
    );
    expect(source).toContain(`${OVERLAY_ATTR}={kind}`);
    expect(source).toContain(`${SKIP_ATTR}=""`);
  });

  it("isn't a client component, so the server poster page can render it", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(tools)/comics/components/intro/intro-parts.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});

describe("IntroAmr", () => {
  it("steps through one row of the committed sheet", () => {
    const { container } = render(<IntroAmr pose="waving" width={96} />);
    const amr = container.querySelector<HTMLElement>("[data-amr-pose]")!;
    expect(amr).toHaveAttribute("aria-hidden", "true");
    expect(amr.style.backgroundImage).toContain(MASCOT_SPRITE_URL);
    const height = Math.round((96 * SHEET.cellH) / SHEET.cellW);
    expect(amr.style.backgroundPosition).toBe(`0px ${-POSES.waving.row * height}px`);
    expect(amr.style.getPropertyValue("--frames")).toBe(String(POSES.waving.frames));
    expect(amr.style.getPropertyValue("--cell-w")).toBe("96px");
  });
});

describe("IntroPanel", () => {
  it("shows the page's own 768 px file, lazily and without a second description", () => {
    const { container } = render(
      <IntroPanel panel={{ pathSmall: "ep-12/1-768.webp", width: 768, height: 512 }} />
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(panelImageUrl("ep-12/1-768.webp"));
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "768");
  });

  it("loads at once when a scene asks, for windows that open in the first second", () => {
    const { container } = render(
      <IntroPanel
        panel={{ pathSmall: "ep-12/1-768.webp", width: 768, height: 512 }}
        loading="eager"
      />
    );
    expect(container.querySelector("img")).toHaveAttribute("loading", "eager");
  });
});

describe("ReplayIntro", () => {
  it("plays the intro again from the start, with focus on Skip", () => {
    render(
      <>
        <BookOverlay />
        <ReplayIntro kind="book" />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Replay intro" }));
    expect(root.getAttribute(INTRO_ATTR)).toBe("book");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Skip intro" }));
  });

  it("can be skipped like the first play", () => {
    render(
      <>
        <BookOverlay />
        <ReplayIntro kind="book" />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Replay intro" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("ends a replay by itself if the animation never reports its end", () => {
    vi.useFakeTimers();
    render(<BookOverlay />);
    expect(playIntro("book")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(introSafetyMs("book"));
    });
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("doesn't let one replay's timer end the next", () => {
    vi.useFakeTimers();
    render(<BookOverlay />);
    playIntro("book");
    act(() => {
      vi.advanceTimersByTime(introSafetyMs("book") - 1000);
    });
    playIntro("book");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(root.getAttribute(INTRO_ATTR)).toBe("book");
  });

  it("does nothing on a page without that overlay", () => {
    render(<BookOverlay />);
    expect(playIntro("vip")).toBe(false);
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("isn't offered with reduced motion", () => {
    setMotion(true);
    render(<ReplayIntro kind="book" />);
    expect(screen.queryByRole("button", { name: "Replay intro" })).toBeNull();
  });

  it("isn't offered with Data Saver on", () => {
    setConnection({ saveData: true });
    render(<ReplayIntro kind="book" />);
    expect(screen.queryByRole("button", { name: "Replay intro" })).toBeNull();
  });
});
