"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CalendarDays, Clock, Star, Target, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { durationText } from "@/app/(tools)/ceremony-timer/agenda";
import { generateLiberatingStructuresPrompts } from "@/lib/ai-prompts/liberating-structures";
import { LIBERATING_STRUCTURES_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  LS_CATALOG,
  LS_PURPOSE_LABEL,
  lsPeopleLabel,
  lsStructure,
  type LsPurpose,
  type LsStructure,
} from "@/lib/liberating-structures/catalog";
import { LS_DOC_ID } from "@/lib/liberating-structures/doc";
import type { CeremonyKind } from "@/lib/sprints/cadence";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LsFavorite, Workspace } from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useDockTimer } from "@/lib/timer/dock-timer";
import { currentStep } from "@/lib/timer/step-timer";
import { removeWithUndo } from "@/lib/utils/undoable";
import { ChipFilter } from "./components/filter-chips";
import { PeopleFilter } from "./components/people-filter";
import { StepTimerPanel } from "./components/step-timer-panel";
import { StructureCard } from "./components/structure-card";
import { EXAMPLE_CEREMONY, buildExample } from "./example";
import { catalogFavorites, withFavorite } from "./favorites";
import {
  CEREMONY_CHIP,
  LS_FILTER_CEREMONIES,
  LS_FILTER_PURPOSES,
  TIMING_BUCKETS,
  TIMING_LABEL,
  filterStructures,
  readDeepLink,
  relaxLsFilter,
  validatePeople,
  type LsFilters,
  type TimingBucket,
} from "./filters";
import { toMarkdown } from "./markdown";
import {
  LS_HREF,
  advanceStepTimer,
  runIsLive,
  startStepTimer,
  stopStepTimer,
  useLsSession,
} from "./session";
import { lsVerdict } from "./verdict";

const NO_FAVORITES: LsFavorite[] = [];

/**
 * The saved favourites (a synced workspace singleton, so the agent's
 * toggles show up here) and a writer that starts from the live document:
 * an Undo or an agent write in between is never overwritten by a stale copy.
 */
function useFavorites(): [
  LsFavorite[],
  (fn: (list: readonly LsFavorite[]) => LsFavorite[]) => void,
] {
  const favorites = useWorkspaceStore(
    (s) => (s.liberatingStructures ?? []).find((d) => d.id === LS_DOC_ID)?.favorites ?? NO_FAVORITES
  );
  const update = (fn: (list: readonly LsFavorite[]) => LsFavorite[]) => {
    const { liberatingStructures, upsertLiberatingStructures } = useWorkspaceStore.getState();
    const cur = (liberatingStructures ?? []).find((d) => d.id === LS_DOC_ID);
    const list = Array.isArray(cur?.favorites) ? cur.favorites : NO_FAVORITES;
    upsertLiberatingStructures({ ...cur, id: LS_DOC_ID, favorites: fn(list) });
  };
  return [Array.isArray(favorites) ? favorites : NO_FAVORITES, update];
}

export function LiberatingStructuresClient() {
  const [favorites, updateFavorites] = useFavorites();
  const { log } = useHistoryLogger("liberating-structures");
  const announce = useAnnounce();

  // ── Filters ───────────────────────────────────────────────
  const [peopleText, setPeopleText] = useState("");
  const [purpose, setPurpose] = useState<LsPurpose | null>(null);
  const [ceremony, setCeremony] = useState<CeremonyKind | null>(null);
  const [timing, setTiming] = useState<TimingBucket | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const roster = useTeamRoster();
  const hydrated = useWorkspaceHydrated();
  const teamSize = hydrated && roster.length >= 2 ? roster.length : null;
  const headcount = validatePeople(peopleText);
  const filters: LsFilters = { people: headcount.value, purpose, ceremony, timing };
  const matches = filterStructures(LS_CATALOG, filters);
  const relax = matches.length === 0 ? relaxLsFilter(LS_CATALOG, filters) : null;
  const verdict = lsVerdict({ matches, filters, relax });

  const clearFilters = () => {
    setPeopleText("");
    setPurpose(null);
    setCeremony(null);
    setTiming(null);
  };

  // `?structure=ls-troika` opens that card, `?ceremony=retro` picks the ceremony.
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    const link = readDeepLink(window.location.search);
    // A ceremony that would hide the linked structure is left off.
    const linked = lsStructure(link.structureId);
    if (link.ceremony && (!linked || linked.ceremonies.includes(link.ceremony))) {
      setCeremony(link.ceremony);
    }
    if (link.structureId) {
      scrollTo.current = link.structureId;
      setExpandedId(link.structureId);
    }
  }, []);
  useEffect(() => {
    const id = scrollTo.current;
    if (!id || expandedId !== id) return;
    scrollTo.current = null;
    document.getElementById(`ls-card-${id}`)?.scrollIntoView?.({ block: "start" });
  }, [expandedId]);

  const handleExpand = (id: string) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next !== null) log(LIBERATING_STRUCTURES_ACTIONS.STRUCTURE_VIEWED, { structureId: id });
  };

  const logFilter = (detail: Record<string, string>) =>
    log(LIBERATING_STRUCTURES_ACTIONS.FILTER_CHANGED, detail);

  // ── Favourites ────────────────────────────────────────────
  const shownFavorites = useMemo(() => catalogFavorites(favorites), [favorites]);
  const favSet = useMemo(
    () => new Set(shownFavorites.map((f) => f.structure.id)),
    [shownFavorites]
  );

  const removeFavorite = (s: LsStructure) => {
    removeWithUndo<LsFavorite>({
      label: `Removed ${s.name} from favorites`,
      update: updateFavorites,
      match: (f) => f?.structureId === s.id,
    });
    log(LIBERATING_STRUCTURES_ACTIONS.STRUCTURE_FAVORITED, {
      structureId: s.id,
      action: "removed",
    });
  };

  const toggleFavorite = (s: LsStructure) => {
    if (favSet.has(s.id)) {
      removeFavorite(s);
      return;
    }
    updateFavorites((list) =>
      withFavorite(list, {
        id: crypto.randomUUID(),
        structureId: s.id,
        ts: new Date().toISOString(),
      })
    );
    log(LIBERATING_STRUCTURES_ACTIONS.STRUCTURE_FAVORITED, { structureId: s.id, action: "added" });
  };

  /** Open a favourite's card, clearing filters that would hide it. */
  const openFavorite = (s: LsStructure) => {
    if (!matches.some((m) => m.id === s.id)) clearFilters();
    scrollTo.current = s.id;
    setExpandedId(s.id);
    log(LIBERATING_STRUCTURES_ACTIONS.STRUCTURE_VIEWED, { structureId: s.id });
  };

  // ── Example ───────────────────────────────────────────────
  const loadExample = () => {
    const ex = buildExample(new Date());
    updateFavorites((list) => ex.favorites.reduce(withFavorite, [...list]));
    setCeremony(ex.ceremony);
  };
  const clearExample = () => {
    updateFavorites((list) => list.filter((f) => !isExampleId(f?.id)));
    if (ceremony === EXAMPLE_CEREMONY) setCeremony(null);
  };

  // ── Step timer ────────────────────────────────────────────
  const run = useLsSession((s) => s.run);
  const runStructureId = useLsSession((s) => s.structureId);
  const dock = useDockTimer((s) => s.timer);
  const ownTimer = dock?.href === LS_HREF ? dock : null;
  const otherTimer = dock && dock.href !== LS_HREF ? dock : null;
  const live = runIsLive(run, dock);
  const liveRun = live ? run : null;
  const runStructure = liveRun ? (lsStructure(runStructureId) ?? null) : null;

  // The run is read back once this tab's session has loaded; until then a
  // docked clock of ours isn't an orphan yet.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    const persist = useLsSession.persist;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).finally(() =>
      setSessionReady(true)
    );
  }, []);

  // A run whose dock was stopped from the pill on another page is over.
  useEffect(() => {
    if (run && !live) useLsSession.setState({ structureId: null, run: null });
  }, [run, live]);

  // Starting from a card far down the grid: bring the timer into view.
  const panelRef = useRef<HTMLDivElement>(null);
  const [scrollToPanel, setScrollToPanel] = useState(false);
  useEffect(() => {
    if (!scrollToPanel) return;
    setScrollToPanel(false);
    panelRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [scrollToPanel]);

  const startTimer = (s: LsStructure) => {
    const claim = startStepTimer(s);
    if (!claim) return;
    if (!claim.ok) {
      announce(`The ${claim.holder.label} timer is running. Stop it before starting this one.`);
      return;
    }
    const step = currentStep(claim.run);
    announce(
      `${s.name} step timer started. Step 1 of ${claim.run.steps.length}: ${step?.label}, ${durationText(step?.seconds ?? 0)}.`
    );
    log(LIBERATING_STRUCTURES_ACTIONS.STEP_TIMER_STARTED, { structureId: s.id });
    setScrollToPanel(true);
  };

  const nextStepNow = () => {
    const claim = advanceStepTimer();
    if (!claim) return;
    if (!claim.ok) {
      announce(`The ${claim.holder.label} timer took the clock. Stop it to carry on.`);
      return;
    }
    const r = claim.run;
    const step = currentStep(r);
    if (r.finished || !step) announce(`${r.title}: all steps done.`);
    else {
      announce(
        `Step ${r.index + 1} of ${r.steps.length}: ${step.label}, ${durationText(step.seconds)}.`
      );
    }
    log(LIBERATING_STRUCTURES_ACTIONS.STEP_ADVANCED, {
      structureId: runStructureId ?? "",
      index: r.index,
      finished: r.finished,
    });
  };

  const stopTimer = () => {
    const title = run?.title;
    stopStepTimer();
    if (title && !run?.finished) announce(`${title} step timer stopped.`);
  };

  // ── AI prompt and export ──────────────────────────────────
  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Liberating Structures Picker",
      prompts: generateLiberatingStructuresPrompts(
        {
          catalog: LS_CATALOG.map((s) => ({
            id: s.id,
            name: s.name,
            purpose: s.purpose,
            timing: s.timing,
            groupSize: lsPeopleLabel(s),
            description: s.description,
          })),
          favoriteIds: shownFavorites.map((f) => f.structure.id),
        },
        workspace
      ),
    }),
    [shownFavorites, workspace]
  );

  const selected = lsStructure(expandedId) ?? runStructure ?? null;
  const favoriteStructures = shownFavorites.map((f) => f.structure);

  return (
    <ToolPageWrapper
      toolId="liberating-structures"
      title="Liberating Structures Picker"
      description="Twelve Liberating Structures that get everyone contributing. Filter by people, purpose, Scrum event and timing, open a card to see its steps, and run them on the step timer."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="liberating-structures"
          markdown={toMarkdown({ selected, favorites: favoriteStructures, filters })}
          csvData={{
            headers: ["Name", "Purpose", "Timing", "People", "Steps", "Source", "Description"],
            rows: favoriteStructures.map((s) => [
              s.name,
              s.purpose,
              s.timing,
              lsPeopleLabel(s),
              s.steps ? s.steps.map((st) => `${st.label} (${st.minutes} min)`).join("; ") : "",
              s.source,
              s.description,
            ]),
          }}
          jsonData={{ favorites: favoriteStructures }}
        />
      </ActionRow>

      {hasExampleItems(favorites.filter(Boolean)) && <ExampleNotice onClear={clearExample} />}

      {liveRun ? (
        <div className="mb-6 scroll-mt-24" ref={panelRef}>
          <StepTimerPanel
            run={liveRun}
            timer={ownTimer}
            onPause={() => useDockTimer.getState().pause()}
            onResume={() => useDockTimer.getState().resume()}
            onNext={nextStepNow}
            onStop={stopTimer}
          />
        </div>
      ) : (
        ownTimer &&
        sessionReady && (
          // The dock is this page's, but no run is behind it (cleared
          // session storage): it can still be stopped.
          <Card className="mb-6 bg-surface border-border">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <p className="min-w-0 flex-1 text-sm text-text">
                A {ownTimer.label} timer from an earlier visit is still running.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={stopTimer}>
                Stop it
              </Button>
            </CardContent>
          </Card>
        )
      )}

      {/* Filters */}
      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-4 space-y-4">
          <PeopleFilter
            text={peopleText}
            error={headcount.error}
            teamSize={teamSize}
            onChange={(text) => {
              setPeopleText(text);
              logFilter({ people: text.trim() || "any" });
            }}
          />
          <ChipFilter
            id="ls-filter-purpose"
            icon={<Target className="w-3.5 h-3.5" aria-hidden="true" />}
            label="Purpose"
            choices={LS_FILTER_PURPOSES}
            labelOf={(p) => LS_PURPOSE_LABEL[p]}
            value={purpose}
            onChange={(p) => {
              setPurpose(p);
              logFilter({ purpose: p ?? "all" });
            }}
          />
          <ChipFilter
            id="ls-filter-ceremony"
            icon={<CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />}
            label="Ceremony"
            choices={LS_FILTER_CEREMONIES}
            labelOf={(c) => CEREMONY_CHIP[c]}
            value={ceremony}
            onChange={(c) => {
              setCeremony(c);
              logFilter({ ceremony: c ?? "all" });
            }}
          />
          <ChipFilter
            id="ls-filter-timing"
            icon={<Clock className="w-3.5 h-3.5" aria-hidden="true" />}
            label="Timing"
            choices={TIMING_BUCKETS}
            labelOf={(t) => TIMING_LABEL[t]}
            value={timing}
            onChange={(t) => {
              setTiming(t);
              logFilter({ timing: t ?? "all" });
            }}
          />
        </CardContent>
      </Card>

      <p className="mb-6 text-sm font-medium text-text">{verdict}</p>

      {/* Favorites */}
      <section className="mb-6" aria-labelledby="ls-favorites-heading">
        <div className="flex items-center gap-2 mb-2">
          <Star className="w-4 h-4 text-accent" aria-hidden="true" />
          <h2 id="ls-favorites-heading" className="text-sm font-semibold text-text">
            Your favorites ({shownFavorites.length})
          </h2>
        </div>
        {shownFavorites.length === 0 ? (
          <EmptyState
            icon={Star}
            padding="md"
            action={<LoadExampleButton onLoad={loadExample} label="Load an example retro plan" />}
          >
            No favorites yet. Open a card and Save the structures for your next session, or load an
            example: three structures that make a retro.
          </EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Favorite structures">
            {shownFavorites.map(({ structure: s }) => (
              <li
                key={s.id}
                className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 pl-3 text-xs text-accent"
              >
                <button
                  type="button"
                  onClick={() => openFavorite(s)}
                  className="min-touch-coarse py-1 font-medium rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {s.name}
                </button>
                <IconButton
                  label={`Remove ${s.name} from favorites`}
                  icon={<X className="h-3.5 w-3.5" />}
                  className="text-accent hover:text-text"
                  onClick={() => removeFavorite(s)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Card grid */}
      {matches.length === 0 ? (
        <EmptyState
          action={
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        >
          {verdict}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {matches.map((s) => (
            <StructureCard
              key={s.id}
              structure={s}
              isFavorite={favSet.has(s.id)}
              expanded={expandedId === s.id}
              onExpand={() => handleExpand(s.id)}
              onToggleFavorite={() => toggleFavorite(s)}
              isRunning={Boolean(liveRun && !liveRun.finished && runStructureId === s.id)}
              ownRunTitle={
                liveRun && !liveRun.finished && runStructureId !== s.id ? liveRun.title : null
              }
              otherTimer={otherTimer}
              onStartTimer={() => startTimer(s)}
            />
          ))}
        </div>
      )}
    </ToolPageWrapper>
  );
}
