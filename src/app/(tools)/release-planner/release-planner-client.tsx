"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { CalendarRange, Gauge, Layers, Rocket } from "lucide-react";
import { selectActiveSprint, useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { Field } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateReleasePlannerPrompts } from "@/lib/ai-prompts/release-planner";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RELEASE_PLANNER_ACTIONS } from "@/lib/history/event-actions";
import { STORY_MAP_ID } from "@/lib/handoffs/poker-writeback";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { fmt, plural } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import {
  EMPTY_CONFIG,
  isEmptyConfig,
  useReleasePlannerStore,
  type ReleasePlannerConfig,
} from "./store";
import {
  SCOPE_SOURCE_LABEL,
  SLICE_PARAM,
  backlogScope,
  readSliceParam,
  resolveScope,
  resolveScopeSource,
  storyMapSlices,
  type ScopeSource,
} from "./scope-source";
import {
  effectiveStartDate,
  headlineVelocity,
  parseVelocities,
  resolveVelocitySource,
  sprintSample,
  type VelocitySource,
} from "./velocity-source";
import { planRelease, resolveTargetDate, signedPct, type VelocitySample } from "./plan";
import { headlineText, unestimatedText } from "./describe";
import { validateScopeChange, validateScopePoints, validateSprintLength } from "./validate";
import { DateField, NumberField, VelocityField, inputCls } from "./inputs";
import { ForecastView } from "./forecast-view";
import { CLEARED_EXAMPLE, buildExample } from "./example";
import { toMarkdown } from "./markdown";

const NO_SPRINTS: Sprint[] = [];
const NO_STORIES: Story[] = [];
const linkCls = "text-accent underline-offset-2 hover:underline";

/**
 * Keep a ?slice= link pointing at the slice on screen (or drop it when the
 * scope comes from elsewhere), so a refresh doesn't jump back to the slice
 * the link named.
 */
function syncSliceParam(sliceId: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SLICE_PARAM)) return;
    if (sliceId) url.searchParams.set(SLICE_PARAM, sliceId);
    else url.searchParams.delete(SLICE_PARAM);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* no history API: the saved choice still applies */
  }
}

export function ReleasePlannerClient() {
  const config = useReleasePlannerStore((s) => s.config);
  const updateConfigRaw = useReleasePlannerStore((s) => s.updateConfig);
  const setConfig = useReleasePlannerStore((s) => s.setConfig);
  const resetRaw = useReleasePlannerStore((s) => s.reset);
  const { log } = useHistoryLogger("release-planner");
  const chartRef = useRef<HTMLDivElement>(null);

  // Quiet while typing, logged on commit (blur, Enter, a click), so typing
  // "120" doesn't write three history events (BUG-T7-release-planner-1).
  const updateConfigQuiet = updateConfigRaw;
  const updateConfig = useCallback(
    (updates: Partial<ReleasePlannerConfig>) => {
      updateConfigRaw(updates);
      log(RELEASE_PLANNER_ACTIONS.RELEASE_UPDATED, { fields: Object.keys(updates) });
    },
    [updateConfigRaw, log]
  );

  /* -- The workspace: sprints, stories, the story map, the cadence -------- */
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const storyMap = useWorkspaceStore((s) => (s.storyMaps ?? []).find((m) => m.id === STORY_MAP_ID));
  const [cadence] = useCeremonyCadence();

  // The Story Mapper's "Plan release" links here with ?slice=<id>: plan that
  // slice (an example on screen gives way to it).
  useEffect(() => {
    const slice = readSliceParam(window.location.search);
    if (!slice) return;
    const current = useReleasePlannerStore.getState().config;
    if (current.scopeSource === "slice" && current.sliceId === slice) return;
    updateConfigRaw({
      ...(current.example ? CLEARED_EXAMPLE : {}),
      scopeSource: "slice",
      sliceId: slice,
    });
  }, [updateConfigRaw]);

  /* -- Scope ---------------------------------------------------------------- */
  const backlog = useMemo(() => backlogScope(stories, sprints), [stories, sprints]);
  const slices = useMemo(() => storyMapSlices(storyMap), [storyMap]);
  const scopeSource = resolveScopeSource(config, backlog);
  const scope = useMemo(
    () => resolveScope(scopeSource, config, backlog, slices),
    [scopeSource, config, backlog, slices]
  );

  /* -- Velocity ------------------------------------------------------------- */
  const velocitySource = resolveVelocitySource(config);
  const typed = useMemo(() => parseVelocities(config.velocityInput), [config.velocityInput]);
  const fromSprints = useMemo(() => sprintSample(sprints), [sprints]);
  const sample = useMemo<VelocitySample>(() => {
    if (velocitySource === "manual") {
      return { points: typed, labels: typed.map((_, i) => `Sprint ${i + 1}`) };
    }
    const names = new Map(sprints.map((s) => [s.id, s.name]));
    return {
      points: fromSprints.points,
      labels: fromSprints.sprintIds.map((id) => names.get(id) ?? id),
    };
  }, [velocitySource, typed, fromSprints, sprints]);
  const headline = useMemo(
    () => headlineVelocity(velocitySource, sprints, typed),
    [velocitySource, sprints, typed]
  );

  /* -- Dates ---------------------------------------------------------------- */
  const activeSprint = useMemo(() => selectActiveSprint({ sprints }), [sprints]);
  const start = useMemo(
    () => effectiveStartDate(config.startDate, activeSprint),
    [config.startDate, activeSprint]
  );
  const lengthDays = config.sprintLengthDays ?? cadence.sprintLengthDays;
  const target = resolveTargetDate(config, start.date, lengthDays);

  const plan = useMemo(
    () =>
      planRelease({
        scope,
        scopeChangePct: config.scopeChangePct,
        velocitySource,
        sample,
        headline,
        lengthDays,
        lengthFrom: config.sprintLengthDays === null ? "cadence" : "user",
        start,
        targetDate: target.date,
        targetFrom: target.from,
      }),
    [
      scope,
      config.scopeChangePct,
      velocitySource,
      sample,
      headline,
      lengthDays,
      config.sprintLengthDays,
      start,
      target.date,
      target.from,
    ]
  );

  /* -- Example, reset, export ----------------------------------------------- */
  const loadExample = () => updateConfig(buildExample());
  const clearExample = () => updateConfigRaw(CLEARED_EXAMPLE);
  const snapshot = useRef<ReleasePlannerConfig>(EMPTY_CONFIG);
  const reset = () => {
    snapshot.current = useReleasePlannerStore.getState().config;
    resetRaw();
    log(RELEASE_PLANNER_ACTIONS.RELEASE_RESET, {});
  };

  const markdown = useMemo(() => toMarkdown(plan), [plan]);
  const csvData = useMemo(
    () => ({
      headers: ["Confidence", "Sprints", "Finished by"],
      rows: plan.rows.map((r) => [`${r.pct}%`, r.sprints ?? "", r.sprints === null ? "" : r.date]),
    }),
    [plan.rows]
  );
  const promptConfig = useMemo(() => {
    const [p50, p75, p85, p95] = plan.rows.map((r) => r.sprints);
    const results =
      p50 != null && p75 != null && p85 != null && p95 != null ? { p50, p75, p85, p95 } : null;
    return {
      toolName: "Release Planner",
      prompts: generateReleasePlannerPrompts({
        // The prompt still names a buffer and an adjustment; the one expected
        // change rides in the buffer, so the numbers stay right.
        config: {
          backlogSize: plan.scope.points ?? 0,
          velocityInput: plan.sample.points.join(", "),
          scopeBuffer: config.scopeChangePct ?? 0,
          scopeAdjustment: 0,
          sprintLengthDays: lengthDays,
          startDate: start.date,
        },
        results,
      }),
    };
  }, [plan, config.scopeChangePct, lengthDays, start.date]);

  const nothingYet = scope.points === null && sample.points.length === 0 && !config.example;

  return (
    <ToolPageWrapper
      toolId="release-planner"
      title="Release Planner"
      description="Forecast a release from the backlog or a story-map slice and the team's real velocity: the date to commit to, and the chance of hitting the one stakeholders ask about."
      category="Sprint Planning & Estimation"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ResetButton
            title="Reset the Release Planner?"
            description="This clears the typed scope and velocities, the expected scope change, the sprint length and the dates. Your backlog, sprints and story map stay as they are."
            confirmLabel="Reset planner"
            doneLabel="Reset the Release Planner"
            onReset={reset}
            onUndo={() => setConfig(snapshot.current)}
            disabled={isEmptyConfig(config)}
            variant="danger-ghost"
          />
          <div className="flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="release-forecast"
              clipboardText={markdown}
              csvData={csvData}
              markdown={markdown}
              targetRef={chartRef}
            />
          </div>
        </div>

        {isExampleId(config.example) && <ExampleNotice onClear={clearExample} />}

        <div className="grid gap-6 lg:grid-cols-2">
          <ScopeCard
            config={config}
            source={scopeSource}
            scope={scope}
            backlog={backlog}
            slices={slices}
            effective={plan.effective}
            onSource={(v) => {
              updateConfig({ scopeSource: v });
              syncSliceParam(v === "slice" ? (config.sliceId ?? null) : null);
            }}
            onSlice={(id) => {
              updateConfig({ sliceId: id || undefined });
              syncSliceParam(id || null);
            }}
            onQuiet={updateConfigQuiet}
            onCommit={updateConfig}
          />
          <VelocityCard
            config={config}
            source={velocitySource}
            sample={sample}
            averageLine={headline.average === null ? null : `${headlineText({ headline })}.`}
            onSource={(v) => updateConfig({ velocitySource: v })}
            onQuiet={updateConfigQuiet}
            onCommit={updateConfig}
          />
        </div>

        <SectionCard title="Dates" icon={CalendarRange}>
          <div className="grid gap-4 sm:grid-cols-3">
            <DateField
              label="Start"
              value={start.date}
              onCommit={(v) => updateConfig({ startDate: v })}
              hint={
                start.from === "sprint" && activeSprint
                  ? `The day after ${activeSprint.name} ends.`
                  : start.from === "today"
                    ? "Today."
                    : "Clear it to start after the active sprint, or today."
              }
            />
            <NumberField
              label="Sprint length"
              suffix="days"
              value={config.sprintLengthDays}
              placeholder={String(cadence.sprintLengthDays)}
              validate={validateSprintLength}
              onChange={(v) => updateConfigQuiet({ sprintLengthDays: v })}
              onCommit={(v) => updateConfig({ sprintLengthDays: v })}
              hint={
                config.sprintLengthDays === null ? (
                  <>
                    {plural(cadence.sprintLengthDays, "day")}, from the team&apos;s cadence (
                    <Link href="/team" className={linkCls}>
                      Team charter
                    </Link>
                    ).
                  </>
                ) : (
                  `The cadence says ${plural(cadence.sprintLengthDays, "day")}. Clear it to follow the cadence.`
                )
              }
            />
            <DateField
              label="Target date (optional)"
              value={config.targetDate || (target.from === "legacy" ? target.date : "")}
              onCommit={(v) => updateConfig({ targetDate: v, sprintsToReleaseTarget: undefined })}
              hint={
                target.from === "legacy"
                  ? `Your earlier target of ${plural(Number(config.sprintsToReleaseTarget), "sprint")} from the start.`
                  : "The date stakeholders ask about: see the chance of making it."
              }
            />
          </div>
        </SectionCard>

        {nothingYet ? (
          <EmptyState icon={Rocket} action={<LoadExampleButton onLoad={loadExample} />}>
            Nothing to forecast yet. Choose the scope and the velocity above, or load an example to
            see a forecast.
          </EmptyState>
        ) : (
          <ForecastView plan={plan} plotRef={chartRef} />
        )}
      </div>
    </ToolPageWrapper>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scope                                                                      */
/* -------------------------------------------------------------------------- */

function ScopeCard({
  config,
  source,
  scope,
  backlog,
  slices,
  effective,
  onSource,
  onSlice,
  onQuiet,
  onCommit,
}: {
  config: ReleasePlannerConfig;
  source: ScopeSource;
  scope: ReturnType<typeof resolveScope>;
  backlog: ReturnType<typeof backlogScope>;
  slices: ReturnType<typeof storyMapSlices>;
  effective: number | null;
  onSource: (v: ScopeSource) => void;
  onSlice: (id: string) => void;
  onQuiet: (updates: Partial<ReleasePlannerConfig>) => void;
  onCommit: (updates: Partial<ReleasePlannerConfig>) => void;
}) {
  return (
    <SectionCard title="Scope" icon={Layers}>
      <div className="space-y-4">
        <ToggleGroup<ScopeSource>
          label="Where the scope comes from"
          size="sm"
          value={source}
          onValueChange={onSource}
          options={(["backlog", "slice", "typed"] as const).map((v) => ({
            value: v,
            label: SCOPE_SOURCE_LABEL[v],
          }))}
        />

        {source === "backlog" &&
          (backlog.stories === 0 ? (
            <p className="text-sm text-sub">
              No open stories yet. Add them in{" "}
              <Link href="/sprint-planning" className={linkCls}>
                Sprint Planning
              </Link>
              , or pick another source.
            </p>
          ) : (
            <div className="space-y-1 text-sm text-sub">
              <p>
                <span className="font-data text-base text-text">{fmt(backlog.points)} points</span>{" "}
                in {plural(backlog.stories, "open story", "open stories")}.
              </p>
              {scope.unestimated > 0 && <p className="text-warning">{unestimatedText(scope)}</p>}
              {backlog.inOpenSprints > 0 && (
                <p>
                  Includes {plural(backlog.inOpenSprints, "open story", "open stories")} in running
                  or planned sprints.
                </p>
              )}
            </div>
          ))}

        {source === "slice" &&
          (slices.length === 0 ? (
            <p className="text-sm text-sub">
              The story map has no slices yet. Build one in the{" "}
              <Link href="/story-mapper" className={linkCls}>
                Story Mapper
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2">
              <Field
                label="Story-map slice"
                error={
                  scope.sliceMissing
                    ? "That slice is no longer on the story map. Pick another."
                    : undefined
                }
              >
                {(props) => (
                  <select
                    {...props}
                    value={scope.slice?.id ?? ""}
                    onChange={(e) => onSlice(e.target.value)}
                    className={cn(inputCls, "h-9 w-full rounded-md border px-2 text-sm")}
                  >
                    <option value="">Choose a slice…</option>
                    {slices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {isExampleId(s.id) ? " (example)" : ""} · {fmt(s.points)} pts
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {scope.slice && (
                <div className="space-y-1 text-sm text-sub">
                  <p>
                    <span className="font-data text-base text-text">
                      {fmt(scope.slice.points)} points
                    </span>{" "}
                    in {plural(scope.slice.cards, "card")}.
                  </p>
                  {scope.unestimated > 0 && (
                    <p className="text-warning">{unestimatedText(scope)}</p>
                  )}
                </div>
              )}
            </div>
          ))}

        {source === "typed" && (
          <NumberField
            label="Points left to deliver"
            suffix="pts"
            value={config.backlogSize}
            placeholder="e.g. 120"
            validate={validateScopePoints}
            onChange={(v) => onQuiet({ backlogSize: v })}
            onCommit={(v) => onCommit({ backlogSize: v })}
          />
        )}

        <NumberField
          label="Expected scope change"
          suffix="%"
          value={config.scopeChangePct}
          placeholder="0"
          validate={validateScopeChange}
          onChange={(v) => onQuiet({ scopeChangePct: v })}
          onCommit={(v) => onCommit({ scopeChangePct: v })}
          hint="Scope usually grows as the work is understood (10–25% is common). Negative for planned cuts."
        />

        <p className="text-sm text-sub">
          Scope to forecast:{" "}
          {effective === null ? (
            "not set yet."
          ) : (
            <>
              <span className="font-data text-accent">{fmt(effective)} points</span>
              {config.scopeChangePct
                ? ` (${fmt(scope.points ?? 0)} with a ${signedPct(config.scopeChangePct)} change).`
                : "."}
            </>
          )}
        </p>
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Velocity                                                                   */
/* -------------------------------------------------------------------------- */

function VelocityCard({
  config,
  source,
  sample,
  averageLine,
  onSource,
  onQuiet,
  onCommit,
}: {
  config: ReleasePlannerConfig;
  source: VelocitySource;
  sample: VelocitySample;
  /** "21 points per sprint, the average of the last 3 sprints." */
  averageLine: string | null;
  onSource: (v: VelocitySource) => void;
  onQuiet: (updates: Partial<ReleasePlannerConfig>) => void;
  onCommit: (updates: Partial<ReleasePlannerConfig>) => void;
}) {
  return (
    <SectionCard title="Velocity" icon={Gauge}>
      <div className="space-y-4">
        <ToggleGroup<VelocitySource>
          label="Where the velocities come from"
          size="sm"
          value={source}
          onValueChange={onSource}
          options={[
            { value: "sprints", label: "From completed sprints" },
            { value: "manual", label: "Type them" },
          ]}
        />
        {source === "sprints" ? (
          sample.points.length === 0 ? (
            <p className="text-sm text-sub">
              No completed sprints with points yet. Close them in{" "}
              <Link href="/velocity" className={linkCls}>
                Velocity
              </Link>
              , or type the numbers instead.
            </p>
          ) : (
            <div className="space-y-1 text-sm text-sub">
              <p>
                {plural(sample.points.length, "completed sprint")}, oldest first:{" "}
                <span className="font-data text-text">
                  {sample.points.map((p) => fmt(p)).join(", ")}
                </span>
              </p>
              {averageLine && <p>{averageLine}</p>}
              <p>
                <Link href="/velocity" className={linkCls}>
                  Edit in Velocity
                </Link>
              </p>
            </div>
          )
        ) : (
          <VelocityField
            value={config.velocityInput}
            onChange={(v) => onQuiet({ velocityInput: v })}
            onCommit={(v) => onCommit({ velocityInput: v })}
            hint={
              sample.points.length === 0
                ? "Commas, spaces or one per line. A sprint that delivered 0 counts too."
                : `${plural(sample.points.length, "sprint")}. ${averageLine ?? ""}`
            }
          />
        )}
      </div>
    </SectionCard>
  );
}
