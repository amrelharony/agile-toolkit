"use client";

import dynamic from "next/dynamic";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { CalendarDays, EyeOff, Heart, Radio, Smile, TrendingUp, Users } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ChartFigure } from "@/components/shared/chart-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  MOOD_TRACKER_ID,
  type MoodEntry,
  type MoodPulse,
  type MoodTrackerDoc,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { trendDirection } from "@/lib/analytics/anomaly";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { generateMoodTrackerPrompts } from "@/lib/ai-prompts/mood-tracker";
import { fmt } from "@/lib/charts/chart-text";
import { todayLocalISO } from "@/lib/utils/formatters";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MOOD_ACTIONS } from "@/lib/history/event-actions";
import { addToRoster, useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import {
  MOOD_SCORES,
  MOOD_WINDOW_DAYS,
  dailyMood,
  isMoodScore,
  lastDays,
  lowMoodStreak,
  moodDateProblem,
  moodMode,
  moodQuestionnaire,
  moodSummary,
  moodTrackerDoc,
  pulseCountsFromResult,
  realEntries,
  realPulses,
  streakKey,
  streakLinks,
  teamLevelDays,
  upsertCheckIn,
  withStreakLinks,
  type MoodMode,
  type MoodScore,
} from "@/lib/team/mood";
import { DayField } from "../health-check/day-field";
import { neighbourKeys, useFocusAfter } from "../health-check/use-focus-after";
import { useDayPick, useToday } from "../health-check/use-today";
import { dailyMoodText } from "./chart-text";
import { CheckInCard, validateCheckIn } from "./check-in";
import { buildExample } from "./example";
import { MoodHeatmap } from "./heatmap";
import { toMarkdown } from "./markdown";
import { moodPromptData } from "./prompt-data";
import { PulseList, pulseOrder } from "./pulses";
import { moodVerdict, shortDay, streakSpan } from "./verdict";

// Recharts loads with the daily-average chart, not the page. The placeholder
// matches the chart's fixed 220px height so the card doesn't jump.
const DailyMoodChart = dynamic(() => import("./charts").then((m) => m.DailyMoodChart), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

const MOOD_EVENT: Record<MoodScore, string> = {
  1: "mood-rough",
  2: "mood-low",
  3: "mood-neutral",
  4: "mood-good",
  5: "mood-great",
};

const NO_ENTRIES: MoodEntry[] = [];
const NO_PULSES: MoodPulse[] = [];
const NO_MEMBERS: TeamMember[] = [];
const QUESTIONNAIRE = moodQuestionnaire();

const MODES: { id: MoodMode; label: string; detail: string; icon: typeof Users }[] = [
  {
    id: "named",
    label: "By name",
    detail:
      "Each person's face is saved under their name, with an optional note, and shown per person.",
    icon: Users,
  },
  {
    id: "anonymous",
    label: "Anonymous",
    detail: "Only team pulses are kept: how many picked each face on a day, never who.",
    icon: EyeOff,
  },
];

function settingsDoc(): MoodTrackerDoc | undefined {
  return (useWorkspaceStore.getState().moodTrackerDocs ?? []).find((d) => d.id === MOOD_TRACKER_ID);
}

/**
 * Team Mood Tracker: check-ins by name (each person, or the facilitator
 * for them, for today or a missed day) or, in the anonymous mode, team
 * pulses only; pulses from a live round or counted hands work in both.
 * The headline average is the one the retro and Sprint Comparison quote,
 * a low-mood run can go to the retro as a topic (never naming anyone), and
 * the statistics wait for enough days. The example is a read-only preview.
 */
export function MoodTrackerClient() {
  const hydrated = useWorkspaceHydrated();
  const storedEntries = useWorkspaceStore((s) => s.moodEntries) ?? NO_ENTRIES;
  const storedPulses = useWorkspaceStore((s) => s.moodPulses) ?? NO_PULSES;
  const settings = useWorkspaceStore((s) =>
    (s.moodTrackerDocs ?? []).find((d) => d.id === MOOD_TRACKER_ID)
  );
  const roster = useTeamRoster();
  const { log: logEvent } = useHistoryLogger("mood-tracker");
  const announce = useAnnounce();
  const [example, setExample] = useState<MoodPulse[] | null>(null);
  const preview = example !== null;
  const entries = preview ? NO_ENTRIES : storedEntries;
  const pulses = example ?? storedPulses;
  const members: readonly TeamMember[] = preview ? NO_MEMBERS : roster;
  const mode: MoodMode = preview ? "anonymous" : moodMode(settings);

  // `today` follows the clock past midnight, so a tab left open overnight
  // doesn't keep logging yesterday; so do the check-in and pulse days while
  // nobody has picked another.
  const today = useToday();
  const [day, setDay] = useDayPick(today);
  const [pulseDay, setPulseDay] = useDayPick(today);
  const pulseDayRef = useRef(pulseDay);
  pulseDayRef.current = pulseDay;
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null);
  const checkInRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusAfter = useFocusAfter(rootRef);
  const dailyTitleId = useId();

  const days = useMemo(() => lastDays(today, MOOD_WINDOW_DAYS), [today]);
  const summary = useMemo(
    () => moodSummary(entries, pulses, days[0], today, { includeExamples: preview }),
    [entries, pulses, days, today, preview]
  );
  const named = useMemo(() => (preview ? [] : realEntries(entries)), [entries, preview]);
  const anon = useMemo(() => realPulses(pulses, { includeExamples: preview }), [pulses, preview]);
  const daily = useMemo(() => dailyMood(named, anon, days), [named, anon, days]);
  // In the anonymous mode the views by day are team level: a day shows from
  // MIN_SAMPLE.anonymous check-ins, so one kept from before the switch is never one person's.
  const shownDaily = useMemo(
    () => (mode === "anonymous" ? teamLevelDays(daily) : daily),
    [mode, daily]
  );
  const streak = useMemo(
    () => lowMoodStreak(entries, pulses, today, { includeExamples: preview }),
    [entries, pulses, today, preview]
  );

  /* ── Statistics, each behind its minimum ──────────────────────────── */

  const series = useMemo(
    () =>
      shownDaily
        .filter((d): d is typeof d & { average: number } => d.average !== null)
        .map((d) => ({ date: d.date, avg: Math.round(d.average * 100) / 100 })),
    [shownDaily]
  );
  const values = series.map((p) => p.avg);
  const trend = enoughData(values.length, "trend") ? trendDirection(values) : null;
  const shifts = useMemo(
    () => (enoughData(values.length, "changePoint") ? cusum(values) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values follows series
    [series]
  );
  const rolling = useMemo(() => {
    const out: number[] = [];
    for (let i = 6; i < values.length; i++) {
      const w = values.slice(i - 6, i + 1);
      out.push(w.reduce((a, b) => a + b, 0) / w.length);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values follows series
  }, [series]);
  const mk = enoughData(rolling.length, "trend") ? mannKendall(rolling) : null;
  const dailyText = useMemo(() => dailyMoodText(series), [series]);
  const verdict = moodVerdict(summary, streak, { days: MOOD_WINDOW_DAYS, trend });

  /* ── Writes ─────────────────────────────────────────────────────────── */

  const writeSettings = (fn: (d: MoodTrackerDoc) => MoodTrackerDoc) => {
    if (preview) return;
    useWorkspaceStore.getState().upsertMoodTrackerDoc(fn(moodTrackerDoc(settingsDoc())));
  };

  const setMode = (next: MoodMode) => {
    if (next === mode) return;
    writeSettings((d) => ({ ...d, mode: next }));
    announce(
      next === "anonymous" ? "Switched to anonymous check-ins" : "Switched to check-ins by name"
    );
  };

  const log = (memberId: string, forDay: string, score: MoodScore, note: string) => {
    if (preview) return;
    const v = validateCheckIn({ score, note });
    if (!v.ok) return;
    if (moodDateProblem(forDay, todayLocalISO())) return;
    sonify("mood-tracker", MOOD_EVENT[score]);
    const now = new Date();
    const { entry } = upsertCheckIn(
      useWorkspaceStore.getState().moodEntries ?? [],
      { memberId, date: forDay, score: v.values.score, note: v.values.note },
      { id: `mood_${nanoid(8)}`, today: todayLocalISO(now), now: now.toISOString() }
    );
    useWorkspaceStore.getState().upsertMoodEntry(entry);
    // Timing only, for the Team Dashboard's signals: no name, no note.
    logEvent(MOOD_ACTIONS.MOOD_LOGGED, { date: forDay, n: 1 });
    const name = members.find((m) => m.id === memberId)?.name ?? "Someone";
    announce(`${name}: ${v.values.score} out of 5 for ${shortDay(forDay)}`);
  };

  const saveNote = (entry: MoodEntry, note: string) => {
    if (preview) return;
    const clean = note.trim();
    const next: MoodEntry = { ...entry };
    if (clean) next.note = clean;
    else delete next.note;
    useWorkspaceStore.getState().upsertMoodEntry(next);
  };

  const clearCheckIn = (entry: MoodEntry, name: string) => {
    if (preview) return;
    // The Clear button goes with the check-in: focus that person's faces.
    focusAfter(`faces:${entry.memberId}`);
    undoable({
      label: `Cleared ${name}'s check-in for ${shortDay(entry.date.slice(0, 10))}`,
      apply: () => useWorkspaceStore.getState().removeMoodEntry(entry.id),
      revert: () => useWorkspaceStore.getState().upsertMoodEntry(entry),
    });
    logEvent(MOOD_ACTIONS.MOOD_REMOVED, { date: entry.date.slice(0, 10) });
    announce(`Cleared ${name}'s check-in`);
  };

  const removePulse = (p: MoodPulse) => {
    if (preview) return;
    // The next pulse's Delete, else the one above, else the pulse's day.
    focusAfter(
      ...neighbourKeys(
        pulseOrder(anon).map((x) => x.id),
        p.id,
        "delete-pulse:"
      ),
      "pulse-day"
    );
    undoable({
      label: `Deleted the pulse of ${shortDay(p.date)}`,
      apply: () => useWorkspaceStore.getState().removeMoodPulse(p.id),
      revert: () => useWorkspaceStore.getState().upsertMoodPulse(p),
    });
    logEvent(MOOD_ACTIONS.MOOD_REMOVED, { date: p.date });
    announce(`Deleted the pulse of ${shortDay(p.date)}`);
  };

  const savePulse = (result: VoteRoundResult) => {
    if (preview) return;
    const counts = pulseCountsFromResult(result);
    if (!counts) {
      toast.error("Not enough answers to keep a pulse.");
      return;
    }
    const pulse: MoodPulse = {
      id: `moodPulse_${nanoid(8)}`,
      date: pulseDayRef.current,
      counts,
      source: result.source === "live" ? "room" : "facilitator",
      createdAt: new Date().toISOString(),
    };
    useWorkspaceStore.getState().upsertMoodPulse(pulse);
    const n = MOOD_SCORES.reduce((sum, s) => sum + counts[s], 0);
    // Counts only, as the pulse itself.
    logEvent(MOOD_ACTIONS.MOOD_LOGGED, { date: pulse.date, n });
    announce(`Saved a pulse of ${n} answers for ${shortDay(pulse.date)}`);
    return () => useWorkspaceStore.getState().removeMoodPulse(pulse.id);
  };

  const pickCell = useCallback(
    (memberId: string, cellDay: string) => {
      setDay(cellDay);
      setFocusMemberId(memberId);
      checkInRef.current?.scrollIntoView?.({ block: "nearest" });
    },
    [setDay]
  );
  const focusTaken = useCallback(() => setFocusMemberId(null), []);

  /* ── Exports and prompts ────────────────────────────────────────────── */

  const markdown = useMemo(
    () => toMarkdown({ summary, daily: shownDaily, streak, mode, days: MOOD_WINDOW_DAYS, verdict }),
    [summary, shownDaily, streak, mode, verdict]
  );
  const csvData = useMemo(() => {
    if (mode === "named") {
      return {
        headers: ["Date", "Member", "Score", "Note"],
        rows: named.map((e) => [
          e.date,
          members.find((m) => m.id === e.memberId)?.name ?? "Former member",
          e.score,
          e.note ?? "",
        ]),
      };
    }
    return {
      headers: ["Date", "Team average", "Check-ins"],
      rows: shownDaily
        .filter((d) => d.n > 0)
        .map((d) => [d.date, d.average === null ? "—" : Math.round(d.average * 100) / 100, d.n]),
    };
  }, [mode, named, members, shownDaily]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Team Mood Tracker",
      prompts: generateMoodTrackerPrompts(moodPromptData(named, anon, days, summary, mode)),
    }),
    [anon, named, mode, days, summary]
  );

  const title = "Team Mood Tracker";
  const description =
    "Daily check-ins by name or anonymously, a team heatmap and trend, and low-mood runs raised at the retro.";

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId="mood-tracker"
        title={title}
        description={description}
        category="Outcomes & Pulse"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the mood tracker…
        </p>
      </ToolPageWrapper>
    );
  }

  const hasAny = named.length > 0 || anon.length > 0;
  const streakItem = streak
    ? {
        title: `Team mood has been low for ${streak.days} check-in days (average ${fmt(streak.average)}, ${streakSpan(streak)})`,
        tone: "concern" as const,
        // One run, one id: the saved run's start, which a backfill or a moving window doesn't change.
        sourceRef: {
          tool: "mood-tracker",
          id: `streak:${streakKey(settings, streak)}`,
          doc: MOOD_TRACKER_ID,
        },
      }
    : null;

  return (
    <ToolPageWrapper
      toolId="mood-tracker"
      title={title}
      description={description}
      category="Outcomes & Pulse"
    >
      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: two weeks of anonymous pulses from a team of six, ending in three low days.
            It&apos;s a read-only preview: nothing is saved or sent.
          </p>
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="mood-tracker" csvData={csvData} markdown={markdown} />
      </ActionRow>

      <p className="mb-4 text-sm font-medium text-text" data-testid="mood-verdict">
        {verdict}
      </p>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          label={`${MOOD_WINDOW_DAYS}-day average`}
          icon={Heart}
          valueClassName="text-3xl text-accent"
          value={summary.average === null ? "—" : fmt(summary.average)}
          unit={summary.average === null ? undefined : "/5"}
          hint={
            summary.average === null && summary.checkIns > 0
              ? `Needs ${MIN_SAMPLE.average} check-ins`
              : undefined
          }
        />
        <StatCard
          variant="compact"
          label="Trend"
          icon={TrendingUp}
          valueClassName="capitalize"
          value={trend ?? "—"}
          hint={trend ? "Day by day" : `Needs ${MIN_SAMPLE.trend} days with check-ins`}
        />
        <StatCard
          variant="compact"
          label="Check-ins"
          value={summary.checkIns}
          hint={summary.anonymous ? `${summary.anonymous} anonymous` : undefined}
        />
      </KpiGrid>

      {streak && streakItem && (
        <CalloutAlert tone="warning" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Low mood for {streak.days} check-in days in a row.</strong> The team averaged{" "}
              {fmt(streak.average)} out of 5, {streakSpan(streak)}.
            </span>
            <SendToMenu
              routes={["retro-topic"]}
              item={streakItem}
              sentTo={preview ? undefined : streakLinks(settings, streak)}
              getLinks={() => streakLinks(settingsDoc(), streak)}
              disabled={preview}
              onLinksChange={(update) => writeSettings((d) => withStreakLinks(d, streak, update))}
              itemLabels={{ "retro-topic": "Retro topic (no names)" }}
            />
          </div>
        </CalloutAlert>
      )}

      <div ref={rootRef} className="space-y-6">
        <SectionCard title="How the team checks in" icon={Smile} contentClassName="space-y-3">
          <div role="group" aria-label="Check-in mode" className="grid gap-2 sm:grid-cols-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const on = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  disabled={preview}
                  onClick={() => setMode(m.id)}
                  className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 ${
                    on ? "border-accent bg-accent/10" : "border-border hover:bg-card-hover"
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-medium text-text">{m.label}</span>
                    <span className="block text-xs text-sub">{m.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {mode === "anonymous" && named.length > 0 && (
            <p className="text-xs text-sub">
              Earlier check-ins by name are kept but not shown, and still count in the team average.
            </p>
          )}
        </SectionCard>

        {mode === "named" && (
          <div ref={checkInRef}>
            <SectionCard title="Check-ins by name" icon={CalendarDays}>
              <CheckInCard
                members={members}
                entries={entries}
                day={day}
                today={today}
                readOnly={preview}
                focusMemberId={focusMemberId}
                onFocusTaken={focusTaken}
                onDay={setDay}
                onLog={log}
                onNote={saveNote}
                onClear={clearCheckIn}
                onAddMember={(name) => {
                  const m = addToRoster(name);
                  announce(`Added ${m.name} to the team`);
                }}
              />
            </SectionCard>
          </div>
        )}

        <SectionCard title="Anonymous pulse" icon={Radio} contentClassName="space-y-3">
          {preview ? (
            <p className="text-sm text-sub">Clear the example to run a pulse with your team.</p>
          ) : (
            <>
              <p className="text-sm text-sub">
                Everyone picks a face on their own phone, or you count hands. Only how many picked
                each face is kept, from {MIN_SAMPLE.anonymous} answers.
              </p>
              <div data-focus-key="pulse-day">
                <DayField
                  label="Pulse for"
                  value={pulseDay}
                  max={today}
                  problem={(d) => moodDateProblem(d, today)}
                  onChange={setPulseDay}
                />
              </div>
              <VoteRoundPanel
                tool="mood-tracker"
                toolName="Mood Tracker"
                questionnaire={QUESTIONNAIRE}
                minN={MIN_SAMPLE.anonymous}
                onSave={savePulse}
              />
            </>
          )}
          {anon.length > 0 && <PulseList pulses={anon} readOnly={preview} onRemove={removePulse} />}
        </SectionCard>

        {!hasAny ? (
          <EmptyState
            icon={Smile}
            action={
              <LoadExampleButton onLoad={() => setExample(buildExample())} className="mt-4" />
            }
          >
            No check-ins yet. Pick a face for each person above, or run an anonymous pulse: the
            team&apos;s average and its trend show here.
          </EmptyState>
        ) : (
          <SectionCard title={<span id={dailyTitleId}>Daily team average</span>} icon={Heart}>
            {series.length > 0 ? (
              <ChartFigure
                labelledBy={dailyTitleId}
                summary={dailyText.summary}
                table={dailyText.table}
              >
                <DailyMoodChart data={series} />
              </ChartFigure>
            ) : (
              <p className="text-sm text-sub">No check-ins in the last {MOOD_WINDOW_DAYS} days.</p>
            )}
            {summary.average === null && summary.checkIns > 0 && (
              <NotEnoughData
                className="mt-3"
                have={summary.checkIns}
                need="average"
                unit={["check-in", "check-ins"]}
                action="Log"
                what="the team's average"
              />
            )}
            <AdvancedAnalysis
              className="mt-4"
              summary="Advanced analysis: shifts and the weekly trend"
            >
              {enoughData(values.length, "changePoint") ? (
                shifts.length > 0 ? (
                  <ul className="space-y-1 text-sm text-text">
                    {shifts.map((s) => (
                      <li key={s.index}>
                        A sustained {s.direction === "up" ? "lift" : "drop"} in the daily average
                        around {series[s.index] ? shortDay(series[s.index].date) : "—"} (CUSUM).
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-sub">
                    No sustained shift in the daily average (CUSUM).
                  </p>
                )
              ) : (
                <NotEnoughData
                  have={values.length}
                  need="changePoint"
                  unit={["day with check-ins", "days with check-ins"]}
                  action="Log"
                  what="sustained shifts (CUSUM)"
                />
              )}
              {mk ? (
                <p className="text-sm text-text">
                  The 7-day average is{" "}
                  {mk.significant
                    ? mk.trend === "up"
                      ? "rising"
                      : "falling"
                    : "not clearly moving"}{" "}
                  (Mann-Kendall, p = {mk.pValue.toFixed(3)}).
                </p>
              ) : (
                <NotEnoughData
                  have={rolling.length}
                  need="trend"
                  unit={["week-long window", "week-long windows"]}
                  action="Log"
                  what="the weekly trend (Mann-Kendall)"
                />
              )}
            </AdvancedAnalysis>
          </SectionCard>
        )}

        {mode === "named" && members.length > 0 && (
          <SectionCard title={`${MOOD_WINDOW_DAYS}-day heatmap`} icon={Users}>
            <MoodHeatmap
              members={members}
              entries={entries}
              days={days}
              readOnly={preview}
              onPick={pickCell}
            />
          </SectionCard>
        )}

        {mode === "named" && <RecentNotes entries={named} members={members} />}
      </div>
    </ToolPageWrapper>
  );
}

/** The five newest notes (named mode only): context the heatmap can't show. */
function RecentNotes({
  entries,
  members,
}: {
  entries: readonly MoodEntry[];
  members: readonly TeamMember[];
}) {
  const notes = entries
    .filter((e) => e.note && e.note.trim())
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  if (notes.length === 0) return null;
  return (
    <SectionCard title="Recent notes" icon={Smile}>
      <ul className="space-y-2">
        {notes.map((e) => (
          <li key={e.id} className="rounded-md border border-border bg-bg p-2">
            <div className="flex flex-wrap items-center gap-2 font-data text-xs text-sub">
              <span>{isMoodScore(e.score) ? `${e.score}/5` : "—"}</span>
              <span aria-hidden="true">·</span>
              <span>{members.find((m) => m.id === e.memberId)?.name ?? "Former member"}</span>
              <span aria-hidden="true">·</span>
              <span>{shortDay(e.date.slice(0, 10))}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-sub">{e.note}</p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
