import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { icebreakers } from "@/lib/constants/icebreakers";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";

/**
 * Icebreaker upgrade: a headcount from the roster instead of size buckets,
 * a "used recently" memory that Random Pick honours, the warm-up's
 * time-box on the docked timer (never taking another page's clock),
 * favourites in a synced store (moved once from raw localStorage), Undo on
 * every removal, example data, a verdict and a Markdown export.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { IceBreakerClient } from "@/app/(tools)/icebreaker/icebreaker-client";
import {
  SIZE_RANGE,
  fitsPeople,
  peopleLabel,
  peopleRange,
  rosterHeadcount,
  validateHeadcount,
} from "@/app/(tools)/icebreaker/sizes";
import {
  NO_FILTERS,
  RECENT_DAYS,
  daysAgoText,
  filterIcebreakers,
  lastUsedAt,
  pickRandom,
  recentIds,
  relaxHint,
  usedOnDay,
  withUse,
  withUseDate,
} from "@/app/(tools)/icebreaker/filter";
import {
  MAX_USES,
  normalizeFavorites,
  normalizeSession,
  normalizeSettings,
  normalizeUses,
  useIcebreakerSession,
  useIcebreakerSettings,
  type IcebreakerUse,
} from "@/app/(tools)/icebreaker/store";
import {
  FAVORITES_KEY,
  LEGACY_FAVORITES_KEY,
  migrateIcebreakerFavoritesNow,
  planFavoritesMove,
} from "@/app/(tools)/icebreaker/migrate";
import {
  ICEBREAKER_HREF,
  otherDock,
  runningIdFor,
  startIcebreakerTimer,
  stopIcebreakerTimer,
} from "@/app/(tools)/icebreaker/timer";
import { icebreakerVerdict } from "@/app/(tools)/icebreaker/verdict";
import { toMarkdown } from "@/app/(tools)/icebreaker/markdown";
import { buildExample } from "@/app/(tools)/icebreaker/example";
import { dayOfUse, usedAtFor, validateUseDay } from "@/app/(tools)/icebreaker/uses";
import { isExampleId } from "@/components/tool-frame/example-data";
import { todayLocalISO } from "@/lib/utils/formatters";

const ib = (id: string) => icebreakers.find((x) => x.id === id)!;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 24, 15, 0); // Sat 24 Oct 2026, 15:00 local
const use = (id: string, icebreakerId: string, daysAgo: number, now = NOW): IcebreakerUse => ({
  id,
  icebreakerId,
  usedAt: new Date(now.getTime() - daysAgo * DAY).toISOString(),
  minutes: ib(icebreakerId).timeMinutes,
});

const ceremonyDock = (over: Partial<DockedTimer> = {}): DockedTimer => ({
  label: "Retro",
  href: "/ceremony-timer",
  totalSeconds: 3600,
  endsAt: Date.now() + 60_000,
  pausedRemaining: 3600,
  ...over,
});

const settings = () => useIcebreakerSettings.getState();
const renderPage = () =>
  render(
    <TooltipProvider>
      <IceBreakerClient />
    </TooltipProvider>
  );
/** Render and let the mount's rehydrate and favourites move settle. */
async function mount() {
  const view = renderPage();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}
const undoOf = (label: string) => {
  const call = [...toastSpy.mock.calls].reverse().find((c) => c[0] === label);
  expect(call, `toast "${label}"`).toBeTruthy();
  return () => act(() => call![1].action.onClick());
};
const grid = () => screen.getByRole("heading", { name: "Browse All" }).parentElement as HTMLElement;

beforeEach(() => {
  toastSpy.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  useDockTimer.setState({ timer: null });
  useIcebreakerSettings.setState({ favorites: [], used: [], hideRecent: false });
  useIcebreakerSession.setState({ selectedId: null, runningId: null });
  useWorkspaceStore.setState({ teamMembers: [] });
});
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────
describe("team size as a headcount", () => {
  it("fits each bucket's range, edges included, and any size when unset", () => {
    const small = ib("q-1"); // 2–5
    const medium = ib("q-2"); // 5–10
    expect(SIZE_RANGE.small).toEqual({ min: 2, max: 5 });
    expect([2, 5, 6].map((n) => fitsPeople(small, n))).toEqual([true, true, false]);
    expect([4, 5, 10, 11].map((n) => fitsPeople(medium, n))).toEqual([false, true, true, false]);
    expect(fitsPeople(small, null)).toBe(true);
    // A team of 5 or 10 sits in two ranges on purpose.
    expect(fitsPeople(small, 5) && fitsPeople(medium, 5)).toBe(true);
  });

  it("lets large-group activities that scale down say so", () => {
    const oneWord = ib("q-7"); // "large", but works from two people
    expect(oneWord.teamSize).toBe("large");
    expect(peopleRange(oneWord)).toEqual({ min: 2, max: null });
    expect(fitsPeople(oneWord, 3)).toBe(true);
    expect(fitsPeople(oneWord, 150)).toBe(true);
    expect(peopleLabel(oneWord)).toBe("2+ people");
    expect(peopleLabel(ib("q-1"))).toBe("2–5 people");
    // Every catalog id is unchanged and every range is sane.
    expect(new Set(icebreakers.map((x) => x.id)).size).toBe(icebreakers.length);
    for (const x of icebreakers) {
      const r = peopleRange(x);
      expect(r.min).toBeGreaterThanOrEqual(2);
      if (r.max !== null) expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
  });

  it("validates the People field instead of ignoring bad input", () => {
    expect(validateHeadcount("")).toEqual({ value: null });
    expect(validateHeadcount(" 7 ")).toEqual({ value: 7 });
    expect(validateHeadcount("2")).toEqual({ value: 2 });
    expect(validateHeadcount("200")).toEqual({ value: 200 });
    expect(validateHeadcount("1").error).toMatch(/at least 2/);
    expect(validateHeadcount("0").error).toMatch(/at least 2/);
    expect(validateHeadcount("201").error).toMatch(/200 people or fewer/);
    expect(validateHeadcount("2.5").error).toMatch(/whole number/);
    expect(validateHeadcount("seven").error).toMatch(/whole number/);
    expect(validateHeadcount("1e9").error).toMatch(/200 people or fewer/);
  });

  it("starts from the roster once the workspace has loaded", () => {
    expect(rosterHeadcount(3, true)).toBe(3);
    expect(rosterHeadcount(0, true)).toBeNull();
    expect(rosterHeadcount(1, true)).toBeNull(); // no icebreaker is for one
    expect(rosterHeadcount(7, false)).toBeNull();
    expect(rosterHeadcount(5000, true)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
describe("used recently", () => {
  it("counts the last 14 calendar days, today included", () => {
    const used = [
      use("a", "q-1", 0),
      use("b", "q-2", 13),
      use("c", "q-3", 14),
      use("d", "q-4", 40),
    ];
    expect(RECENT_DAYS).toBe(14);
    expect(Array.from(recentIds(used, NOW)).sort()).toEqual(["q-1", "q-2"]);
    expect(recentIds([], NOW).size).toBe(0);
    expect(daysAgoText(used[0].usedAt, NOW)).toBe("today");
    expect(daysAgoText(use("e", "q-1", 1).usedAt, NOW)).toBe("yesterday");
    expect(daysAgoText(used[1].usedAt, NOW)).toBe("13 days ago");
  });

  it("hides recent matches only when asked, and says how many", () => {
    const s = { favorites: [], used: [use("a", "q-1", 2)] };
    const shown = filterIcebreakers(icebreakers, NO_FILTERS, s, NOW);
    expect(shown.matches.map((x) => x.id)).toContain("q-1");
    expect(shown.hiddenRecent).toEqual([]);
    const hidden = filterIcebreakers(icebreakers, { ...NO_FILTERS, hideRecent: true }, s, NOW);
    expect(hidden.matches.map((x) => x.id)).not.toContain("q-1");
    expect(hidden.hiddenRecent.map((x) => x.id)).toEqual(["q-1"]);
  });

  it("filters to favourites only", () => {
    const r = filterIcebreakers(
      icebreakers,
      { ...NO_FILTERS, favoritesOnly: true },
      { favorites: ["q-2", "g-1"], used: [] },
      NOW
    );
    expect(r.matches.map((x) => x.id)).toEqual(["q-2", "g-1"]);
  });

  it("names the filter to relax when nothing fits", () => {
    const f = { ...NO_FILTERS, people: 30, maxMinutes: 2, energy: "high" as const };
    const s = { favorites: [], used: [] };
    expect(filterIcebreakers(icebreakers, f, s, NOW).matches).toEqual([]);
    const hint = relaxHint(icebreakers, f, s, NOW);
    expect(hint).not.toBeNull();
    expect(hint!.count).toBeGreaterThan(0);
    expect(relaxHint(icebreakers, NO_FILTERS, s, NOW)).toBeNull();
  });

  it("picks at random, never the one just shown when there is another", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(pickRandom([], null)).toBeNull();
    expect(pickRandom([{ id: "only" }], "only")?.id).toBe("only");
    for (const r of [0, 0.5, 0.999]) expect(pickRandom(list, "a", () => r)?.id).not.toBe("a");
    expect(pickRandom(list, null, () => 0)?.id).toBe("a");
    expect(pickRandom(list, null, () => 1)?.id).toBe("c"); // rand() of 1 stays in range
  });

  it("records one use per activity per day", () => {
    const first = use("a", "q-1", 0);
    const again = {
      ...use("b", "q-1", 0),
      usedAt: new Date(NOW.getTime() - 3600_000).toISOString(),
    };
    const r1 = withUse([], first);
    expect(r1).toEqual({ next: [first], added: true });
    expect(withUse(r1.next, again).added).toBe(false);
    expect(withUse(r1.next, use("c", "q-1", 1)).added).toBe(true);
    expect(lastUsedAt([use("x", "q-1", 5), first], "q-1")).toBe(first.usedAt);
    expect(lastUsedAt([], "q-1")).toBeNull();
  });

  it("takes a backdated day, never a future or made-up one", () => {
    const today = "2026-10-24";
    expect(validateUseDay({ day: "" }, today)).toMatchObject({ ok: false });
    expect(validateUseDay({ day: "2026-10-25" }, today)).toEqual({
      ok: false,
      errors: { day: "A use can't be in the future." },
    });
    expect(validateUseDay({ day: "2026-02-30" }, today)).toMatchObject({ ok: false });
    const ok = validateUseDay({ day: "2026-10-20" }, today);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(dayOfUse(ok.values.usedAt)).toBe("2026-10-20");
    expect(dayOfUse(usedAtFor(today))).toBe(today);
  });
});

// ─────────────────────────────────────────────────────────────
describe("stored settings", () => {
  it("keeps only catalog ids and valid uses, newest first and capped", () => {
    expect(normalizeFavorites(["q-1", "nope", "q-1", 3, "g-2"])).toEqual(["q-1", "g-2"]);
    expect(normalizeFavorites("q-1")).toEqual([]);
    const rows = [
      use("old", "q-1", 10),
      use("new", "q-2", 1),
      { id: "bad", icebreakerId: "zz", usedAt: NOW.toISOString(), minutes: 5 },
      { id: "bad-date", icebreakerId: "q-1", usedAt: "yesterday", minutes: 5 },
      { ...use("new", "q-3", 0) }, // same id twice: the first stays
      null,
      { id: "neg", icebreakerId: "q-4", usedAt: NOW.toISOString(), minutes: -3 },
    ];
    const clean = normalizeUses(rows);
    expect(clean.map((u) => u.id)).toEqual(["neg", "new", "old"]);
    expect(clean.find((u) => u.id === "neg")?.minutes).toBe(0);
    const many = Array.from({ length: MAX_USES + 30 }, (_, i) => use(`u${i}`, "q-1", i));
    const capped = normalizeUses(many);
    expect(capped).toHaveLength(MAX_USES);
    expect(capped[0].id).toBe("u0"); // the newest stay
  });

  it("reads a missing or odd shape as empty", () => {
    expect(normalizeSettings(undefined)).toEqual({ favorites: [], used: [], hideRecent: false });
    expect(normalizeSettings([1, 2])).toEqual({ favorites: [], used: [], hideRecent: false });
    expect(normalizeSettings({ favorites: ["q-1"], hideRecent: "yes" })).toEqual({
      favorites: ["q-1"],
      used: [],
      hideRecent: false,
    });
    expect(normalizeSession({ selectedId: "q-1", runningId: "gone" })).toEqual({
      selectedId: "q-1",
      runningId: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────
describe("moving the old favourites keys", () => {
  beforeEach(() => {
    // The settings store has loaded (the page rehydrates it first).
    vi.spyOn(useIcebreakerSettings.persist, "hasHydrated").mockReturnValue(true);
  });

  it("merges both old keys, backs them up and removes them", () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(["q-1", "nope"]));
    localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify(["q-2", "q-1"]));
    useIcebreakerSettings.setState({ favorites: ["g-1"] });

    const r = migrateIcebreakerFavoritesNow();
    expect(r.report).toEqual({ added: 2 });
    expect(settings().favorites).toEqual(["g-1", "q-1", "q-2"]);
    expect(localStorage.getItem(FAVORITES_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_FAVORITES_KEY)).toBeNull();
    expect(localStorage.getItem(`${FAVORITES_KEY}:migrated`)).toBe(JSON.stringify(["q-1", "nope"]));
    expect(localStorage.getItem(`${LEGACY_FAVORITES_KEY}:migrated`)).toBe(
      JSON.stringify(["q-2", "q-1"])
    );
  });

  it("changes nothing when run twice, or when a crash left a key behind", () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(["q-1"]));
    migrateIcebreakerFavoritesNow();
    expect(settings().favorites).toEqual(["q-1"]);
    expect(migrateIcebreakerFavoritesNow()).toMatchObject({ report: null, removed: [] });
    // The key comes back (a crash between the write and the backup).
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(["q-1"]));
    expect(migrateIcebreakerFavoritesNow().report).toEqual({ added: 0 });
    expect(settings().favorites).toEqual(["q-1"]);
    // An earlier backup is kept; the new one gets a timestamped name.
    const backups = Object.keys(localStorage).filter((k) =>
      k.startsWith(`${FAVORITES_KEY}:migrated`)
    );
    expect(backups.length).toBe(2);
  });

  it("waits for the store to load, and survives a corrupt value", () => {
    vi.spyOn(useIcebreakerSettings.persist, "hasHydrated").mockReturnValue(false);
    localStorage.setItem(LEGACY_FAVORITES_KEY, "{not json");
    expect(migrateIcebreakerFavoritesNow()).toMatchObject({
      report: null,
      kept: [LEGACY_FAVORITES_KEY],
    });
    expect(localStorage.getItem(LEGACY_FAVORITES_KEY)).toBe("{not json");

    vi.spyOn(useIcebreakerSettings.persist, "hasHydrated").mockReturnValue(true);
    expect(migrateIcebreakerFavoritesNow().report).toEqual({ added: 0 });
    expect(localStorage.getItem(LEGACY_FAVORITES_KEY)).toBeNull();
    expect(planFavoritesMove({}, ["q-1"])).toEqual({ next: ["q-1"], report: { added: 0 } });
  });

  it("runs on the page, so old hearts stay filled", async () => {
    vi.restoreAllMocks();
    localStorage.setItem(LEGACY_FAVORITES_KEY, JSON.stringify([icebreakers[0].id]));
    await mount();
    await waitFor(() => expect(settings().favorites).toEqual([icebreakers[0].id]));
    expect(
      screen.getByRole("button", { name: `Remove ${icebreakers[0].name} from favorites` })
    ).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(LEGACY_FAVORITES_KEY)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe("the docked timer", () => {
  it("publishes a running countdown owned by the icebreaker page", () => {
    expect(startIcebreakerTimer(ib("q-1"), 1_000)).toEqual({ ok: true });
    expect(useDockTimer.getState().timer).toEqual({
      label: "Two Truths and a Lie",
      href: ICEBREAKER_HREF,
      totalSeconds: 600,
      endsAt: 601_000,
      pausedRemaining: 600,
    });
    stopIcebreakerTimer();
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("never replaces another page's timer, running or paused at 0:00", () => {
    for (const dock of [ceremonyDock(), ceremonyDock({ endsAt: null, pausedRemaining: 0 })]) {
      useDockTimer.setState({ timer: dock });
      const r = startIcebreakerTimer(ib("q-1"));
      expect(r.ok).toBe(false);
      expect(useDockTimer.getState().timer).toBe(dock);
      stopIcebreakerTimer(); // leaves it alone too
      expect(useDockTimer.getState().timer).toBe(dock);
      expect(otherDock(dock)).toBe(dock);
    }
  });

  it("forgets a running id once its clock is gone", () => {
    const ours = { ...ceremonyDock(), href: ICEBREAKER_HREF };
    expect(runningIdFor("q-1", ours)).toBe("q-1");
    expect(runningIdFor("q-1", null)).toBeNull();
    expect(runningIdFor("q-1", ceremonyDock())).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe("verdict and Markdown", () => {
  it("says how many fit, what is hidden, and what to relax", () => {
    expect(icebreakerVerdict({ matches: 14, people: 7, maxMinutes: 10, hiddenRecent: 3 })).toBe(
      "14 activities fit 7 people in up to 10 minutes; 3 used in the last two weeks are hidden."
    );
    expect(icebreakerVerdict({ matches: 1, people: null, maxMinutes: null, hiddenRecent: 0 })).toBe(
      "1 activity matches your filters."
    );
    expect(icebreakerVerdict({ matches: 0, people: null, maxMinutes: null, hiddenRecent: 2 })).toBe(
      "All 2 matches were used in the last two weeks."
    );
    expect(
      icebreakerVerdict({
        matches: 0,
        people: 30,
        maxMinutes: 2,
        hiddenRecent: 0,
        relax: { filter: "energy", count: 4 },
      })
    ).toBe("Nothing fits 30 people in up to 2 minutes. Remove the Energy filter to see 4.");
    expect(icebreakerVerdict({ matches: 0, people: null, maxMinutes: null, hiddenRecent: 0 })).toBe(
      "Nothing matches your filters. Clear the filters to see every activity."
    );
  });

  it("exports a facilitation card, favourites and the history", () => {
    const md = toMarkdown(
      {
        selected: ib("q-1"),
        people: 4,
        favorites: ["q-2", "gone"],
        // A row the catalog no longer has is left out.
        used: [use("a", "q-1", 2), { ...use("b", "q-1", 1), icebreakerId: "zz-gone" }],
      },
      NOW
    );
    expect(md).toContain("# Icebreaker — 24 Oct 2026");
    expect(md).toContain("## Two Truths and a Lie");
    expect(md).toContain("Question · 10 min · 2–5 people · medium energy");
    expect(md).toContain("**How to run it:**");
    expect(md).toContain("Planned for 4 people.");
    expect(md).toContain("- Desert Island Pick (5 min, 5–10 people)");
    expect(md).toContain("| 22 Oct 2026 | Two Truths and a Lie | 10 | 2 days ago |");
    const empty = toMarkdown({ selected: null, people: null, favorites: [], used: [] }, NOW);
    expect(empty).toContain("No activity picked yet.");
    expect(empty).toContain("No favorites yet.");
    expect(empty).toContain("Nothing recorded yet.");
  });

  it("builds an example of catalog activities with example ids", () => {
    const ex = buildExample(NOW);
    expect(
      ex.used.every((u) => isExampleId(u.id) && icebreakers.some((x) => x.id === u.icebreakerId))
    ).toBe(true);
    expect(Array.from(recentIds(ex.used, NOW)).sort()).toEqual(["ag-2", "q-1"]);
    expect(icebreakers.some((x) => x.id === ex.selectedId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe("the page", () => {
  it("defaults People to the roster's size and says where it came from", async () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
      ],
    });
    await mount();
    expect(screen.getByText(/3 people, from your team/)).toBeInTheDocument();
    const fit = icebreakers.filter((x) => fitsPeople(x, 3)).length;
    expect(screen.getByText(`${fit} activities fit 3 people.`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const field = screen.getByLabelText(/People/);
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.blur(field);
    expect(screen.getByText("An icebreaker needs at least 2 people.")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByRole("button", { name: "Use team size (3)" }));
    expect(screen.getByText(/3 people, from your team/)).toBeInTheDocument();
  });

  it("leaves People unset with an empty roster", async () => {
    await mount();
    const field = screen.getByLabelText(/People/);
    expect(field).toHaveValue("");
    expect(screen.queryByText(/from your team/)).not.toBeInTheDocument();
    expect(
      screen.getByText(`${icebreakers.length} activities match your filters.`)
    ).toBeInTheDocument();
  });

  it("starts the timer, records the use with Undo, and stops", async () => {
    await mount();
    const first = icebreakers[0];
    fireEvent.click(within(grid()).getByRole("button", { name: first.name }));
    expect(screen.getByRole("heading", { level: 2, name: first.name })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: `Start ${first.timeMinutes}-min timer` }));
    const dock = useDockTimer.getState().timer!;
    expect(dock).toMatchObject({ href: "/icebreaker", label: first.name });
    expect(dock.endsAt).not.toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent(/^\d\d:\d\d$/);
    expect(settings().used.map((u) => u.icebreakerId)).toEqual([first.id]);
    expect(useIcebreakerSession.getState()).toEqual({ selectedId: first.id, runningId: first.id });

    // Undo forgets the use; the clock keeps going.
    undoOf(`Recorded ${first.name} as used`)();
    expect(settings().used).toEqual([]);
    expect(useDockTimer.getState().timer).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(useDockTimer.getState().timer).toBeNull();
    expect(useIcebreakerSession.getState().runningId).toBeNull();
  });

  it("says who holds the dock instead of taking it", async () => {
    useDockTimer.setState({ timer: ceremonyDock({ endsAt: null, pausedRemaining: 0 }) });
    useIcebreakerSession.setState({ selectedId: "q-1", runningId: null });
    await mount();
    expect(screen.queryByRole("button", { name: /min timer/ })).not.toBeInTheDocument();
    expect(screen.getByText(/The Retro timer is running/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Retro timer" })).toHaveAttribute(
      "href",
      "/ceremony-timer"
    );
    expect(useDockTimer.getState().timer?.href).toBe("/ceremony-timer");
  });

  it("offers Stop for a clock of its own with nothing behind it", async () => {
    useDockTimer.setState({
      timer: { ...ceremonyDock(), href: ICEBREAKER_HREF, label: "Peak and Pit" },
    });
    await mount();
    expect(
      screen.getByText("A Peak and Pit timer from an earlier visit is still running.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("drops a running id whose clock was stopped from another page", async () => {
    useIcebreakerSession.setState({ selectedId: "q-1", runningId: "q-1" });
    await mount();
    expect(useIcebreakerSession.getState()).toEqual({ selectedId: "q-1", runningId: null });
    expect(screen.getByRole("button", { name: "Start 10-min timer" })).toBeInTheDocument();
  });

  it("marks a backdated use, once per day", async () => {
    useIcebreakerSession.setState({ selectedId: "q-2", runningId: null });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Mark as used" }));
    const day = screen.getByLabelText(/Used on/);
    expect(day).toHaveFocus();
    expect(day).toHaveValue(todayLocalISO());
    fireEvent.change(day, { target: { value: "2999-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Record use" }));
    expect(screen.getByText("A use can't be in the future.")).toBeInTheDocument();
    expect(settings().used).toEqual([]);

    const threeDaysAgo = todayLocalISO(new Date(Date.now() - 3 * DAY));
    fireEvent.change(day, { target: { value: threeDaysAgo } });
    fireEvent.click(screen.getByRole("button", { name: "Record use" }));
    expect(settings().used.map((u) => dayOfUse(u.usedAt))).toEqual([threeDaysAgo]);
    expect(screen.getAllByText("Used 3 days ago").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Mark as used" }));
    fireEvent.change(screen.getByLabelText(/Used on/), { target: { value: threeDaysAgo } });
    fireEvent.click(screen.getByRole("button", { name: "Record use" }));
    expect(settings().used).toHaveLength(1);
    expect(toastSpy).toHaveBeenCalledWith("Desert Island Pick is already recorded for that day");
  });

  it("hides what was used recently from the grid and from Random Pick", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("reduce"),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList
    );
    useIcebreakerSettings.setState({ used: [use("u1", "q-1", 1)] });
    await mount();
    expect(within(grid()).getByText("Used yesterday")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide used in the last 2 weeks (1)" }));
    expect(settings().hideRecent).toBe(true);
    expect(within(grid()).queryByRole("button", { name: ib("q-1").name })).toBeNull();
    expect(screen.getByText(/1 used in the last two weeks is hidden\./)).toBeInTheDocument();

    // With less motion asked for, the pick lands at once.
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Random Pick" }));
      expect(useIcebreakerSession.getState().selectedId).not.toBe("q-1");
      expect(useIcebreakerSession.getState().selectedId).not.toBeNull();
    }
  });

  it("spins through the matches, then lands on one and announces it", async () => {
    vi.useFakeTimers();
    try {
      render(
        <TooltipProvider>
          <LiveAnnouncerProvider>
            <IceBreakerClient />
          </LiveAnnouncerProvider>
        </TooltipProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Random Pick" }));
      expect(screen.getByRole("button", { name: "Picking..." })).toBeDisabled();
      act(() => {
        vi.advanceTimersByTime(6 * 80);
      });
      const picked = useIcebreakerSession.getState().selectedId;
      expect(picked).not.toBeNull();
      expect(screen.getByRole("button", { name: "Random Pick" })).toBeEnabled();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByTestId("live-polite")).toHaveTextContent(`Picked ${ib(picked!).name}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when every match is recent, and can include them", async () => {
    useIcebreakerSettings.setState({
      used: [use("u1", "q-1", 1)],
      hideRecent: true,
      favorites: ["q-1"],
    });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Favorites only (1)" }));
    expect(
      screen.getAllByText("The only match was used in the last two weeks.").length
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Random Pick" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Include the recent ones" }));
    expect(settings().hideRecent).toBe(false);
    expect(within(grid()).getByRole("button", { name: ib("q-1").name })).toBeInTheDocument();
  });

  it("removes a favourite with Undo", async () => {
    useIcebreakerSettings.setState({ favorites: ["q-1", "q-2"] });
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Two Truths and a Lie from favorites" })
    );
    expect(settings().favorites).toEqual(["q-2"]);
    undoOf("Removed Two Truths and a Lie from favorites")();
    expect(settings().favorites).toEqual(["q-1", "q-2"]);
  });

  it("loads the example from the empty history and clears only it", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(settings().used.every((u) => isExampleId(u.id))).toBe(true);
    expect(settings().used).toHaveLength(3);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Estimate This" })).toBeInTheDocument();
    const history = screen.getByRole("list", { name: "Icebreakers used, newest first" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(3);

    act(() => {
      useIcebreakerSettings.setState({
        used: [...settings().used, use("mine", "g-1", 0, new Date())],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(settings().used.map((u) => u.id)).toEqual(["mine"]);
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
    // The history isn't empty, so the example is no longer offered.
    expect(screen.queryByRole("button", { name: "Load an example" })).not.toBeInTheDocument();
  });

  it("removes a use with Undo and clears the history behind a confirm", async () => {
    const now = new Date();
    useIcebreakerSettings.setState({ used: [use("a", "q-1", 1, now), use("b", "q-2", 3, now)] });
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Two Truths and a Lie from the history" })
    );
    expect(settings().used.map((u) => u.id)).toEqual(["b"]);
    undoOf("Removed Two Truths and a Lie from the history")();
    expect(settings().used.map((u) => u.id)).toEqual(["a", "b"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(settings().used).toEqual([]);
    undoOf("Cleared the icebreaker history")();
    expect(settings().used.map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("re-dates a use in place without the list jumping", async () => {
    const now = new Date();
    useIcebreakerSettings.setState({ used: [use("a", "q-1", 1, now), use("b", "q-2", 3, now)] });
    await mount();
    const history = () => screen.getByRole("list", { name: "Icebreakers used, newest first" });
    const names = () =>
      within(history())
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "");
    expect(names()[0]).toContain("Two Truths and a Lie");

    fireEvent.click(
      screen.getByRole("button", { name: "Change the date of Two Truths and a Lie" })
    );
    const day = within(history()).getByLabelText(/Used on/);
    fireEvent.change(day, { target: { value: todayLocalISO(new Date(now.getTime() - 9 * DAY)) } });
    fireEvent.click(within(history()).getByRole("button", { name: "Save date" }));
    expect(settings().used.map((u) => u.id)).toEqual(["b", "a"]);
    // Still first on screen until Re-sort; focus is back on its pencil.
    expect(names()[0]).toContain("Two Truths and a Lie");
    expect(
      screen.getByRole("button", { name: "Change the date of Two Truths and a Lie" })
    ).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(names()[0]).toContain("Desert Island Pick");
  });
});

// ─────────────────────────────────────────────────────────────
describe("review fixes", () => {
  it("re-dates a use only onto a day its activity has no use on", () => {
    const list = [use("a", "q-1", 1), use("b", "q-1", 3), use("c", "q-2", 1)];
    const threeDaysAgo = list[1].usedAt;
    expect(usedOnDay(list, "q-1", threeDaysAgo)).toBe(true);
    // The use being moved doesn't count against its own day.
    expect(usedOnDay(list, "q-1", threeDaysAgo, "b")).toBe(false);
    expect(usedOnDay(list, "q-2", threeDaysAgo)).toBe(false);

    const clash = withUseDate(list, "a", threeDaysAgo);
    expect(clash.changed).toBe(false);
    expect(clash.next).toEqual(list);
    // Another activity's use that day is no clash; nor is the use's own day.
    const moved = withUseDate(list, "c", threeDaysAgo);
    expect(moved.changed).toBe(true);
    expect(moved.next.find((u) => u.id === "c")?.usedAt).toBe(threeDaysAgo);
    expect(withUseDate(list, "a", list[0].usedAt).changed).toBe(true);
    expect(withUseDate(list, "missing", threeDaysAgo).changed).toBe(false);
    expect(withUseDate([], "a", threeDaysAgo)).toEqual({ next: [], changed: false });
  });

  it("marks a use while another page's timer holds the dock", async () => {
    useDockTimer.setState({ timer: ceremonyDock() });
    useIcebreakerSession.setState({ selectedId: "q-2", runningId: null });
    await mount();
    expect(screen.queryByRole("button", { name: /min timer/ })).not.toBeInTheDocument();
    expect(screen.getByText(/you can still mark it as used/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as used" }));
    fireEvent.click(screen.getByRole("button", { name: "Record use" }));
    expect(settings().used.map((u) => [u.icebreakerId, dayOfUse(u.usedAt)])).toEqual([
      ["q-2", todayLocalISO()],
    ]);
    expect(useDockTimer.getState().timer?.href).toBe("/ceremony-timer");
    // Focus returns to the button that opened the form.
    expect(screen.getByRole("button", { name: "Mark as used" })).toHaveFocus();
  });

  it("refuses to re-date a use onto a day it already has, in the form", async () => {
    const now = new Date();
    const [a, b] = [use("a", "q-1", 1, now), use("b", "q-1", 3, now)];
    useIcebreakerSettings.setState({ used: [a, b] });
    await mount();
    const history = screen.getByRole("list", { name: "Icebreakers used, newest first" });
    fireEvent.click(
      within(history).getAllByRole("button", { name: "Change the date of Two Truths and a Lie" })[0]
    );
    const day = within(history).getByLabelText(/Used on/);
    fireEvent.change(day, { target: { value: dayOfUse(b.usedAt) } });
    fireEvent.click(within(history).getByRole("button", { name: "Save date" }));
    expect(within(history).getByText("It's already recorded for that day.")).toBeInTheDocument();
    expect(day).toHaveAttribute("aria-invalid", "true");
    expect(settings().used.map((u) => u.usedAt)).toEqual([a.usedAt, b.usedAt]);
  });

  it("titles the whole list History, as the export does", async () => {
    const now = new Date();
    useIcebreakerSettings.setState({ used: [use("a", "q-1", 1, now), use("b", "q-2", 30, now)] });
    await mount();
    expect(screen.getByText("History (2)")).toBeInTheDocument();
    expect(screen.queryByText(/Recently used/)).not.toBeInTheDocument();
    const md = toMarkdown({ selected: null, people: null, favorites: [], used: [] }, NOW);
    expect(md).toContain("## History");
    expect(md).not.toContain("Used recently");
  });

  it("moves to the featured card even when it already shows that activity", async () => {
    await mount();
    const first = icebreakers[0];
    const heading = () => screen.getByRole("heading", { level: 2, name: first.name });
    fireEvent.click(within(grid()).getByRole("button", { name: first.name }));
    expect(heading()).toHaveFocus();
    act(() => screen.getByRole("button", { name: "Random Pick" }).focus());
    fireEvent.click(within(grid()).getByRole("button", { name: first.name }));
    expect(heading()).toHaveFocus();
  });

  it("keeps focus on the control that replaces the one pressed", async () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana" },
        { id: "m2", name: "Bo" },
      ],
    });
    useIcebreakerSession.setState({ selectedId: "q-1", runningId: null });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Start 10-min timer" }));
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(screen.getByRole("button", { name: "Start 10-min timer" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Mark as used" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Mark as used" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Use team size (2)" }));
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
  });

  it("says which of its own timers Start would replace", async () => {
    useIcebreakerSession.setState({ selectedId: "q-1", runningId: null });
    await mount();
    expect(screen.queryByText(/Replaces the/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start 10-min timer" }));
    fireEvent.click(within(grid()).getByRole("button", { name: ib("q-2").name }));
    expect(screen.getByText("Replaces the Two Truths and a Lie timer.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start 5-min timer" }));
    expect(useDockTimer.getState().timer?.label).toBe("Desert Island Pick");
    expect(screen.queryByText(/Replaces the/)).not.toBeInTheDocument();
  });

  it("gives the time and people badges a defined background", async () => {
    useIcebreakerSession.setState({ selectedId: "q-1", runningId: null });
    const { container } = await mount();
    expect(container.querySelector(".bg-cardH")).toBeNull();
    expect(container.querySelectorAll(".bg-card-hover").length).toBeGreaterThan(2);
  });
});
