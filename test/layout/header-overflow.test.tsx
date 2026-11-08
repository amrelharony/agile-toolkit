/**
 * The header between md and xl (768–1279 px: landscape phones, tablets, small
 * laptops). With the 64 px rail, a rigid 280 px search pill, the full XP bar
 * and the owner extras made the bar wider than the screen, so the page
 * scrolled sideways and help, theme, the account menu and Amr ended up past
 * the right edge (mobile audit 2026-11-08). jsdom has no layout, so these
 * pin the classes that keep it fitting; the real widths are checked on phone
 * emulation (scrollWidth <= clientWidth at 812x375 and 768x1024).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ owner: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/auth/use-is-owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/use-is-owner")>()),
  useIsOwner: () => h.owner,
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuth: () => ({ status: "anonymous", error: null }),
}));
vi.mock("@/components/gamification/xp-bar", () => ({
  XpBar: ({ onOpenTrophyCase }: { onOpenTrophyCase?: () => void }) => (
    <button type="button" onClick={onOpenTrophyCase}>
      Full XP bar
    </button>
  ),
}));
vi.mock("@/components/shared/sonification-toggle", () => ({
  SonificationToggle: () => <button type="button">Sound toggle</button>,
}));
vi.mock("@/components/ai/llm-status-chip", () => ({
  LlmStatusChip: () => <button type="button">AI chip</button>,
}));
vi.mock("@/lib/weather/widget", () => ({
  WeatherWidget: () => <div role="status">Cairo weather</div>,
}));
vi.mock("@/components/auth/user-menu", () => ({
  UserMenu: () => <button type="button" aria-label="Visitor menu" />,
}));
vi.mock("@/components/auth/visitor-data-merge-dialog", () => ({
  VisitorDataMergeDialog: () => null,
}));
vi.mock("@/lib/kudos/beacon/header-beacon", () => ({
  KudosHeaderBeacon: () => <button type="button" aria-label="Kudos beacon" />,
}));

import { Header } from "@/components/layout/header";
import { computeLevel } from "@/lib/gamification/xp-curve";
import { useVDnaStore } from "@/lib/stores/vdna-store";

const classesOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

/** Every element from `el` up to (not including) the header. */
function chainToHeader(el: Element): Element[] {
  const chain: Element[] = [];
  for (let n: Element | null = el; n && n.tagName !== "HEADER"; n = n.parentElement) {
    chain.push(n);
  }
  return chain;
}

beforeAll(() => {
  // Radix's popper measures its anchor with ResizeObserver (absent in jsdom).
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

beforeEach(() => {
  h.owner = false;
  useVDnaStore.setState({ xp: 250, prestige: 0, unlocked: ["first-retro", "first-poker"] });
});

afterEach(() => {
  cleanup();
});

describe("the header's right cluster", () => {
  it("can give way (min-w-0, right-aligned) instead of being shrink-0", () => {
    const { container } = render(<Header onOpenSearch={() => {}} />);
    const cluster = container.querySelector("[data-header-actions]");
    expect(cluster).not.toBeNull();
    expect(classesOf(cluster)).toEqual(expect.arrayContaining(["min-w-0", "justify-end"]));
    expect(classesOf(cluster)).not.toContain("shrink-0");
  });

  it("keeps help, theme, kudos and the account menu on screen at every width", () => {
    render(<Header onOpenSearch={() => {}} />);
    for (const name of ["Open help", /^Switch to /, "Kudos beacon", "Visitor menu"]) {
      const control = screen.getByRole("button", { name });
      for (const el of chainToHeader(control)) {
        expect(classesOf(el), `${String(name)} sits in a hidden element`).not.toContain("hidden");
      }
    }
  });
});

describe("the XP bar between md and xl", () => {
  it("shows the full bar on sm and from xl, a compact level chip in between", () => {
    render(<Header onOpenSearch={() => {}} />);

    const full = screen.getByRole("button", { name: "Full XP bar" }).parentElement;
    expect(classesOf(full)).toEqual(expect.arrayContaining(["md:hidden", "xl:flex"]));

    const info = computeLevel(250, 0);
    const pct = Math.round(info.progress01 * 100);
    const chip = screen.getByRole("button", {
      name: `Level ${info.level}, ${pct}% to next level. 2 achievements. Open trophy case.`,
    });
    expect(chip).toHaveTextContent(`L${info.level}`);
    expect(classesOf(chip.parentElement)).toEqual(
      expect.arrayContaining(["hidden", "md:flex", "xl:hidden"])
    );
    // Both live in one slot that, like before, starts at sm.
    expect(chip.parentElement?.parentElement).toBe(full?.parentElement);
    expect(classesOf(full?.parentElement ?? null)).toEqual(
      expect.arrayContaining(["hidden", "sm:flex"])
    );
  });

  it("opens the trophy case from the chip, as the full bar does", () => {
    const onOpenTrophyCase = vi.fn();
    render(<Header onOpenSearch={() => {}} onOpenTrophyCase={onOpenTrophyCase} />);
    fireEvent.click(screen.getByRole("button", { name: /^Level \d+,/ }));
    expect(onOpenTrophyCase).toHaveBeenCalledTimes(1);
  });

  it("shows prestige on the chip too", () => {
    useVDnaStore.setState({ prestige: 2 });
    render(<Header onOpenSearch={() => {}} />);
    expect(screen.getByRole("button", { name: /^Level \d+,/ })).toHaveTextContent(/^2L\d+$/);
  });
});

describe("the extras between md and xl", () => {
  it("move sound and AI into a More popover for visitors", () => {
    render(<Header onOpenSearch={() => {}} />);

    for (const name of ["Sound toggle", "AI chip"]) {
      const inline = screen.getByRole("button", { name }).parentElement;
      expect(classesOf(inline)).toEqual(
        expect.arrayContaining(["hidden", "sm:flex", "md:hidden", "xl:flex"])
      );
    }

    const more = screen.getByRole("button", { name: "More: sound and AI" });
    expect(classesOf(more)).toEqual(expect.arrayContaining(["hidden", "md:flex", "xl:hidden"]));
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);
    const panel = screen.getByRole("dialog", { name: "More: sound and AI" });
    expect(within(panel).getByRole("button", { name: "Sound toggle" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "AI chip" })).toBeInTheDocument();
    expect(within(panel).queryByText("Cairo weather")).toBeNull();
  });

  it("takes the owner's weather out of the bar until xl and into More", () => {
    h.owner = true;
    render(<Header onOpenSearch={() => {}} />);

    const inline = screen.getByText("Cairo weather").parentElement;
    expect(classesOf(inline)).toEqual(expect.arrayContaining(["hidden", "xl:flex"]));
    expect(classesOf(inline)).not.toContain("md:flex");

    fireEvent.click(screen.getByRole("button", { name: "More: sound, AI and weather" }));
    const panel = screen.getByRole("dialog", { name: "More: sound, AI and weather" });
    expect(within(panel).getByText("Cairo weather")).toBeInTheDocument();
  });

  it("closes More when the window leaves the md–xl range", () => {
    const RANGE = "(min-width: 768px) and (max-width: 1279.98px)";
    const listeners = new Set<() => void>();
    const range = {
      matches: true,
      media: RANGE,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    };
    const original = window.matchMedia;
    const matchMedia = vi.fn((query: string) =>
      query === RANGE ? (range as unknown as MediaQueryList) : original(query)
    );
    window.matchMedia = matchMedia;
    try {
      render(<Header onOpenSearch={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "More: sound and AI" }));
      expect(screen.getByRole("dialog", { name: "More: sound and AI" })).toBeInTheDocument();
      expect(matchMedia).toHaveBeenCalledWith(RANGE);

      // Still in range: a change event alone doesn't close it.
      act(() => listeners.forEach((cb) => cb()));
      expect(screen.getByRole("dialog", { name: "More: sound and AI" })).toBeInTheDocument();

      // Resized past xl (or below md): it closes, and stops listening.
      range.matches = false;
      act(() => listeners.forEach((cb) => cb()));
      expect(screen.queryByRole("dialog", { name: "More: sound and AI" })).toBeNull();
      expect(listeners.size).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("the header search", () => {
  it("is an icon below lg and, from lg, a pill that can give width back", () => {
    const { container } = render(<Header onOpenSearch={() => {}} />);
    const search = container.querySelector("[data-header-search]");
    expect(search).toBe(screen.getByRole("button", { name: "Open search" }));

    const cls = classesOf(search);
    expect(cls).not.toContain("shrink-0");
    expect(cls).toEqual(
      expect.arrayContaining(["w-9", "min-w-9", "lg:w-[280px]", "lg:min-w-[10rem]"])
    );
    // No md: pill any more — at 768–1023 px it stays the icon.
    expect(cls.filter((c) => c.startsWith("md:"))).toEqual([]);
    expect(classesOf(screen.getByText("Search tools..."))).toEqual(
      expect.arrayContaining(["hidden", "lg:inline"])
    );
  });
});
