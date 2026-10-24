import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LsFavorite } from "@/lib/stores/workspace-types";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/liberating-structures";
import { LIBERATING_STRUCTURES_ACTIONS } from "@/lib/history/event-actions";

/**
 * Liberating Structures upgrade: the catalog as data (people ranges,
 * purposes, ceremonies, timed steps), filters by people, purpose, ceremony
 * and timing, a step timer on the docked timer that never takes another
 * page's clock, favourites counted once with Undo on removal, deep links,
 * example data, a verdict and a Markdown plan.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
const logSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: logSpy }),
}));

import { LiberatingStructuresClient } from "@/app/(tools)/liberating-structures/liberating-structures-client";
import {
  LS_CATALOG,
  fitsGroup,
  isLsStructureId,
  lsPeopleLabel,
  lsStructure,
  stepsMinutes,
  type LsStructure,
} from "@/lib/liberating-structures/catalog";
import { LS_DOC_ID } from "@/lib/liberating-structures/doc";
import {
  LS_FILTER_CEREMONIES,
  NO_FILTERS,
  bucketFor,
  filterStructures,
  readDeepLink,
  relaxLsFilter,
  validatePeople,
} from "@/app/(tools)/liberating-structures/filters";
import { lsVerdict } from "@/app/(tools)/liberating-structures/verdict";
import { catalogFavorites, withFavorite } from "@/app/(tools)/liberating-structures/favorites";
import {
  LS_HREF,
  advanceStepTimer,
  normalizeLsSession,
  runIsLive,
  startStepTimer,
  stopStepTimer,
  timedSteps,
  useLsSession,
} from "@/app/(tools)/liberating-structures/session";
import { toMarkdown } from "@/app/(tools)/liberating-structures/markdown";
import { buildExample } from "@/app/(tools)/liberating-structures/example";
import { isExampleId } from "@/components/tool-frame/example-data";

const s = (id: string) => lsStructure(id)!;
const fav = (id: string, structureId: string): LsFavorite => ({
  id,
  structureId,
  ts: "2026-10-20T10:00:00.000Z",
});
const favorites = () =>
  (useWorkspaceStore.getState().liberatingStructures ?? []).find((d) => d.id === LS_DOC_ID)
    ?.favorites ?? [];
const setFavorites = (list: LsFavorite[]) =>
  useWorkspaceStore.setState({ liberatingStructures: [{ id: LS_DOC_ID, favorites: list }] });
const ceremonyDock = (over: Partial<DockedTimer> = {}): DockedTimer => ({
  label: "Retro",
  href: "/ceremony-timer",
  totalSeconds: 3600,
  endsAt: Date.now() + 60_000,
  pausedRemaining: 3600,
  ...over,
});
const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

async function mount() {
  const view = render(
    <TooltipProvider>
      <LiberatingStructuresClient />
    </TooltipProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}
const undoOf = (label: string) => {
  const call = [...toastSpy.mock.calls].reverse().find((c) => c[0] === label);
  expect(call, `toast "${label}"`).toBeTruthy();
  return () => act(() => call![1].action.onClick());
};
const card = (name: string) =>
  screen.getByRole("button", { name, expanded: false }).closest("[id^=ls-card-]") as HTMLElement;
const shownNames = () =>
  screen.queryAllByRole("button", { expanded: false }).map((b) => b.textContent ?? "");

beforeEach(() => {
  toastSpy.mockReset();
  logSpy.mockReset();
  sessionStorage.clear();
  useDockTimer.setState({ timer: null });
  useLsSession.setState({ structureId: null, run: null });
  useWorkspaceStore.setState({ liberatingStructures: [], teamMembers: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

// ─────────────────────────────────────────────────────────────
describe("the catalog", () => {
  it("keeps every saved structure id", () => {
    expect(LS_CATALOG.map((x) => x.id)).toEqual([
      "ls-1-2-4-all",
      "ls-impromptu",
      "ls-9-whys",
      "ls-wise-crowds",
      "ls-25-10",
      "ls-troika",
      "ls-winfy",
      "ls-dad",
      "ls-ecocycle",
      "ls-cafe",
      "ls-triz",
      "ls-open-space",
    ]);
    expect(isLsStructureId("ls-troika")).toBe(true);
    expect(isLsStructureId("1-2-4")).toBe(false);
    expect(lsStructure(null)).toBeUndefined();
  });

  it("times each structure's steps to its planned length", () => {
    for (const x of LS_CATALOG) {
      if (x.steps === null) {
        expect(stepsMinutes(x)).toBeNull();
        continue;
      }
      expect(stepsMinutes(x), x.id).toBe(x.timingMinutes);
      expect(new Set(x.steps.map((st) => st.id)).size, x.id).toBe(x.steps.length);
      expect(
        x.steps.every((st) => st.minutes > 0 && st.hint.length > 0),
        x.id
      ).toBe(true);
    }
    expect(s("ls-1-2-4-all").steps!.map((st) => st.minutes)).toEqual([1, 2, 4, 5]);
    expect(s("ls-1-2-4-all").ceremonyTimerAgenda).toBe("one-two-four-all");
    expect(s("ls-open-space").steps).toBeNull();
  });

  it("fits a group by its people range, edges included", () => {
    const troika = s("ls-troika"); // 3+
    expect([2, 3, 500].map((n) => fitsGroup(troika, n))).toEqual([false, true, true]);
    expect(fitsGroup(troika, null)).toBe(true);
    const capped: LsStructure = { ...troika, minPeople: 5, maxPeople: 30 };
    expect([4, 5, 30, 31].map((n) => fitsGroup(capped, n))).toEqual([false, true, true, false]);
    expect(lsPeopleLabel(capped)).toBe("5–30 people");
    expect(lsPeopleLabel(troika)).toBe("3+ people");
    // A team of eight no longer loses Troika and 9 Whys to a size bucket.
    const eight = filterStructures(LS_CATALOG, { ...NO_FILTERS, people: 8 }).map((x) => x.id);
    expect(eight).toEqual(expect.arrayContaining(["ls-troika", "ls-9-whys", "ls-wise-crowds"]));
    expect(eight).not.toContain("ls-25-10");
  });
});

// ─────────────────────────────────────────────────────────────
describe("filters", () => {
  it("validates the People field", () => {
    expect(validatePeople("")).toEqual({ value: null });
    expect(validatePeople(" 12 ")).toEqual({ value: 12 });
    expect(validatePeople("10000")).toEqual({ value: 10000 });
    expect(validatePeople("1").error).toMatch(/at least 2/);
    expect(validatePeople("10001").error).toMatch(/10,000 people or fewer/);
    expect(validatePeople("3.5").error).toMatch(/whole number/);
    expect(validatePeople("lots").error).toMatch(/whole number/);
  });

  it("filters by purpose, ceremony and timing", () => {
    const ids = (f: Partial<typeof NO_FILTERS>) =>
      filterStructures(LS_CATALOG, { ...NO_FILTERS, ...f }).map((x) => x.id);
    expect(ids({ purpose: "get-help" })).toEqual(["ls-wise-crowds", "ls-troika"]);
    expect(ids({ purpose: "prioritize" })).toEqual(["ls-25-10"]);
    expect(ids({ ceremony: "refinement" })).toEqual(["ls-1-2-4-all", "ls-wise-crowds"]);
    expect(ids({ ceremony: "retro", timing: "under 15 min" })).toEqual(["ls-1-2-4-all"]);
    expect(ids({ purpose: "ideas", people: 6 })).toEqual(["ls-1-2-4-all"]);
    expect([14, 15, 30, 31].map(bucketFor)).toEqual([
      "under 15 min",
      "15-30 min",
      "15-30 min",
      "30+ min",
    ]);
    // No structure is for the Daily Scrum, so it gets no chip.
    expect(LS_FILTER_CEREMONIES).toEqual(["planning", "refinement", "review", "retro"]);
  });

  it("reads deep links and ignores what the catalog doesn't know", () => {
    expect(readDeepLink("?structure=ls-troika&ceremony=retro")).toEqual({
      structureId: "ls-troika",
      ceremony: "retro",
    });
    expect(readDeepLink("?structure=nope&ceremony=daily")).toEqual({
      structureId: null,
      ceremony: null,
    });
    expect(readDeepLink("")).toEqual({ structureId: null, ceremony: null });
  });

  it("says what fits and which filter to relax", () => {
    const f = {
      ...NO_FILTERS,
      people: 12,
      ceremony: "retro" as const,
      timing: "under 15 min" as const,
    };
    expect(lsVerdict({ matches: filterStructures(LS_CATALOG, f), filters: f })).toBe(
      "1 structure fits 12 people in a retro in under 15 minutes: 1-2-4-All (12 min)."
    );
    const retro = { ...NO_FILTERS, ceremony: "retro" as const };
    expect(lsVerdict({ matches: filterStructures(LS_CATALOG, retro), filters: retro })).toBe(
      "8 structures fit in a retro; 1-2-4-All is the quickest (12 min)."
    );
    expect(lsVerdict({ matches: LS_CATALOG, filters: NO_FILTERS })).toBe(
      "12 structures to choose from; 1-2-4-All is the quickest (12 min)."
    );
    const none = { ...NO_FILTERS, people: 3, purpose: "prioritize" as const };
    const relax = relaxLsFilter(LS_CATALOG, none);
    // Three people can run 9 Whys and Troika; 25/10 needs ten.
    expect(relax).toEqual({ filter: "purpose", count: 2 });
    expect(lsVerdict({ matches: [], filters: none, relax })).toBe(
      "No structure fits 3 people to prioritize. Remove the Purpose filter to see 2."
    );
    expect(relaxLsFilter(LS_CATALOG, NO_FILTERS)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe("favourites", () => {
  it("counts each catalog structure once and drops unknown ids", () => {
    const list = [
      fav("a", "1-2-4"), // the agent's toggle accepts any id
      fav("b", "ls-troika"),
      fav("c", "ls-troika"),
      null as unknown as LsFavorite,
      fav("d", "ls-triz"),
    ];
    expect(catalogFavorites(list).map((f) => [f.favorite.id, f.structure.id])).toEqual([
      ["b", "ls-troika"],
      ["d", "ls-triz"],
    ]);
    expect(catalogFavorites(undefined)).toEqual([]);
    expect(withFavorite([fav("b", "ls-troika")], fav("x", "ls-troika"))).toHaveLength(1);
    expect(withFavorite([], fav("x", "ls-troika"))).toEqual([fav("x", "ls-troika")]);
  });

  it("builds an example retro plan with example ids", () => {
    const ex = buildExample(new Date("2026-10-24T10:00:00Z"));
    expect(ex.ceremony).toBe("retro");
    expect(ex.favorites.map((f) => f.structureId)).toEqual([
      "ls-impromptu",
      "ls-1-2-4-all",
      "ls-25-10",
    ]);
    expect(ex.favorites.every((f) => isExampleId(f.id))).toBe(true);
    expect(ex.favorites.every((f) => s(f.structureId).ceremonies.includes("retro"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe("the step timer", () => {
  it("runs the steps one by one on the dock, then frees it", () => {
    const claim = startStepTimer(s("ls-1-2-4-all"), 1_000);
    expect(claim).toMatchObject({ ok: true });
    expect(useDockTimer.getState().timer).toEqual({
      label: "1-2-4-All · 1: alone",
      href: LS_HREF,
      totalSeconds: 60,
      endsAt: 61_000,
      pausedRemaining: 60,
    });
    advanceStepTimer(5_000);
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "1-2-4-All · 2: in pairs",
      totalSeconds: 120,
      endsAt: 125_000,
    });
    advanceStepTimer();
    advanceStepTimer();
    expect(useDockTimer.getState().timer?.label).toBe("1-2-4-All · All: whole group");
    const done = advanceStepTimer();
    expect(done).toMatchObject({ ok: true, run: { finished: true } });
    expect(useDockTimer.getState().timer).toBeNull();
    expect(runIsLive(useLsSession.getState().run, null)).toBe(true); // shown until closed
    expect(advanceStepTimer()).toBeNull();
    stopStepTimer();
    expect(useLsSession.getState()).toEqual({ structureId: null, run: null });
  });

  it("never replaces another page's timer, running or paused at 0:00", () => {
    for (const dock of [ceremonyDock(), ceremonyDock({ endsAt: null, pausedRemaining: 0 })]) {
      useDockTimer.setState({ timer: dock });
      const claim = startStepTimer(s("ls-troika"));
      expect(claim).toEqual({ ok: false, holder: dock });
      expect(useDockTimer.getState().timer).toBe(dock);
      expect(useLsSession.getState().run).toBeNull();
      stopStepTimer();
      expect(useDockTimer.getState().timer).toBe(dock);
    }
    expect(startStepTimer(s("ls-open-space"))).toBeNull(); // no steps, no timer
  });

  it("treats a run whose dock is gone as over", () => {
    const run = startStepTimer(s("ls-triz"));
    expect(run?.ok).toBe(true);
    const r = useLsSession.getState().run;
    expect(runIsLive(r, useDockTimer.getState().timer)).toBe(true);
    expect(runIsLive(r, null)).toBe(false);
    expect(runIsLive(r, ceremonyDock())).toBe(false);
    expect(runIsLive(null, null)).toBe(false);
  });

  it("reads a stored run back only for a known structure", () => {
    expect(normalizeLsSession(null)).toEqual({ structureId: null, run: null });
    expect(normalizeLsSession({ structureId: "nope", run: { index: 0 } }).run).toBeNull();
    expect(normalizeLsSession({ structureId: "ls-dad", run: { index: 0 } }).run).toBeNull();
    const back = normalizeLsSession({ structureId: "ls-1-2-4-all", run: { index: 99 } });
    expect(back.run).toMatchObject({
      owner: LS_HREF,
      title: "1-2-4-All",
      index: 3,
      finished: false,
    });
    expect(back.run?.steps).toEqual(timedSteps(s("ls-1-2-4-all")));
  });
});

// ─────────────────────────────────────────────────────────────
describe("Markdown", () => {
  it("exports the open structure as a timed plan, and the favourites", () => {
    const md = toMarkdown(
      {
        selected: s("ls-1-2-4-all"),
        favorites: [s("ls-troika")],
        filters: { ...NO_FILTERS, people: 12, ceremony: "retro" },
      },
      new Date(2026, 9, 24)
    );
    expect(md).toContain("# Liberating Structures — 24 Oct 2026");
    expect(md).toContain("Filtered for: 12 people, Sprint Retrospective.");
    expect(md).toContain("## 1-2-4-All");
    expect(md).toContain("| 0:00 | 1: alone | 1 min | Think about the question in silence. |");
    expect(md).toContain("| 1:00 | 2: in pairs | 2 min |");
    expect(md).toContain("| 7:00 | All: whole group | 5 min |");
    expect(md).toContain("Total: 12 min.");
    expect(md).toContain("- **Troika Consulting** (30 min, 3+ people)");
    const open = toMarkdown(
      { selected: s("ls-open-space"), favorites: [], filters: NO_FILTERS },
      new Date(2026, 9, 24)
    );
    expect(open).toContain("It runs as one open session");
    expect(open).toContain("No favorites saved yet.");
    expect(open).not.toContain("Filtered for");
  });
});

// ─────────────────────────────────────────────────────────────
describe("the page", () => {
  it("loads the example from the empty state and clears only example rows", async () => {
    await mount();
    expect(screen.getByText(/No favorites yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example retro plan" }));
    expect(favorites().map((f) => f.structureId)).toEqual([
      "ls-impromptu",
      "ls-1-2-4-all",
      "ls-25-10",
    ]);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    const retro = within(screen.getByRole("group", { name: "Ceremony" }));
    expect(retro.getByRole("button", { name: "Retro" })).toHaveAttribute("aria-pressed", "true");

    act(() => setFavorites([...favorites(), fav("mine", "ls-triz")]));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(favorites().map((f) => f.id)).toEqual(["mine"]);
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
    expect(retro.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("counts favourites once and removes one with Undo", async () => {
    const saved = fav("t1", "ls-troika");
    setFavorites([fav("x", "1-2-4"), saved, fav("t2", "ls-troika"), fav("z", "ls-triz")]);
    await mount();
    expect(screen.getByRole("heading", { name: "Your favorites (2)" })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("list", { name: "Favorite structures" })).getByRole("button", {
        name: "Remove Troika Consulting from favorites",
      })
    );
    expect(favorites().map((f) => f.id)).toEqual(["x", "z"]);
    undoOf("Removed Troika Consulting from favorites")();
    // Undo puts back the same rows where they were.
    expect(favorites()).toEqual([
      fav("x", "1-2-4"),
      saved,
      fav("t2", "ls-troika"),
      fav("z", "ls-triz"),
    ]);
  });

  it("opens a favourite's card from the strip, even when filters hide it", async () => {
    setFavorites([fav("t1", "ls-open-space")]);
    await mount();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Ceremony" })).getByRole("button", { name: "Retro" })
    );
    expect(shownNames()).not.toContain("Open Space Technology");
    fireEvent.click(
      within(screen.getByRole("list", { name: "Favorite structures" })).getByRole("button", {
        name: "Open Space Technology",
      })
    );
    expect(
      screen.getByRole("button", { name: "Open Space Technology", expanded: true })
    ).toBeInTheDocument();
  });

  it("filters by the team's size from the roster, and flags a bad number", async () => {
    useWorkspaceStore.setState({
      teamMembers: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, name: `P${i}` })),
    });
    await mount();
    expect(shownNames()).toContain("25/10 Crowd Sourcing");
    fireEvent.click(screen.getByRole("button", { name: "Use team size (5)" }));
    expect(screen.getByLabelText(/People/)).toHaveValue("5");
    expect(shownNames()).not.toContain("25/10 Crowd Sourcing");
    expect(shownNames()).toContain("Troika Consulting");

    const field = screen.getByLabelText(/People/);
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.blur(field);
    expect(screen.getByText("A structure needs at least 2 people.")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("filters by purpose, and shows a way out when nothing fits", async () => {
    await mount();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Purpose" })).getByRole("button", {
        name: "Get help",
      })
    );
    expect(shownNames()).toEqual(["Wise Crowds", "Troika Consulting"]);
    fireEvent.change(screen.getByLabelText(/People/), { target: { value: "2" } });
    expect(
      screen.getAllByText(/No structure fits 2 people to get help with a challenge/).length
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shownNames()).toHaveLength(12);
  });

  it("follows ?structure= and ?ceremony= links", async () => {
    window.history.replaceState(
      {},
      "",
      "/liberating-structures?structure=ls-troika&ceremony=retro"
    );
    await mount();
    expect(
      screen.getByRole("button", { name: "Troika Consulting", expanded: true })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Ceremony" })).getByRole("button", { name: "Retro" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves off a linked ceremony that would hide the linked structure", async () => {
    window.history.replaceState(
      {},
      "",
      "/liberating-structures?structure=ls-open-space&ceremony=retro"
    );
    await mount();
    expect(
      screen.getByRole("button", { name: "Open Space Technology", expanded: true })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Ceremony" })).getByRole("button", { name: "All" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("runs the step timer from a card: start, next, stop", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "1-2-4-All", expanded: false }));
    expect(screen.getByRole("link", { name: "Open in the Ceremony Timer" })).toHaveAttribute(
      "href",
      "/ceremony-timer?agenda=one-two-four-all"
    );
    fireEvent.click(screen.getByRole("button", { name: "Start step timer" }));
    expect(useDockTimer.getState().timer).toMatchObject({
      href: "/liberating-structures",
      label: "1-2-4-All · 1: alone",
      totalSeconds: 60,
    });
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent(/^0[01]:\d\d$/);
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps[0]).toHaveAttribute("aria-current", "step");

    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "1-2-4-All · 2: in pairs",
      totalSeconds: 120,
    });
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(useDockTimer.getState().timer?.endsAt).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(useDockTimer.getState().timer).toBeNull();
    expect(screen.queryByText(/Step timer:/)).not.toBeInTheDocument();
  });

  it("finishes after the last step and shows the total", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "TRIZ", expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Start step timer" }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByText("All 4 steps done (35 min planned).")).toBeInTheDocument();
    expect(useDockTimer.getState().timer).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useLsSession.getState().run).toBeNull();
  });

  it("says who holds the dock instead of starting", async () => {
    useDockTimer.setState({ timer: ceremonyDock({ endsAt: null, pausedRemaining: 0 }) });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Troika Consulting", expanded: false }));
    expect(screen.queryByRole("button", { name: "Start step timer" })).not.toBeInTheDocument();
    expect(within(card("1-2-4-All")).queryByText(/Retro timer is running/)).toBeNull();
    expect(screen.getByText(/The Retro timer is running/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Retro timer" })).toHaveAttribute(
      "href",
      "/ceremony-timer"
    );
    expect(useDockTimer.getState().timer?.href).toBe("/ceremony-timer");
  });

  it("drops a run whose clock was stopped elsewhere, and offers Stop for an orphan", async () => {
    const stored = normalizeLsSession({ structureId: "ls-1-2-4-all", run: { index: 1 } });
    useLsSession.setState(stored);
    const first = await mount();
    expect(useLsSession.getState().run).toBeNull();
    first.unmount();

    useDockTimer.setState({
      timer: { ...ceremonyDock(), href: LS_HREF, label: "TRIZ · Set up the question" },
    });
    await mount();
    expect(
      screen.getByText("A TRIZ · Set up the question timer from an earlier visit is still running.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop it" }));
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("shares one favourites document with the agent actions", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add Troika Consulting to favorites" }));
    const state = (await registry
      .get("tool.liberating_structures.list_state")!
      .handler({}, ctx())) as {
      favoriteStructureIds: string[];
    };
    expect(state.favoriteStructureIds).toEqual(["ls-troika"]);

    await act(async () => {
      await registry
        .get("tool.liberating_structures.toggle_favorite")!
        .handler({ structureId: "ls-triz" }, ctx());
    });
    expect(
      within(card("TRIZ")).getByRole("button", { name: "Remove TRIZ from favorites" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Your favorites (2)" })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────
describe("review fixes", () => {
  const peopleLogs = () =>
    logSpy.mock.calls
      .filter(
        ([action, detail]) =>
          action === LIBERATING_STRUCTURES_ACTIONS.FILTER_CHANGED && "people" in detail
      )
      .map(([, detail]) => detail.people);
  const startButton = () => screen.getByRole("button", { name: "Start step timer" });

  it("logs the People filter once it is settled and valid, not per keystroke", async () => {
    useWorkspaceStore.setState({
      teamMembers: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, name: `P${i}` })),
    });
    await mount();
    const field = screen.getByLabelText(/People/);
    for (const text of ["1", "12", "120"]) fireEvent.change(field, { target: { value: text } });
    expect(peopleLogs()).toEqual([]);
    fireEvent.blur(field);
    expect(peopleLogs()).toEqual(["120"]);
    // The same value again, by Enter or blur, isn't a change.
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(peopleLogs()).toEqual(["120"]);
    // A number the filter can't use isn't logged.
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(peopleLogs()).toEqual(["120"]);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(peopleLogs()).toEqual(["120", "any"]);
    fireEvent.click(screen.getByRole("button", { name: "Use team size (5)" }));
    expect(peopleLogs()).toEqual(["120", "any", "5"]);
  });

  it("moves focus with the step timer: Start, Finish, Close", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "TRIZ", expanded: false }));
    fireEvent.click(startButton());
    expect(screen.getByRole("button", { name: "Pause" })).toHaveFocus();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // The card is still open: its Start button is back.
    expect(startButton()).toHaveFocus();
  });

  it("returns focus to the card's title after Stop when the card was closed", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Troika Consulting", expanded: false }));
    fireEvent.click(startButton());
    fireEvent.click(screen.getByRole("button", { name: "Troika Consulting", expanded: true }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(
      screen.getByRole("button", { name: "Troika Consulting", expanded: false })
    ).toHaveFocus();
  });

  it("announces pause and resume of the step timer", async () => {
    render(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <LiberatingStructuresClient />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "TRIZ", expanded: false }));
    fireEvent.click(startButton());
    const live = screen.getByTestId("live-polite");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(live).toHaveTextContent("TRIZ step timer paused."));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(live).toHaveTextContent("TRIZ step timer resumed."));
  });

  it("focuses and scrolls to a favourite's card, even one already open", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      setFavorites([fav("t1", "ls-troika")]);
      await mount();
      const chip = () =>
        within(screen.getByRole("list", { name: "Favorite structures" })).getByRole("button", {
          name: "Troika Consulting",
        });
      fireEvent.click(chip());
      const title = screen.getByRole("button", { name: "Troika Consulting", expanded: true });
      expect(title).toHaveFocus();
      expect(scroll).toHaveBeenCalledTimes(1);

      // Already open: the click still takes the user there.
      act(() => chip().focus());
      fireEvent.click(chip());
      expect(title).toHaveFocus();
      expect(scroll).toHaveBeenCalledTimes(2);

      // No scroll target is left behind for the next time the card opens.
      fireEvent.click(title);
      fireEvent.click(screen.getByRole("button", { name: "Troika Consulting", expanded: false }));
      expect(scroll).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
