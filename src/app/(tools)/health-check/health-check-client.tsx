"use client";

import { useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { HeartPulse, History, Layers, Radio, RotateCcw, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { BlurInput } from "@/components/shared/blur-fields";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateHealthCheckPrompts } from "@/lib/ai-prompts/health-check";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_CHECK_DIMENSIONS,
  type HealthCheck,
  type HealthCheckEntry,
  type HealthTrafficLight,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HEALTH_CHECK_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { todayIso } from "@/lib/sprints/series";
import { sendHandoffBatch } from "@/lib/handoffs/send";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import {
  HEALTH_CHECK_ID,
  activeDimensions,
  allDimensions,
  applyHealthRound,
  checkDateProblem,
  checkLabel,
  checksByDate,
  dimensionNameProblem,
  draftLight,
  draftShare,
  emptyHealthCheck,
  entryShare,
  healthQuestionnaire,
  normalizeHealthCheck,
  previousSavedCheck,
  redTopicTitle,
  revertHealthRound,
  saveDraft,
  scoreOf,
  sharePct,
  storedLight,
  trendSince,
  unratedDimensions,
  withCustomDimension,
  withDate,
  withDimensionPatch,
  withEntryLinks,
  withNote,
  withRating,
  withSprint,
  withSprintName,
} from "@/lib/health-check/score";
import { healthTrendRows, healthTrendText } from "./chart-text";
import { DayField } from "./day-field";
import { DimensionForm, type NewDimension } from "./dimension-form";
import { DimensionRow } from "./dimension-row";
import { buildExample } from "./example";
import { HealthHistory, unsentReds } from "./history";
import { toMarkdown } from "./markdown";
import { neighbourKeys, useFocusAfter } from "./use-focus-after";
import { useToday } from "./use-today";
import { healthVerdict } from "./verdict";

// Recharts loads with the trend chart, not the page. The placeholder keeps
// the chart's height while the chunk loads.
const HealthTrendChart = dynamic(() => import("./charts").then((m) => m.HealthTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** Saved checks the trend chart needs before it draws a line. */
export const TREND_MIN_CHECKS = 2;

/** Logged when a vote round fills the draft: counts only, never who voted what. */
const ROUND_SAVED = "round_saved";

/** The stored doc, normalised, read synchronously (no stale closures in setters). */
function peekDoc(): HealthCheck {
  return normalizeHealthCheck(
    (useWorkspaceStore.getState().healthChecks ?? []).find((d) => d.id === HEALTH_CHECK_ID)
  );
}

function healthTone(pct: number | null): string {
  if (pct === null) return "text-sub";
  return pct >= 75 ? "text-success" : pct >= 50 ? "text-warning" : "text-danger";
}

/**
 * Squad Health Check: rate each dimension green, yellow or red, by hand or
 * from an anonymous vote round, with a note; the trend of each comes from
 * the previous saved check. Health counts yellow as half. Saved checks are
 * listed with their lights, can be deleted (with Undo) and send their reds
 * to the retro as topics. The example is a read-only preview that never
 * reaches the workspace.
 */
export function HealthCheckClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore(
    useShallow((s) => (s.healthChecks ?? []).find((d) => d.id === HEALTH_CHECK_ID))
  );
  const [example, setExample] = useState<HealthCheck | null>(null);
  const preview = example !== null;
  const doc = useMemo(() => normalizeHealthCheck(example ?? stored), [example, stored]);
  const { sprints } = useSelectedSprint();
  const { log } = useHistoryLogger("health-check");
  const announce = useAnnounce();
  const today = useToday();
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The day field's own error: while it shows, Save check refuses rather
  // than saving under the last good day.
  const [dateError, setDateError] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const dimsRef = useRef<HTMLOListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfter = useFocusAfter(rootRef);
  const trendTitleId = useId();
  const opts = { includeExamples: preview };

  const current = doc.current;
  const dims = activeDimensions(doc);
  const archived = allDimensions(doc).filter((d) => d.archived);
  const unrated = unratedDimensions(doc);
  const ratedCount = dims.length - unrated.length;
  const health = sharePct(draftShare(doc));
  const draftDate = current.date ?? today;
  const prev = previousSavedCheck(doc, { date: draftDate }, opts);
  const prevLabel = prev ? checkLabel(prev) : null;
  // Newest first: every stored check (an older build's example rows too, flagged by the notice).
  const checks = useMemo(() => [...checksByDate(doc, { includeExamples: true })].reverse(), [doc]);
  const legacyExamples = !preview && hasExampleItems(stored?.history);
  const verdict = healthVerdict(doc, { today, ...opts });
  const isBlank =
    checks.length === 0 &&
    ratedCount === 0 &&
    !current.sprintName.trim() &&
    archived.length === 0 &&
    dims.length === HEALTH_CHECK_DIMENSIONS.length;

  /* ── Writes ─────────────────────────────────────────────────────────── */

  /** Change the stored doc (never the example): `fn` returns null to write nothing. */
  const write = (fn: (d: HealthCheck) => HealthCheck | null): boolean => {
    if (preview) return false;
    const next = fn(peekDoc());
    if (!next) return false;
    useWorkspaceStore.getState().upsertHealthCheck(next);
    return true;
  };

  const rate = (key: string, name: string, light: HealthTrafficLight) => {
    if (write((d) => withRating(d, key, light))) {
      setSaveError(null);
      announce(`${name}: ${light}`);
    }
  };

  const save = () => {
    if (dateError) {
      setSaveError(`Fix the day first: ${dateError}`);
      dateRef.current?.focus();
      return;
    }
    // The clock now, not the render's: a check saved just past midnight is today's.
    const result = saveDraft(peekDoc(), {
      id: crypto.randomUUID(),
      today: todayIso(),
      sprints,
    });
    if (!result.ok) {
      setAttempted(true);
      const names = result.unrated.map((d) => d.name);
      setSaveError(
        result.dateProblem && names.length === 0
          ? result.dateProblem
          : `Rate ${names.length === 1 ? "this dimension" : `these ${names.length} dimensions`} before saving: ${names.join(", ")}.`
      );
      // Focus the first unrated dimension's first light.
      const first = dimsRef.current?.querySelector<HTMLButtonElement>(
        '[data-unrated="true"] button'
      );
      first?.focus();
      return;
    }
    useWorkspaceStore.getState().upsertHealthCheck(result.doc);
    setAttempted(false);
    setSaveError(null);
    const pct = sharePct(entryShare(result.entry));
    log(HEALTH_CHECK_ACTIONS.CHECK_SAVED, {
      checkId: result.entry.id,
      sprintName: result.entry.sprintName,
      date: result.entry.date,
      health: pct,
    });
    announce(
      `Saved the check ${checkLabel(result.entry)}, health ${pct}%. A new check has started.`
    );
  };

  const deleteCheck = (e: HealthCheckEntry) => {
    // The next check's Delete, else the one before, else Save check.
    focusAfter(
      ...neighbourKeys(
        checks.map((x) => x.id),
        e.id,
        "delete:"
      ),
      "save-check"
    );
    removeWithUndo<HealthCheckEntry>({
      label: `Deleted the check ${checkLabel(e)}`,
      update: (fn) => {
        write((d) => ({ ...d, history: fn(d.history) }));
      },
      match: (x) => x.id === e.id,
    });
    log(HEALTH_CHECK_ACTIONS.CHECK_REMOVED, { checkId: e.id });
    announce(`Deleted the check ${checkLabel(e)}`);
  };

  const sendReds = (e: HealthCheckEntry) => {
    // An example row an older build saved: its reds never reach the real retro.
    if (preview || isExampleId(e.id)) return;
    const fresh = () => peekDoc().history.find((x) => x.id === e.id);
    const reds = unsentReds(e, doc);
    if (reds.length === 0) return;
    // The button becomes "Sent · Open retro": focus moves onto it.
    focusAfter(`reds:${e.id}`, `delete:${e.id}`);
    const sent = sendHandoffBatch(
      "retro-topic",
      reds.map((dim) => ({
        src: {
          title: redTopicTitle(e, dim, scoreOf(e, dim.key)?.note),
          tone: "concern" as const,
          sourceRef: { tool: "health-check", id: `${e.id}:${dim.key}`, doc: HEALTH_CHECK_ID },
        },
        links: {
          getLinks: () => scoreOf(fresh(), dim.key)?.sentTo,
          setLinks: (update) => {
            write((d) => withEntryLinks(d, e.id, dim.key, update));
          },
        },
      })),
      `Sent ${reds.length} red ${reds.length === 1 ? "dimension" : "dimensions"} to the retro`
    );
    if (sent.length > 0) {
      announce(
        `Sent ${sent.length} red ${sent.length === 1 ? "dimension" : "dimensions"} to the retro`
      );
    }
  };

  const addDimension = (d: NewDimension) => {
    const id = `custom-${nanoid(8)}`;
    if (write((x) => withCustomDimension(x, { id, ...d })))
      announce(`Added the dimension ${d.name}`);
  };

  const renameDimension = (key: string, name: string): string | null => {
    const problem = dimensionNameProblem(peekDoc(), name, key);
    if (problem) return problem;
    write((d) => withDimensionPatch(d, key, { name: name.trim() }));
    return null;
  };

  const archiveDimension = (key: string, name: string) => {
    // Its row goes: focus its Restore button, which also undoes it.
    focusAfter(`restore:${key}`, "save-check");
    undoable({
      label: `Archived “${name}”`,
      description: "Saved checks keep its lights.",
      apply: () => {
        write((d) => withDimensionPatch(d, key, { archived: true }));
      },
      revert: () => {
        write((d) => withDimensionPatch(d, key, { archived: false }));
      },
    });
    announce(`Archived ${name}`);
  };

  const restoreDimension = (key: string, name: string) => {
    if (write((d) => withDimensionPatch(d, key, { archived: false }))) {
      announce(`Restored ${name}`);
    }
  };

  const saveRound = (result: VoteRoundResult) => {
    const before = peekDoc().current;
    let keys: string[] = [];
    write((d) => {
      const r = applyHealthRound(d, result);
      keys = r.keys;
      return r.keys.length > 0 ? r.doc : null;
    });
    if (keys.length === 0) {
      // Only a live round gets here (people may skip any dimension). False
      // keeps the kit's Save round available instead of "Round saved".
      toast.error(
        result.questions.some((q) => q.distribution)
          ? "The round's dimensions are no longer in the check, so nothing was saved."
          : `No dimension had ${result.minN} answers, so nothing was saved.`
      );
      return false;
    }
    log(ROUND_SAVED, { ballots: result.ballots, dimensions: keys.length, source: result.source });
    announce(
      `${keys.length} ${keys.length === 1 ? "dimension" : "dimensions"} rated from ${result.ballots} votes`
    );
    const changed = keys;
    return () => {
      write((d) => revertHealthRound(d, before, changed));
    };
  };

  const clearLegacyExamples = () => {
    const prevDoc = peekDoc();
    undoable({
      label: "Cleared the example",
      apply: () => {
        write((d) => ({ ...d, history: d.history.filter((h) => !isExampleId(h.id)) }));
      },
      revert: () => useWorkspaceStore.getState().upsertHealthCheck(prevDoc),
    });
  };

  // For the reset's Undo: the doc as it was when Clear all was confirmed.
  const beforeReset = useRef<HealthCheck | null>(null);

  /* ── Exports and prompts ────────────────────────────────────────────── */

  const markdown = useMemo(
    () => toMarkdown(doc, { verdict, ...opts }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opts follows preview
    [doc, verdict, preview]
  );

  const csvData = useMemo(() => {
    const keys = allDimensions(doc).filter((d) => checks.some((e) => storedLight(e, d.key)));
    return {
      headers: ["Check", "Date", "Sprint id", ...keys.map((d) => d.name), "Health %"],
      rows: [...checks]
        .reverse()
        .map((e) => [
          checkLabel(e),
          e.date,
          e.sprintId ?? "",
          ...keys.map((d) => storedLight(e, d.key) ?? "—"),
          sharePct(entryShare(e)) ?? "—",
        ]),
    };
  }, [doc, checks]);

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
  const promptConfig = useMemo(() => {
    // Only rated lights, built-in and custom alike (a placeholder green is
    // never a rating), each with its trend since the previous saved check,
    // as the rows show it: null when there is nothing to compare against.
    const s = doc.current;
    const dimensions = activeDimensions(doc).flatMap((d) => {
      const light = draftLight(s, d.key);
      if (!light) return [];
      const note = scoreOf(s, d.key)?.note;
      return [
        {
          name: d.name,
          light,
          trend: trendSince(prev, d.key, light),
          ...(d.custom ? { custom: true } : {}),
          ...(note ? { note } : {}),
        },
      ];
    });
    return {
      toolName: "Team Health Check",
      prompts: generateHealthCheckPrompts(
        {
          current: {
            label: checkLabel({ sprintName: s.sprintName, date: draftDate }),
            dimensions,
            unrated: unratedDimensions(doc).map((d) => d.name),
            healthPct: sharePct(draftShare(doc)),
          },
          ...(prev ? { previousLabel: checkLabel(prev) } : {}),
        },
        workspace
      ),
    };
  }, [doc, prev, draftDate, workspace]);

  /* ── Chart ──────────────────────────────────────────────────────────── */

  const trend = useMemo(() => healthTrendRows(doc, { includeExamples: true }), [doc]);
  const trendText = useMemo(() => healthTrendText(trend.rows, trend.dims), [trend]);

  // A dims signature, so the questionnaire (and a running round) only changes with the dimensions.
  const dimsKey = dims.map((d) => `${d.key}|${d.name}|${d.description ?? ""}`).join("\n");
  const questionnaire = useMemo(
    () => healthQuestionnaire(doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the dimensions only
    [dimsKey]
  );

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId="health-check"
        title="Squad Health Check"
        description="Rate each dimension green, yellow or red, by hand or by anonymous vote, and watch the trend from check to check."
        category="Team Health & Maturity"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the health check…
        </p>
      </ToolPageWrapper>
    );
  }

  const sprintPicked = current.sprintId
    ? sprints.find((s) => s.id === current.sprintId)
    : undefined;

  return (
    <ToolPageWrapper
      toolId="health-check"
      title="Squad Health Check"
      description="Rate each dimension green, yellow or red, by hand or by anonymous vote, and watch the trend from check to check."
      category="Team Health & Maturity"
    >
      {(preview || legacyExamples) && (
        <div>
          <ExampleNotice onClear={preview ? () => setExample(null) : clearLegacyExamples} />
          {preview && (
            <p className="-mt-2 mb-4 text-xs text-sub">
              Example: a checkout squad&apos;s last three checks and this sprint&apos;s, three
              dimensions from an anonymous vote. It&apos;s a read-only preview: nothing is saved or
              sent.
            </p>
          )}
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="squad-health-check" csvData={csvData} markdown={markdown} />
      </ActionRow>

      <p className="mb-4 text-sm font-medium text-text" data-testid="health-check-verdict">
        {verdict}
      </p>

      <div ref={rootRef} className="space-y-6">
        {/* ---- Current check ---- */}
        <SectionCard
          title="Current check"
          icon={HeartPulse}
          titleSize="lg"
          headerClassName="pb-4"
          actions={
            <>
              <div className="text-sm text-sub" data-testid="health-check-score">
                Health:{" "}
                <span className={`font-data font-bold ${healthTone(health)}`}>
                  {health === null ? "—" : `${health}%`}
                </span>
              </div>
              <span data-focus-key="save-check">
                <Button size="sm" variant="toolkit" onClick={save} disabled={preview}>
                  Save check
                </Button>
              </span>
            </>
          }
          contentClassName="space-y-4"
        >
          <fieldset disabled={preview} className="space-y-4">
            <legend className="sr-only">The check in progress</legend>
            <p className="text-xs text-sub" id="health-check-progress">
              {ratedCount} of {dims.length} dimensions rated. Health counts green 1, yellow ½ and
              red 0, over the rated ones.
            </p>
            {saveError && (
              <p role="alert" className="text-sm text-danger">
                {saveError}
              </p>
            )}

            <div className="flex flex-wrap items-end gap-4">
              {sprints.length > 0 && (
                <div className="flex flex-wrap items-end gap-2" data-focus-key="sprint">
                  <SprintPicker
                    sprints={sprints}
                    // "" rather than undefined keeps the picker controlled, so after
                    // "No sprint" it shows none and the same sprint can be picked again.
                    selectedId={current.sprintId ?? ""}
                    onSelect={(id) => {
                      // From the store, not this render: a sprint just made with
                      // "New sprint" isn't in `sprints` yet.
                      const sprint = (useWorkspaceStore.getState().sprints ?? []).find(
                        (s) => s.id === id
                      );
                      if (sprint) write((d) => withSprint(d, sprint));
                    }}
                    label="Sprint this check is for"
                    allowCreate={!preview}
                  />
                  {current.sprintId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => {
                        // The button goes with the sprint: focus moves to the picker.
                        focusAfter("sprint");
                        write((d) => withSprint(d, null));
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      No sprint
                    </Button>
                  )}
                </div>
              )}
              {/* A check for no sprint can still be named, and its name is always on screen. */}
              {!current.sprintId && (
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor="health-check-name" className="text-xs font-medium text-sub">
                    Check name
                  </label>
                  <BlurInput
                    id="health-check-name"
                    value={current.sprintName}
                    onCommit={(v) => write((d) => withSprintName(d, v))}
                    placeholder="e.g. Sprint 42"
                    className="max-w-xs"
                  />
                </div>
              )}
              <DayField
                label="Taken on"
                value={draftDate}
                max={today}
                problem={(day) => checkDateProblem(day, today)}
                onChange={(day) => write((d) => withDate(d, day))}
                onProblem={(why) => {
                  setDateError(why);
                  if (!why) setSaveError((e) => (e?.startsWith("Fix the day first") ? null : e));
                }}
                inputRef={dateRef}
                hint={current.date && current.date !== today ? "Backdated" : undefined}
              />
            </div>
            {current.sprintId && !sprintPicked && (
              <p className="text-xs text-sub">
                Saved for “{current.sprintName || "a sprint"}”, which is no longer in the sprint
                list.
              </p>
            )}

            <ol ref={dimsRef} aria-label="Dimensions" className="list-none">
              {dims.map((dim) => (
                <DimensionRow
                  key={dim.key}
                  dim={dim}
                  light={draftLight(current, dim.key)}
                  score={scoreOf(current, dim.key)}
                  prevLight={storedLight(prev ?? undefined, dim.key)}
                  prevLabel={prevLabel}
                  invalid={attempted && draftLight(current, dim.key) === null}
                  onRate={(l) => rate(dim.key, dim.name, l)}
                  onNote={(note) => write((d) => withNote(d, dim.key, note))}
                  onRename={dim.custom ? (name) => renameDimension(dim.key, name) : undefined}
                  onArchive={dim.custom ? () => archiveDimension(dim.key, dim.name) : undefined}
                />
              ))}
            </ol>
            {current.source === "room" && typeof current.responses === "number" && (
              <p className="text-xs text-sub">
                {current.responses} people voted anonymously; only the totals are kept.
              </p>
            )}
          </fieldset>
        </SectionCard>

        {/* ---- Anonymous round ---- */}
        <SectionCard title="Vote anonymously" icon={Radio} contentClassName="space-y-3">
          {preview ? (
            <p className="text-sm text-sub">Clear the example to run a round with your team.</p>
          ) : (
            <>
              <p className="text-sm text-sub">
                Each person picks a light per dimension on their own phone. A dimension&apos;s votes
                show from {MIN_SAMPLE.anonymous} answers and set its light, counting green 1, yellow
                ½ and red 0: green when the votes average ¾ or more, red below ¼, yellow in between.
                You can still change it by hand.
              </p>
              <VoteRoundPanel
                tool="health-check"
                toolName="Health Check"
                questionnaire={questionnaire}
                minN={MIN_SAMPLE.anonymous}
                onSave={saveRound}
              />
            </>
          )}
        </SectionCard>

        {/* ---- The team's own dimensions ---- */}
        <SectionCard title="Your own dimensions" icon={Layers} contentClassName="space-y-3">
          <p className="text-sm text-sub">
            Add what matters to this team beyond the eight. Archiving hides one from new checks;
            saved checks keep its lights.
          </p>
          <fieldset disabled={preview}>
            <legend className="sr-only">Add a dimension</legend>
            <DimensionForm doc={doc} onAdd={addDimension} />
          </fieldset>
          {archived.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Archived dimensions">
              {archived.map((d) => (
                <li
                  key={d.key}
                  className="flex items-center gap-2 text-sub"
                  data-focus-key={`restore:${d.key}`}
                >
                  <span>{d.name} (archived)</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={preview}
                    onClick={() => restoreDimension(d.key, d.name)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Restore {d.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* ---- Trend ---- */}
        {checks.length > 0 && (
          <SectionCard title={<span id={trendTitleId}>Health over time</span>} titleSize="lg">
            {trend.rows.length >= TREND_MIN_CHECKS ? (
              <ChartFigure
                labelledBy={trendTitleId}
                summary={trendText.summary}
                table={trendText.table}
              >
                <HealthTrendChart data={trend.rows} />
              </ChartFigure>
            ) : (
              <NotEnoughData
                have={trend.rows.length}
                need={TREND_MIN_CHECKS}
                unit={["saved check", "saved checks"]}
                action="Save"
                what="health over time"
              />
            )}
          </SectionCard>
        )}

        {/* ---- Saved checks ---- */}
        {checks.length > 0 ? (
          <SectionCard
            title="Saved checks"
            icon={History}
            titleSize="lg"
            headerClassName="pb-4"
            actions={
              <ResetButton
                label="Clear all"
                title={`Delete all ${checks.length} saved health check${checks.length === 1 ? "" : "s"}?`}
                description="The saved checks and the check in progress are cleared. Your own dimensions stay."
                confirmLabel="Clear history"
                doneLabel={`Cleared ${checks.length} saved health check${checks.length === 1 ? "" : "s"}`}
                disabled={preview}
                variant="danger-ghost"
                onReset={() => {
                  const before = peekDoc();
                  beforeReset.current = before;
                  write(() => ({
                    ...emptyHealthCheck(),
                    ...(before.customDimensions
                      ? { customDimensions: before.customDimensions }
                      : {}),
                  }));
                  log(HEALTH_CHECK_ACTIONS.HEALTH_CHECK_RESET, { checks: before.history.length });
                }}
                onUndo={() => {
                  if (beforeReset.current) {
                    useWorkspaceStore.getState().upsertHealthCheck(beforeReset.current);
                  }
                }}
              />
            }
          >
            <HealthHistory
              doc={doc}
              checks={checks}
              readOnly={preview}
              onSendReds={sendReds}
              onDelete={deleteCheck}
            />
          </SectionCard>
        ) : (
          <EmptyState
            icon={HeartPulse}
            action={
              isBlank ? (
                <LoadExampleButton onLoad={() => setExample(buildExample())} className="mt-4" />
              ) : undefined
            }
          >
            No saved checks yet. Rate each dimension above, by hand or from an anonymous round, and
            press <span className="font-medium text-text">Save check</span>: each saved check shows
            how the team moved since the last.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
