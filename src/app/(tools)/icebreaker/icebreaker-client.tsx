"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Filter, Shuffle, Sparkles, Tag, Zap } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ExampleNotice, hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { icebreakers, type IceBreaker } from "@/lib/constants/icebreakers";
import { ICEBREAKER_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useDockTimer } from "@/lib/timer/dock-timer";
import { todayLocalISO } from "@/lib/utils/formatters";
import { toast } from "@/lib/utils/toast";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { DockClock } from "./components/dock-clock";
import { FeaturedCard } from "./components/featured-card";
import { ChipGroup, Choices, FilterChip } from "./components/filter-chips";
import { IcebreakerCard } from "./components/icebreaker-card";
import { PeopleField } from "./components/people-field";
import { RecentlyUsed } from "./components/recently-used";
import { EXAMPLE_SELECTED_ID, buildExample } from "./example";
import {
  RECENT_DAYS,
  daysAgoText,
  filterIcebreakers,
  lastUsedAt,
  pickRandom,
  recentIds,
  relaxHint,
  withUse,
  withUseDate,
  type Category,
  type Energy,
  type IcebreakerFilters,
} from "./filter";
import { CATEGORY_CHOICES, ENERGY_CHOICES, TIME_CHOICES } from "./labels";
import { toMarkdown } from "./markdown";
import { runIcebreakerFavoritesMigration } from "./migrate";
import { rosterHeadcount, validateHeadcount } from "./sizes";
import {
  normalizeFavorites,
  normalizeUses,
  updateFavorites,
  updateUses,
  useIcebreakerSession,
  useIcebreakerSettings,
  type IcebreakerUse,
} from "./store";
import {
  ICEBREAKER_HREF,
  otherDock,
  runningIdFor,
  startIcebreakerTimer,
  stopIcebreakerTimer,
} from "./timer";
import { icebreakerVerdict } from "./verdict";

const byId = new Map(icebreakers.map((ib) => [ib.id, ib]));
const nameOf = (id: string) => byId.get(id)?.name ?? id;

/** Flashes before Random Pick lands, unless the user asked for less motion. */
const SPIN_FLASHES = 6;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export function IceBreakerClient() {
  const { log } = useHistoryLogger("icebreaker");
  const announce = useAnnounce();

  // ── Saved settings and this tab's session ─────────────────
  const rawFavorites = useIcebreakerSettings((s) => s.favorites);
  const rawUsed = useIcebreakerSettings((s) => s.used);
  const hideRecent = useIcebreakerSettings((s) => s.hideRecent) === true;
  const favorites = useMemo(() => normalizeFavorites(rawFavorites), [rawFavorites]);
  const used = useMemo(() => normalizeUses(rawUsed), [rawUsed]);
  const selectedId = useIcebreakerSession((s) => s.selectedId);
  const sessionRunningId = useIcebreakerSession((s) => s.runningId);

  const dock = useDockTimer((s) => s.timer);
  const ownTimer = dock?.href === ICEBREAKER_HREF ? dock : null;
  const otherTimer = otherDock(dock);
  const runningId = runningIdFor(sessionRunningId, dock);

  // This tab's session is read back on mount; until then a docked clock of
  // ours isn't "from an earlier visit" yet.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    const settings = useIcebreakerSettings.persist;
    const session = useIcebreakerSession.persist;
    void Promise.resolve(session.hasHydrated() ? undefined : session.rehydrate()).finally(() =>
      setSessionReady(true)
    );
    // The old favourites move in once the saved settings have loaded, so
    // the move fills gaps instead of writing over them.
    void Promise.resolve(settings.hasHydrated() ? undefined : settings.rehydrate())
      .then(() => runIcebreakerFavoritesMigration())
      .catch(() => {
        /* storage blocked: the old keys stay and move on a later visit */
      });
  }, []);

  // A timer stopped from the pill on another page leaves the session
  // remembering it: forget it, so the page doesn't show a clock that's gone.
  useEffect(() => {
    if (sessionRunningId && !runningId) useIcebreakerSession.setState({ runningId: null });
  }, [sessionRunningId, runningId]);

  // ── Filters ───────────────────────────────────────────────
  const roster = useTeamRoster();
  const hydrated = useWorkspaceHydrated();
  const fromRoster = rosterHeadcount(roster.length, hydrated);
  /** What's typed in People; null while it follows the roster. */
  const [peopleText, setPeopleText] = useState<string | null>(null);
  const headcount =
    peopleText === null ? { value: fromRoster, error: undefined } : validateHeadcount(peopleText);
  const people = headcount.value;
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [energy, setEnergy] = useState<Energy | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const today = todayLocalISO();
  const filters: IcebreakerFilters = {
    people,
    maxMinutes,
    energy,
    category,
    // With no favourites left, the chip is gone and must not keep filtering.
    favoritesOnly: favoritesOnly && favorites.length > 0,
    hideRecent,
  };
  // 55 activities: cheap enough to filter on every render.
  const { matches, hiddenRecent } = filterIcebreakers(
    icebreakers,
    filters,
    { favorites, used },
    new Date()
  );
  const recent = recentIds(used, new Date());
  const relax =
    matches.length === 0 && hiddenRecent.length === 0
      ? relaxHint(icebreakers, filters, { favorites, used }, new Date())
      : null;
  const verdict = icebreakerVerdict({
    matches: matches.length,
    people,
    maxMinutes,
    hiddenRecent: hiddenRecent.length,
    relax,
  });

  const clearFilters = () => {
    setPeopleText("");
    setMaxMinutes(null);
    setEnergy(null);
    setCategory(null);
    setFavoritesOnly(false);
  };

  const usedText = (id: string): string | null => {
    if (!recent.has(id)) return null;
    const at = lastUsedAt(used, id);
    return at ? `Used ${daysAgoText(at, new Date())}` : null;
  };

  // ── Selection, Random Pick and focus ──────────────────────
  const [flashId, setFlashId] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const featuredRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<"focus" | "scroll" | null>(null);
  /** Bumped by every selection, so choosing the activity already shown still moves to it. */
  const [selectCount, setSelectCount] = useState(0);
  const shown = byId.get(flashId ?? selectedId ?? "") ?? null;

  useEffect(
    () => () => {
      if (spinRef.current) clearInterval(spinRef.current);
    },
    []
  );

  // After a card is chosen, the featured card is where the user looks next:
  // at 375 px it renders far above the grid, so without this nothing moved.
  // It runs on every selection, the shown activity's own card included.
  useEffect(() => {
    const how = pendingFocus.current;
    if (!how || flashId) return;
    pendingFocus.current = null;
    const el = featuredRef.current;
    el?.scrollIntoView?.({ block: how === "focus" ? "start" : "nearest" });
    if (how === "focus") el?.focus({ preventScroll: true });
  }, [selectCount, selectedId, flashId]);

  const select = useCallback((id: string, how: "focus" | "scroll") => {
    pendingFocus.current = how;
    useIcebreakerSession.setState({ selectedId: id });
    setSelectCount((n) => n + 1);
  }, []);

  const handleRandomPick = () => {
    if (matches.length === 0) return;
    if (spinRef.current) clearInterval(spinRef.current);
    // The pick is made from the matches as they are now: a filter changed
    // mid-spin can't land it on something it no longer shows.
    const snapshot = matches;
    const final = pickRandom(snapshot, selectedId);
    if (!final) return;
    const land = () => {
      spinRef.current = null;
      setFlashId(null);
      setIsSpinning(false);
      select(final.id, "scroll");
      announce(`Picked ${final.name}: ${final.timeMinutes} minutes.`);
      log(ICEBREAKER_ACTIONS.PROMPT_DRAWN, {
        promptId: final.id,
        name: final.name,
        category: final.category,
      });
    };
    // One match: nothing to shuffle through, and a spin that lands where it
    // started looks broken.
    if (snapshot.length === 1 || prefersReducedMotion()) {
      land();
      return;
    }
    setIsSpinning(true);
    let count = 0;
    spinRef.current = setInterval(() => {
      setFlashId(snapshot[Math.floor(Math.random() * snapshot.length)].id);
      count++;
      if (count >= SPIN_FLASHES) {
        if (spinRef.current) clearInterval(spinRef.current);
        land();
      }
    }, 80);
  };

  // ── Favourites ────────────────────────────────────────────
  const toggleFavorite = (id: string) => {
    const isFav = favorites.includes(id);
    if (isFav) {
      removeWithUndo<string>({
        label: `Removed ${nameOf(id)} from favorites`,
        update: updateFavorites,
        match: (x) => x === id,
      });
    } else {
      updateFavorites((list) => [...list, id]);
    }
    log(ICEBREAKER_ACTIONS.PROMPT_FAVORITED, { promptId: id, action: isFav ? "removed" : "added" });
  };

  // ── Uses and the timer ────────────────────────────────────
  /** Record that `ib` ran on `usedAt`'s day, with Undo; one use per day. */
  const recordUse = (ib: IceBreaker, usedAt: string, how: "timer" | "marked") => {
    const use: IcebreakerUse = {
      id: crypto.randomUUID(),
      icebreakerId: ib.id,
      usedAt,
      minutes: ib.timeMinutes,
    };
    if (!withUse(used, use).added) {
      if (how === "marked") {
        toast(`${ib.name} is already recorded for that day`);
      }
      return;
    }
    undoable({
      label: `Recorded ${ib.name} as used`,
      apply: () => {
        updateUses((list) => withUse(list, use).next);
        log(ICEBREAKER_ACTIONS.USE_RECORDED, { promptId: ib.id, usedAt, how });
      },
      revert: () => {
        updateUses((list) => list.filter((u) => u.id !== use.id));
        log(ICEBREAKER_ACTIONS.USE_REMOVED, { promptId: ib.id, usedAt });
      },
    });
  };

  const startTimer = (ib: IceBreaker) => {
    const claim = startIcebreakerTimer(ib);
    if (!claim.ok) {
      announce(`The ${claim.holder.label} timer is running. Stop it before starting this one.`);
      return;
    }
    useIcebreakerSession.setState({ runningId: ib.id, selectedId: ib.id });
    announce(`${ib.name}: ${ib.timeMinutes}-minute timer started.`);
    log(ICEBREAKER_ACTIONS.TIMER_STARTED, { promptId: ib.id, minutes: ib.timeMinutes });
    recordUse(ib, new Date().toISOString(), "timer");
  };

  const stopTimer = () => {
    const label = ownTimer?.label;
    stopIcebreakerTimer();
    useIcebreakerSession.setState({ runningId: null });
    if (label) announce(`${label} timer stopped.`);
  };

  const removeUse = (u: IcebreakerUse) => {
    removeWithUndo<IcebreakerUse>({
      label: `Removed ${nameOf(u.icebreakerId)} from the history`,
      update: updateUses,
      match: (x) => x.id === u.id,
    });
    log(ICEBREAKER_ACTIONS.USE_REMOVED, { promptId: u.icebreakerId, usedAt: u.usedAt });
  };

  /** Re-date a use; never onto a day its activity already has one (see withUse). */
  const changeUseDate = (u: IcebreakerUse, usedAt: string) => {
    // The form already refuses a taken day; this covers a sync landing in between.
    if (!withUseDate(used, u.id, usedAt).changed) {
      toast(`${nameOf(u.icebreakerId)} is already recorded for that day`);
      return;
    }
    updateUses((list) => withUseDate(list, u.id, usedAt).next);
  };

  const restoreUses = (rows: IcebreakerUse[]) =>
    updateUses((list) => [...list, ...rows.filter((r) => !list.some((x) => x.id === r.id))]);

  // ── Example ───────────────────────────────────────────────
  const loadExample = () => {
    const ex = buildExample(new Date());
    restoreUses(ex.used);
    select(ex.selectedId, "scroll");
  };
  const clearExample = () => {
    updateUses((list) => list.filter((u) => !isExampleId(u.id)));
    if (useIcebreakerSession.getState().selectedId === EXAMPLE_SELECTED_ID && !runningId) {
      useIcebreakerSession.setState({ selectedId: null });
    }
  };

  const running = runningId ? (byId.get(runningId) ?? null) : null;
  const markdown = toMarkdown({ selected: shown, people, favorites, used });

  return (
    <ToolPageWrapper
      toolId="icebreaker"
      title="Ice Breaker Generator"
      description="Find a warm-up that fits your team: filter by people, time, energy and category, skip what you used recently, then run it on the docked timer."
      category="Ceremonies"
    >
      <div className="space-y-8">
        {hasExampleItems(used) && <ExampleNotice onClear={clearExample} />}

        <ActionRow>
          <ExportButton
            filename="icebreaker"
            markdown={markdown}
            jsonData={{ selected: shown?.id ?? null, people, favorites, used }}
          />
        </ActionRow>

        {/* A clock this page owns but isn't showing below. */}
        {ownTimer && sessionReady && (!running || running.id !== shown?.id) && (
          <Card className="bg-card border-accent-cyan/30">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <p className="min-w-0 flex-1 text-sm text-text">
                {running
                  ? `Now timing ${running.name}.`
                  : `A ${ownTimer.label} timer from an earlier visit is still running.`}
              </p>
              <DockClock timer={ownTimer} onStop={stopTimer} size="sm" />
              {running && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => select(running.id, "focus")}
                >
                  Show {running.name}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Filters ────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardContent className="p-5 space-y-4">
            <PeopleField
              fromRoster={fromRoster}
              text={peopleText}
              error={headcount.error}
              onTextChange={setPeopleText}
              onUseRoster={() => setPeopleText(null)}
            />

            <ChipGroup
              id="icebreaker-filter-time"
              icon={<Clock className="w-3.5 h-3.5" aria-hidden="true" />}
              label="Time"
            >
              <Choices choices={TIME_CHOICES} value={maxMinutes} onChange={setMaxMinutes} />
            </ChipGroup>

            <ChipGroup
              id="icebreaker-filter-energy"
              icon={<Zap className="w-3.5 h-3.5" aria-hidden="true" />}
              label="Energy Level"
            >
              <Choices choices={ENERGY_CHOICES} value={energy} onChange={setEnergy} />
            </ChipGroup>

            <ChipGroup
              id="icebreaker-filter-category"
              icon={<Tag className="w-3.5 h-3.5" aria-hidden="true" />}
              label="Category"
            >
              <Choices
                choices={CATEGORY_CHOICES}
                value={category}
                onChange={(next) => {
                  setCategory(next);
                  log(ICEBREAKER_ACTIONS.CATEGORY_CHANGED, { category: next ?? "all" });
                }}
              />
            </ChipGroup>

            {(favorites.length > 0 || recent.size > 0 || hideRecent) && (
              <ChipGroup
                id="icebreaker-filter-show"
                icon={<Filter className="w-3.5 h-3.5" aria-hidden="true" />}
                label="Show"
              >
                {favorites.length > 0 && (
                  <FilterChip
                    label={`Favorites only (${favorites.length})`}
                    active={favoritesOnly}
                    onClick={() => setFavoritesOnly((v) => !v)}
                  />
                )}
                {(recent.size > 0 || hideRecent) && (
                  <FilterChip
                    label={`Hide used in the last ${RECENT_DAYS / 7} weeks (${recent.size})`}
                    active={hideRecent}
                    onClick={() => useIcebreakerSettings.setState({ hideRecent: !hideRecent })}
                  />
                )}
              </ChipGroup>
            )}
          </CardContent>
        </Card>

        {/* ── Random Pick and the verdict ────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <Button
            onClick={handleRandomPick}
            disabled={matches.length === 0 || isSpinning}
            className="bg-accent-cyan text-bg font-bold hover:bg-accent-cyan/90 shadow-neon-cyan transition-all duration-200 px-6"
            size="lg"
          >
            <Shuffle
              className={`w-5 h-5 mr-2 ${isSpinning ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {isSpinning ? "Picking..." : "Random Pick"}
          </Button>
          <p className="min-w-0 flex-1 basis-60 text-sm font-medium text-text">{verdict}</p>
        </div>

        {/* ── Featured Card ──────────────────────────────── */}
        {shown && (
          <FeaturedCard
            // A new activity starts with its own card: no "Mark as used"
            // form left open from the last one.
            key={shown.id}
            ref={featuredRef}
            icebreaker={shown}
            isFavorite={favorites.includes(shown.id)}
            onToggleFavorite={toggleFavorite}
            usedText={usedText(shown.id)}
            ownTimer={running?.id === shown.id ? ownTimer : null}
            otherTimer={otherTimer}
            // Start publishes over this page's own clock, so say whose it is.
            replacesTimer={ownTimer && running?.id !== shown.id ? ownTimer.label : null}
            today={today}
            onStartTimer={() => startTimer(shown)}
            onStopTimer={stopTimer}
            onMarkUsed={(usedAt) => recordUse(shown, usedAt, "marked")}
          />
        )}

        {/* ── Browse All ─────────────────────────────────── */}
        <div className="space-y-4">
          <h2 className="text-lg font-display font-bold text-text">Browse All</h2>
          {matches.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              action={
                hiddenRecent.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => useIcebreakerSettings.setState({ hideRecent: false })}
                  >
                    Include the recent ones
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )
              }
            >
              {verdict}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {matches.map((ib) => (
                <IcebreakerCard
                  key={ib.id}
                  icebreaker={ib}
                  isFavorite={favorites.includes(ib.id)}
                  usedText={usedText(ib.id)}
                  onToggleFavorite={toggleFavorite}
                  onSelect={(picked) => select(picked.id, "focus")}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── History ────────────────────────────────────── */}
        <RecentlyUsed
          uses={used}
          now={new Date()}
          today={today}
          canLoadExample={used.length === 0 && favorites.length === 0}
          onLoadExample={loadExample}
          onSelect={(id) => select(id, "focus")}
          onChangeDate={changeUseDate}
          onRemove={removeUse}
          onClear={() => updateUses(() => [])}
          onRestore={restoreUses}
        />
      </div>
    </ToolPageWrapper>
  );
}
