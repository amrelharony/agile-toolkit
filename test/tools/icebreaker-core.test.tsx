import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ICEBREAKER_ACTIONS } from "@/lib/history/event-actions";

/**
 * Icebreaker gap-filling: favourites persistence (and the legacy key),
 * combined filters with their count and empty state, opening a card, and
 * the random pick. (The "up to N minutes" time filter and the card's
 * keyboard access are covered elsewhere.)
 */

const spies = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));
// Swap framer-motion for plain elements so a card change shows at once.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const drop = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const cache = new Map<string, unknown>();
  const motion = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        if (!cache.has(tag)) {
          const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
            React.createElement(tag, {
              ...Object.fromEntries(Object.entries(props).filter(([k]) => !drop.has(k))),
              ref,
            })
          );
          C.displayName = `Motion(${tag})`;
          cache.set(tag, C);
        }
        return cache.get(tag);
      },
    }
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    useReducedMotion: () => false,
  };
});

import { IceBreakerClient } from "@/app/(tools)/icebreaker/icebreaker-client";
import { icebreakers, type IceBreaker } from "@/lib/constants/icebreakers";

const KEY = "agile-toolkit:icebreaker-favorites";
const LEGACY = "icebreaker-favorites";
const [first, second] = icebreakers;

const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as string[] | null;
const count = () => document.body.textContent!.match(/(\d+) icebreakers? match your filters/)?.[1];
const pickButton = () => screen.getByRole("button", { name: /Random Pick|Picking/ });

function chip(group: string, label: string) {
  const g = screen.getByRole("group", { name: group });
  return within(g).getByRole("button", { name: label });
}

type Filter = {
  time: "all" | 2 | 5 | 10 | 15;
  size: "all" | IceBreaker["teamSize"];
  energy: "all" | IceBreaker["energyLevel"];
  category: "all" | IceBreaker["category"];
};
const matches = (f: Filter) =>
  icebreakers.filter(
    (ib) =>
      (f.time === "all" || ib.timeMinutes <= f.time) &&
      (f.size === "all" || ib.teamSize === f.size) &&
      (f.energy === "all" || ib.energyLevel === f.energy) &&
      (f.category === "all" || ib.category === f.category)
  );
/** The first filter combination with exactly `n` matches. */
function comboWith(n: number): Filter | undefined {
  for (const time of [2, 5, 10, 15, "all"] as const)
    for (const size of ["small", "medium", "large"] as const)
      for (const energy of ["low", "medium", "high"] as const)
        for (const category of ["question", "activity", "game", "creative", "agile"] as const) {
          const f = { time, size, energy, category };
          if (matches(f).length === n) return f;
        }
  return undefined;
}
const TIME_LABEL = {
  all: "All",
  2: "Up to 2 min",
  5: "Up to 5 min",
  10: "Up to 10 min",
  15: "Up to 15 min",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SIZE_LABEL = { small: "Small (2-5)", medium: "Medium (5-10)", large: "Large (10+)" };
function applyFilter(f: Filter) {
  fireEvent.click(chip("Time", TIME_LABEL[f.time]));
  if (f.size !== "all") fireEvent.click(chip("Team Size", SIZE_LABEL[f.size]));
  if (f.energy !== "all") fireEvent.click(chip("Energy Level", cap(f.energy)));
  if (f.category !== "all") fireEvent.click(chip("Category", cap(f.category)));
}

beforeEach(() => {
  spies.log.mockClear();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Icebreaker favourites", () => {
  it("saves a favourite, survives a reload, and un-favouriting removes it", () => {
    const view = render(<IceBreakerClient />);
    fireEvent.click(screen.getByRole("button", { name: `Add ${first.name} to favorites` }));
    expect(saved()).toEqual([first.id]);
    expect(spies.log).toHaveBeenCalledWith(ICEBREAKER_ACTIONS.PROMPT_FAVORITED, {
      promptId: first.id,
    });
    view.unmount();

    render(<IceBreakerClient />);
    const fav = screen.getByRole("button", { name: `Remove ${first.name} from favorites` });
    expect(fav).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(fav);
    expect(saved()).toEqual([]);
  });

  it("moves favourites from the old storage key, keeping only string ids", () => {
    localStorage.setItem(LEGACY, JSON.stringify([second.id, 42, null]));
    render(<IceBreakerClient />);
    expect(
      screen.getByRole("button", { name: `Remove ${second.name} from favorites` })
    ).toBeInTheDocument();
    expect(saved()).toEqual([second.id]);
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it("starts with no favourites when storage holds junk", () => {
    for (const junk of ["{not json", JSON.stringify({ ids: [first.id] })]) {
      localStorage.setItem(KEY, junk);
      const view = render(<IceBreakerClient />);
      expect(screen.queryAllByRole("button", { name: /^Remove .* from favorites$/ })).toHaveLength(
        0
      );
      view.unmount();
    }
  });
});

describe("Icebreaker filters", () => {
  it("combines filters and counts what matches", () => {
    render(<IceBreakerClient />);
    expect(count()).toBe(String(icebreakers.length));
    expect(chip("Category", "All")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip("Category", "Question"));
    fireEvent.click(chip("Energy Level", "Low"));
    const expected = matches({ time: "all", size: "all", energy: "low", category: "question" });
    expect(count()).toBe(String(expected.length));
    expect(chip("Category", "Question")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Category", "All")).toHaveAttribute("aria-pressed", "false");
    for (const ib of icebreakers) {
      const shown = screen.queryByRole("button", { name: ib.name }) !== null;
      expect(shown, ib.name).toBe(expected.includes(ib));
    }

    fireEvent.click(chip("Category", "All"));
    fireEvent.click(chip("Energy Level", "All"));
    expect(count()).toBe(String(icebreakers.length));
  });

  it("says nothing matches and disables Random Pick", () => {
    const none = comboWith(0);
    expect(none).toBeDefined();
    render(<IceBreakerClient />);
    applyFilter(none!);
    expect(document.body.textContent).toContain("0 icebreakers match your filters");
    expect(
      screen.getByText("No icebreakers match your current filters. Try broadening your selection.")
    ).toBeInTheDocument();
    expect(pickButton()).toBeDisabled();
  });
});

describe("Icebreaker card and random pick", () => {
  it("opens a card with its instructions and favourites it from there", () => {
    render(<IceBreakerClient />);
    fireEvent.click(screen.getByRole("button", { name: first.name }));
    expect(screen.getByText(first.instructions)).toBeInTheDocument();
    expect(screen.getByText(`${first.timeMinutes} minutes`)).toBeInTheDocument();
    expect(screen.getByText(`${first.energyLevel} energy`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));
    expect(saved()).toEqual([first.id]);
    expect(screen.getByRole("button", { name: "Unfavorite" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Remove ${first.name} from favorites` })
    ).toBeInTheDocument();
  });

  it("picks the only match straight away", () => {
    const one = comboWith(1);
    expect(one).toBeDefined();
    const [only] = matches(one!);
    render(<IceBreakerClient />);
    applyFilter(one!);
    expect(document.body.textContent).toContain("1 icebreaker match your filters");
    fireEvent.click(pickButton());
    expect(pickButton()).toHaveTextContent("Random Pick");
    expect(screen.getByText(only.instructions)).toBeInTheDocument();
    expect(spies.log).toHaveBeenCalledWith(ICEBREAKER_ACTIONS.PROMPT_DRAWN, {
      promptId: only.id,
      name: only.name,
      category: only.category,
    });
  });

  it("spins through the matches, then lands on one other than the last pick", () => {
    vi.useFakeTimers();
    // Every random draw lands on index 0 — the previous pick is still skipped.
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<IceBreakerClient />);
    fireEvent.click(screen.getByRole("button", { name: first.name }));

    fireEvent.click(pickButton());
    expect(pickButton()).toHaveTextContent("Picking...");
    expect(pickButton()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(6 * 80);
    });
    expect(pickButton()).toHaveTextContent("Random Pick");
    expect(screen.getByText(second.instructions)).toBeInTheDocument();
    expect(screen.queryByText(first.instructions)).toBeNull();
    expect(spies.log).toHaveBeenCalledWith(ICEBREAKER_ACTIONS.PROMPT_DRAWN, {
      promptId: second.id,
      name: second.name,
      category: second.category,
    });
  });
});
