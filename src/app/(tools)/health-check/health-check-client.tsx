"use client";

import { useId, useMemo, useState } from "react";
import { create } from "zustand";
import dynamic from "next/dynamic";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { generateHealthCheckPrompts } from "@/lib/ai-prompts/health-check";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_CHECK_DIMENSIONS as DIMENSIONS,
  type Workspace,
  type HealthCheck,
  type HealthDimension as Dimension,
  type HealthTrafficLight as TrafficLight,
  type HealthTrend as Trend,
  type HealthDimensionScore as DimensionScore,
  type HealthCheckSnapshot as CurrentCheck,
  type HealthCheckEntry as HistoryEntry,
} from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HEALTH_CHECK_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { BlurInput } from "@/components/shared/blur-fields";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { HeartPulse } from "lucide-react";
import { healthTrendText } from "./chart-text";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";

// Recharts loads with the trend chart, not the page. The placeholder keeps
// the chart's 360px height while the chunk loads.
const HealthTrendChart = dynamic(() => import("./charts").then((m) => m.HealthTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[360px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const SCORE_MAP: Record<TrafficLight, number> = { green: 2, yellow: 1, red: 0 };

/* -------------------------------------------------------------------------- */
/*  Synced singleton store (was isolated zustand persist/localStorage)        */
/* -------------------------------------------------------------------------- */

const HEALTH_CHECK_ID = "healthCheck:current"; // MUST match HC_ID in health-check.ts.
const EMPTY_HISTORY: HistoryEntry[] = [];

function defaultScores(): Record<Dimension, DimensionScore> {
  return Object.fromEntries(
    DIMENSIONS.map((d) => [d, { light: "green" as TrafficLight, trend: "same" as Trend }])
  ) as Record<Dimension, DimensionScore>;
}

function emptySnapshot(): CurrentCheck {
  return { sprintName: "", scores: defaultScores() };
}

/** Latest doc snapshot, read synchronously (avoids stale closures in setters). */
function peekDoc(): HealthCheck {
  const d = (useWorkspaceStore.getState().healthChecks ?? []).find((x) => x.id === HEALTH_CHECK_ID);
  return d ?? { id: HEALTH_CHECK_ID, current: emptySnapshot(), history: [] };
}

// Mirrors the old useHealthCheckStore API ({current, history, setSprintName,
// setLight, setTrend, saveCheck, reset}) but backed by the synced workspace
// store, so the component body below is unchanged.
function useHealthCheck() {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.healthChecks ?? []).find((d) => d.id === HEALTH_CHECK_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertHealthCheck);
  const current = doc?.current ?? emptySnapshot();
  const history = doc?.history ?? EMPTY_HISTORY;
  return {
    current,
    history,
    setSprintName: (name: string) => {
      const c = peekDoc();
      upsert({ ...c, id: HEALTH_CHECK_ID, current: { ...c.current, sprintName: name } });
    },
    setLight: (dim: Dimension, light: TrafficLight) => {
      const c = peekDoc();
      upsert({
        ...c,
        id: HEALTH_CHECK_ID,
        current: {
          ...c.current,
          scores: { ...c.current.scores, [dim]: { ...c.current.scores[dim], light } },
        },
      });
    },
    setTrend: (dim: Dimension, trend: Trend) => {
      const c = peekDoc();
      upsert({
        ...c,
        id: HEALTH_CHECK_ID,
        current: {
          ...c.current,
          scores: { ...c.current.scores, [dim]: { ...c.current.scores[dim], trend } },
        },
      });
    },
    saveCheck: () => {
      const c = peekDoc();
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        sprintName: c.current.sprintName || `Check ${c.history.length + 1}`,
        date: todayLocalISO(),
        scores: { ...c.current.scores },
      };
      upsert({
        ...c,
        id: HEALTH_CHECK_ID,
        history: [...c.history, entry],
        current: emptySnapshot(),
      });
    },
    reset: () => {
      upsert({ id: HEALTH_CHECK_ID, current: emptySnapshot(), history: [] });
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Which dimensions the user has rated (UI-only)                             */
/* -------------------------------------------------------------------------- */

// The synced entity needs a light for every dimension, so the draft holds a
// placeholder green that must not read as a rating (a fresh check used to
// show "Health 100%" and save as all-green). "Rated" lives here instead,
// module-scoped so it survives in-app navigation. Yellow/red are always a
// deliberate choice, so those count as rated even after a reload; only a
// green has to be (re)confirmed. `historyLength` ties the flags to the draft
// they were set on: a save or clear anywhere (another tab, the agent) moves
// it and retires them.
interface RatedDims {
  historyLength: number;
  rated: Partial<Record<Dimension, true>>;
}

const useRatedDims = create<RatedDims>(() => ({ historyLength: 0, rated: {} }));

function markRated(dim: Dimension, historyLength: number) {
  useRatedDims.setState((s) => ({
    historyLength,
    rated: s.historyLength === historyLength ? { ...s.rated, [dim]: true } : { [dim]: true },
  }));
}

function clearRated(historyLength: number) {
  useRatedDims.setState({ historyLength, rated: {} });
}

/* -------------------------------------------------------------------------- */
/*  Example                                                                   */
/* -------------------------------------------------------------------------- */
// Neither is logged: the example isn't the user's own work.

/** The example's saved checks and a fully rated current check. Only offered on a blank tool. */
function loadExample() {
  const { current, history } = buildExample();
  const doc = peekDoc();
  const nextHistory = [...history, ...doc.history];
  useWorkspaceStore
    .getState()
    .upsertHealthCheck({ ...doc, id: HEALTH_CHECK_ID, current, history: nextHistory });
  // Its greens are ratings, not the draft's placeholder green.
  useRatedDims.setState({
    historyLength: nextHistory.length,
    rated: Object.fromEntries(DIMENSIONS.map((d) => [d, true])) as RatedDims["rated"],
  });
}

function sameSnapshot(a: CurrentCheck, b: CurrentCheck): boolean {
  return (
    a.sprintName === b.sprintName &&
    DIMENSIONS.every(
      (d) => a.scores[d]?.light === b.scores[d]?.light && a.scores[d]?.trend === b.scores[d]?.trend
    )
  );
}

/**
 * Drop the example's saved checks. The check in progress goes back to blank
 * only if it is still exactly the example's; once edited, it is the user's.
 */
function clearExampleChecks() {
  const doc = peekDoc();
  const history = doc.history.filter((h) => !isExampleId(h.id));
  const resetCurrent = sameSnapshot(doc.current, buildExample().current);
  useWorkspaceStore.getState().upsertHealthCheck({
    ...doc,
    id: HEALTH_CHECK_ID,
    history,
    current: resetCurrent ? emptySnapshot() : doc.current,
  });
  // The rated flags are tied to the history length (see useRatedDims): move
  // them along with the shorter history so a kept draft stays rated.
  const flags = useRatedDims.getState();
  if (resetCurrent) clearRated(history.length);
  else if (flags.historyLength === doc.history.length) {
    useRatedDims.setState({ historyLength: history.length, rated: flags.rated });
  }
}

/* -------------------------------------------------------------------------- */
/*  Helper components                                                         */
/* -------------------------------------------------------------------------- */

function TrafficDot({ light }: { light: TrafficLight }) {
  const bg =
    light === "green" ? "bg-[#22c55e]" : light === "yellow" ? "bg-[#eab308]" : "bg-[#ef4444]";
  return <span className={`inline-block w-4 h-4 rounded-full ${bg} shadow-sm`} title={light} />;
}

function TrafficButton({
  active,
  light,
  onClick,
}: {
  active: boolean;
  light: TrafficLight;
  onClick: () => void;
}) {
  const emoji = light === "green" ? "🟢" : light === "yellow" ? "🟡" : "🔴";
  const label = light.charAt(0).toUpperCase() + light.slice(1);
  const ring = active
    ? light === "green"
      ? "ring-2 ring-success"
      : light === "yellow"
        ? "ring-2 ring-warning"
        : "ring-2 ring-danger"
    : "";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all border ${
        active
          ? "bg-card border-border text-text"
          : "bg-transparent border-border text-sub hover:bg-cardH hover:border-border"
      } ${ring}`}
      title={label}
    >
      <span aria-hidden="true">{emoji}</span>
      <span>{label}</span>
    </button>
  );
}

function TrendButton({
  active,
  trend,
  onClick,
}: {
  active: boolean;
  trend: Trend;
  onClick: () => void;
}) {
  const arrow = trend === "up" ? "↑" : trend === "same" ? "→" : "↓";
  const label = trend === "up" ? "Up" : trend === "same" ? "Same" : "Down";
  const color = trend === "up" ? "text-success" : trend === "same" ? "text-sub" : "text-danger";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm transition-all border ${
        active
          ? "bg-card border-border text-text"
          : "bg-transparent border-border text-sub hover:bg-cardH"
      }`}
      title={label}
    >
      <span className={`text-base ${color}`} aria-hidden="true">
        {arrow}
      </span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function HealthCheckClient() {
  // useHealthCheck subscribes to a single synced doc via a useShallow
  // selector (R5: one subscription, not one per field — edits on unrelated
  // tools sharing the workspace store don't re-render this page).
  const {
    current,
    history,
    setSprintName,
    setLight,
    setTrend,
    saveCheck: saveCheckRaw,
    reset: resetRaw,
  } = useHealthCheck();
  const { log } = useHistoryLogger("health-check");
  const ratedDims = useRatedDims();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  /* -- Ratings for the current check --------------------------------------- */
  // null = not rated yet (see useRatedDims). A missing/legacy dimension in
  // persisted state is unrated too, so it has to be rated before saving.
  const lights = useMemo(() => {
    const flagsApply = ratedDims.historyLength === history.length;
    return Object.fromEntries(
      DIMENSIONS.map((d) => {
        const light = current.scores[d]?.light;
        const isLight = light === "green" || light === "yellow" || light === "red";
        const rated = isLight && (light !== "green" || (flagsApply && !!ratedDims.rated[d]));
        return [d, rated ? light : null];
      })
    ) as Record<Dimension, TrafficLight | null>;
  }, [current.scores, history.length, ratedDims]);
  const ratedCount = DIMENSIONS.filter((d) => lights[d] !== null).length;
  const allRated = ratedCount === DIMENSIONS.length;

  const rate = (dim: Dimension, light: TrafficLight) => {
    setLight(dim, light);
    markRated(dim, peekDoc().history.length);
  };

  const saveCheck = () => {
    // Saving with unrated dimensions would record their placeholder green.
    if (!allRated) return;
    // Read latest store snapshot synchronously so we don't log a stale
    // `current` from a previous render (the destructured `current` above
    // can lag the most recent edit).
    const pre = peekDoc().current;
    saveCheckRaw();
    clearRated(peekDoc().history.length);
    log(HEALTH_CHECK_ACTIONS.CHECK_SAVED, {
      sprintName: pre?.sprintName,
      scores: pre?.scores,
    });
  };
  // Clear All is confirmed (with the count) and undoable: Undo puts back the
  // saved checks, the check in progress and which of its lights were rated.
  const reset = () => {
    const prevDoc = peekDoc();
    const prevRated = useRatedDims.getState();
    const n = prevDoc.history.length;
    undoable({
      label: `Cleared ${n} saved health check${n === 1 ? "" : "s"}`,
      apply: () => {
        resetRaw();
        clearRated(0);
        log(HEALTH_CHECK_ACTIONS.HEALTH_CHECK_RESET, {});
      },
      revert: () => {
        useWorkspaceStore.getState().upsertHealthCheck(prevDoc);
        useRatedDims.setState(prevRated);
      },
    });
  };

  const clearExample = () => {
    const prevDoc = peekDoc();
    const prevRated = useRatedDims.getState();
    undoable({
      label: "Cleared the example",
      apply: clearExampleChecks,
      revert: () => {
        useWorkspaceStore.getState().upsertHealthCheck(prevDoc);
        useRatedDims.setState(prevRated);
      },
    });
  };
  // Nothing saved, rated or named yet.
  const isBlank = history.length === 0 && ratedCount === 0 && !current.sprintName.trim();

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
      toolName: "Team Health Check",
      prompts: generateHealthCheckPrompts({ current, history }, workspace),
    }),
    [current, history, workspace]
  );

  const markdown = useMemo(
    () => toMarkdown({ current, history, lights }),
    [current, history, lights]
  );

  /* -- CSV export ---------------------------------------------------------- */
  const csvData = useMemo(() => {
    const headers = ["Sprint", "Date", ...DIMENSIONS, "Overall Health %"];
    const rows = history.map((h) => {
      // Optional-chain `h.scores` itself: a hand-edited persisted entry could
      // be missing it altogether, which would otherwise crash the CSV builder.
      const greenCount = DIMENSIONS.filter((d) => h.scores?.[d]?.light === "green").length;
      const health = Math.round((greenCount / DIMENSIONS.length) * 100);
      return [
        h.sprintName,
        h.date,
        ...DIMENSIONS.map((d) => h.scores?.[d]?.light ?? "—"),
        health,
      ] as (string | number)[];
    });
    return { headers, rows };
  }, [history]);

  /* -- Trend chart data ---------------------------------------------------- */
  // Defensive: a history entry from an older build may be missing a dimension
  // (added later) or have a malformed `light` value. Coerce to the default
  // `green` rather than emit `undefined` into the chart series, which produced
  // NaN gaps in the recharts <Line> via `SCORE_MAP[undefined]`.
  const chartData = useMemo(
    () =>
      history.map((h) => ({
        name: h.sprintName,
        ...Object.fromEntries(
          DIMENSIONS.map((d) => {
            const score = h.scores?.[d]?.light;
            return [d, score && score in SCORE_MAP ? SCORE_MAP[score] : 0];
          })
        ),
      })),
    [history]
  );

  /* -- Overall health for current check ------------------------------------ */
  // Share of the RATED dimensions that are green; null until one is rated.
  const currentGreen = DIMENSIONS.filter((d) => lights[d] === "green").length;
  const currentHealth = ratedCount > 0 ? Math.round((currentGreen / ratedCount) * 100) : null;

  // The trend chart in words: a summary sentence and the lights as a table.
  const chartText = useMemo(() => healthTrendText(chartData), [chartData]);
  const trendTitleId = useId();

  const reversedHistory = useMemo(() => [...history].reverse(), [history]);

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      toolId="health-check"
      title="Squad Health Check"
      description="Spotify-model health check — rate each dimension with traffic lights and track trends over time."
      category="Team Health & Maturity"
    >
      {hasExampleItems(history) && <ExampleNotice onClear={clearExample} />}
      <div className="space-y-6">
        {/* ---- Current Check ---- */}
        <SectionCard
          title="Current Check"
          icon={HeartPulse}
          titleSize="lg"
          headerClassName="pb-4"
          actions={
            <>
              <div className="text-sm text-sub" data-testid="health-check-score">
                Health:{" "}
                <span
                  className={`font-data font-bold ${
                    currentHealth === null
                      ? "text-sub"
                      : currentHealth >= 75
                        ? "text-success"
                        : currentHealth >= 50
                          ? "text-warning"
                          : "text-danger"
                  }`}
                >
                  {currentHealth === null ? "—" : `${currentHealth}%`}
                </span>
              </div>
              <Button
                size="sm"
                variant="toolkit"
                onClick={saveCheck}
                disabled={!allRated}
                aria-describedby={allRated ? undefined : "health-check-save-hint"}
              >
                Save Check
              </Button>
            </>
          }
          contentClassName="space-y-4"
        >
          {!allRated && (
            <p id="health-check-save-hint" className="text-xs text-sub">
              Rate all {DIMENSIONS.length} dimensions to save this check ({ratedCount} of{" "}
              {DIMENSIONS.length} rated).
            </p>
          )}

          {/* Sprint name */}
          <div className="flex items-center gap-3">
            <label htmlFor="health-check-sprint" className="text-sm text-sub w-24 shrink-0">
              Sprint name
            </label>
            <BlurInput
              id="health-check-sprint"
              value={current.sprintName}
              onCommit={setSprintName}
              placeholder="e.g. Sprint 42"
              className="max-w-xs input-toolkit"
            />
          </div>

          {/* Dimension rows */}
          <div className="space-y-2">
            {/* Header */}
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto] gap-3 px-1 pb-2 border-b border-border">
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Dimension
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider w-52 text-center">
                Status
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider w-48 text-center">
                Trend
              </span>
            </div>

            {DIMENSIONS.map((dim) => (
              <div
                key={dim}
                className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_auto] sm:gap-3 sm:items-center py-1.5 border-b border-border last:border-0"
              >
                <span className="text-sm text-text font-medium">{dim}</span>
                <div
                  role="group"
                  aria-label={`${dim} status`}
                  className="flex gap-1.5 w-52 justify-center"
                >
                  {/* No light is active until the dimension is rated —
                      including a missing/legacy dimension in persisted
                      state (R11), which `lights` treats as unrated. */}
                  {(["green", "yellow", "red"] as TrafficLight[]).map((l) => (
                    <TrafficButton
                      key={l}
                      light={l}
                      active={lights[dim] === l}
                      onClick={() => rate(dim, l)}
                    />
                  ))}
                </div>
                <div
                  role="group"
                  aria-label={`${dim} trend`}
                  className="flex gap-1.5 w-48 justify-center"
                >
                  {/* R11-fix: same optional-chain defence as the light
                      buttons above — missing dimension in persisted
                      state should fall back to "same" rather than crash. */}
                  {(["up", "same", "down"] as Trend[]).map((t) => (
                    <TrendButton
                      key={t}
                      trend={t}
                      active={(current.scores[dim]?.trend ?? "same") === t}
                      onClick={() => setTrend(dim, t)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ---- Trend Chart ---- */}
        {history.length > 0 && (
          <SectionCard
            title={<span id={trendTitleId}>Trend Chart</span>}
            titleSize="lg"
            headerClassName="pb-2"
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="squad-health-check" csvData={csvData} markdown={markdown} />
              </>
            }
          >
            <p className="text-xs text-sub mb-3">
              2 = Green &nbsp;·&nbsp; 1 = Yellow &nbsp;·&nbsp; 0 = Red
            </p>
            <ChartFigure
              labelledBy={trendTitleId}
              summary={chartText.summary}
              table={chartText.table}
            >
              <HealthTrendChart data={chartData} />
            </ChartFigure>
          </SectionCard>
        )}

        {/* ---- History Table ---- */}
        {history.length > 0 ? (
          <SectionCard
            title="History"
            titleSize="lg"
            headerClassName="pb-4"
            actions={
              <Button variant="danger-ghost" size="sm" onClick={() => setConfirmClearOpen(true)}>
                Clear All
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4 whitespace-nowrap">
                      Sprint
                    </th>
                    <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4 whitespace-nowrap">
                      Date
                    </th>
                    {DIMENSIONS.map((d) => (
                      <th
                        key={d}
                        className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-3 px-2 whitespace-nowrap"
                        title={d}
                      >
                        {d
                          .split(" ")
                          .map((w) => w[0])
                          .join("")}
                      </th>
                    ))}
                    <th className="text-right text-xs text-sub font-medium uppercase tracking-wider pb-3 pl-4 whitespace-nowrap">
                      Health
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reversedHistory.map((h) => {
                    const greens = DIMENSIONS.filter(
                      (d) => h.scores?.[d]?.light === "green"
                    ).length;
                    const health = Math.round((greens / DIMENSIONS.length) * 100);
                    return (
                      <tr key={h.id} className="border-b border-border last:border-0 hover:bg-card">
                        <td className="py-3 pr-4 text-text font-medium whitespace-nowrap">
                          {h.sprintName}
                        </td>
                        <td className="py-3 pr-4 text-sub whitespace-nowrap">{h.date}</td>
                        {DIMENSIONS.map((d) => (
                          <td key={d} className="py-3 px-2 text-center">
                            <div className="flex justify-center">
                              <TrafficDot light={h.scores?.[d]?.light ?? "green"} />
                            </div>
                          </td>
                        ))}
                        <td className="py-3 pl-4 text-right">
                          <span
                            className={`font-data font-semibold ${
                              health >= 75
                                ? "text-success"
                                : health >= 50
                                  ? "text-warning"
                                  : "text-danger"
                            }`}
                          >
                            {health}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ) : (
          <Card className="bg-surface border-border">
            <CardContent className="py-12 text-center text-sub">
              No history yet — fill in the Current Check above and click{" "}
              <span className="text-text font-medium">Save Check</span>.
              {isBlank && (
                <div className="mt-4 flex justify-center">
                  <LoadExampleButton onLoad={loadExample} />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title={`Delete all ${history.length} saved health check${history.length === 1 ? "" : "s"}?`}
        description="The history and trend chart are cleared, along with the check in progress."
        confirmLabel="Clear history"
        onConfirm={reset}
      />
    </ToolPageWrapper>
  );
}
