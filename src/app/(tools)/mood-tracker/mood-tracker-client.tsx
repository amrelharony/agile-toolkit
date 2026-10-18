"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Smile, Heart, TrendingUp } from "lucide-react";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { trendDirection, mean } from "@/lib/analytics/anomaly";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { generateMoodTrackerPrompts } from "@/lib/ai-prompts/mood-tracker";
import { useShallow } from "zustand/react/shallow";
import { todayLocalISO } from "@/lib/utils/formatters";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MOOD_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";

// Recharts loads with the daily-average chart, not the page. The placeholder
// matches the chart's fixed 220px height so the card doesn't jump.
const DailyMoodChart = dynamic(() => import("./charts").then((m) => m.DailyMoodChart), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

const MOOD_EVENT: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "mood-rough",
  2: "mood-low",
  3: "mood-neutral",
  4: "mood-good",
  5: "mood-great",
};

interface MoodEntry {
  id: string;
  memberId: string;
  date: string;
  score: 1 | 2 | 3 | 4 | 5;
  note?: string;
  /**
   * True when this entry was created by typing a note BEFORE picking
   * a face. The score is a placeholder (3 / Neutral) and the row is
   * EXCLUDED from averages / CUSUM / Mann-Kendall until a real score
   * lands. The flag is cleared inside `log` once a face is clicked.
   * (BUG-T5-mood-tracker-1)
   */
  isPlaceholder?: boolean;
}

const FACES = [
  { score: 1 as const, label: "Rough", color: "#ef4444" },
  { score: 2 as const, label: "Low", color: "#fb923c" },
  { score: 3 as const, label: "Neutral", color: "#facc15" },
  { score: 4 as const, label: "Good", color: "#a3e635" },
  { score: 5 as const, label: "Great", color: "#34d399" },
];

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    // Use local-calendar YYYY-MM-DD so the row labels track the user's day,
    // not UTC's. With toISOString, users west of UTC log "today" entries that
    // appear in the *next* day's row.
    out.push(todayLocalISO(d));
  }
  return out;
}

export function MoodTrackerClient() {
  // Synced workspace collection (was isolated localStorage), so MCP-recorded
  // mood entries round-trip into the UI. setEntries mirrors the old [value,
  // setter] API over the slice. Local MoodEntry === the synced entity shape.
  const entries = useWorkspaceStore(useShallow((s) => (s.moodEntries ?? []) as MoodEntry[]));
  const setEntries = (updater: MoodEntry[] | ((prev: MoodEntry[]) => MoodEntry[])) => {
    const cur = (useWorkspaceStore.getState().moodEntries ?? []) as MoodEntry[];
    const next = typeof updater === "function" ? updater(cur) : updater;
    useWorkspaceStore.setState({ moodEntries: next });
  };
  const [newMemberName, setNewMemberName] = useState("");
  // Drafts for the per-member optional note input. Keyed by memberId so each
  // row's textarea controls its own buffer without colliding with neighbors.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const members = useWorkspaceStore((s) => s.teamMembers);
  const upsertMember = useWorkspaceStore((s) => s.upsertTeamMember);
  const { log: logEvent } = useHistoryLogger("mood-tracker");

  // R5: removed stray `useWorkspaceStore.persist.rehydrate()` — it
  // wasn't this tool's job to force a workspace-wide rehydrate. Doing
  // so on mount raced with other tools' in-progress writes (the
  // workspace store hydrates once at the persist-provider boundary).

  // `todayISO` is reactive: a setInterval ticks it forward when the
  // local date changes. Without the interval, a tab opened the night
  // before midnight would keep rendering yesterday's heatmap until
  // something else re-rendered — the days[] memo's todayISO dep would
  // never change because the render never re-ran.
  const [todayISO, setTodayISO] = useState(() => todayLocalISO());
  useEffect(() => {
    const tick = () => {
      const next = todayLocalISO();
      setTodayISO((curr) => (curr === next ? curr : next));
    };
    // 1 minute is more than enough — midnight rollover only matters at
    // the day boundary, and the user is unlikely to notice a 60-second
    // delay after midnight.
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);
  // Memoize on todayISO so the array reference is stable until midnight. With
  // a fresh array per render, child memos that depend on `days` would
  // invalidate every render and the heatmap would lose its identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => lastNDays(14), [todayISO]);

  const log = (memberId: string, score: MoodEntry["score"]) => {
    sonify("mood-tracker", MOOD_EVENT[score]);
    // Recompute the day inside the callback — render closure can be stale if
    // the user crosses midnight without re-rendering (e.g., backgrounded tab).
    const today = todayLocalISO();
    // Pull the in-progress note (if any) for this member and attach it. We
    // still allow score-only logs so the click-to-log flow stays one tap.
    const note = noteDrafts[memberId]?.trim() || undefined;
    setEntries((e) => {
      // R5: previously found `existing` by reference then `.map((x) => x === existing ?…)`.
      // Under StrictMode (and React 18 concurrent rendering), this updater can
      // be invoked twice — the second invocation's `e` is the array AFTER the
      // first call's update, so `existing` (captured from the first `e`) is
      // no longer in the new array → match-by-reference fails → the second
      // call silently appends a duplicate. Match by composite (memberId, date)
      // inside `.map` so it's reference-independent.
      const idx = e.findIndex((x) => x.memberId === memberId && x.date === today);
      if (idx >= 0) {
        const next = e.slice();
        // BUG-T5-mood-tracker-1: clear placeholder flag when a real
        // face is picked — the row now contributes to analytics.
        next[idx] = {
          ...next[idx],
          score,
          note: note ?? next[idx].note,
          isPlaceholder: false,
        };
        return next;
      }
      return [...e, { id: nanoid(8), memberId, date: today, score, note }];
    });
    logEvent(MOOD_ACTIONS.MOOD_LOGGED, { memberId, score, date: today, note });
    // BUG-T5-mood-tracker-2: clear the local note draft after the
    // log lands so a subsequent blur() of the textarea doesn't fire
    // commitNote with the same draft and overwrite the entry (or in
    // pathological double-invoke paths, race the just-merged note
    // field). Match-by-(memberId,date) inside the updater already
    // prevents duplicates; the draft clear closes the remaining
    // window where commitNote and log queue at the same task.
    setNoteDrafts((d) => {
      if (d[memberId] === undefined) return d;
      const next = { ...d };
      delete next[memberId];
      return next;
    });
  };

  const updateNote = (memberId: string, note: string) => {
    // Update the local draft on every keystroke so the textarea stays
    // responsive, but DON'T touch persisted entries here — that path would
    // write localStorage on every character. The flush happens in commitNote
    // (onBlur), keeping per-keystroke work in-memory only.
    setNoteDrafts((d) => ({ ...d, [memberId]: note }));
  };

  const commitNote = (memberId: string) => {
    const draft = noteDrafts[memberId];
    if (draft === undefined) return;
    const today = todayLocalISO();
    const trimmed = draft.trim();
    setEntries((e) => {
      // R11-fix: use findIndex by (memberId, date) instead of comparing
      // object identity. StrictMode can invoke the updater twice; the
      // second invocation receives the array AFTER the first call's
      // map allocated new objects, breaking `x === existing` and
      // making the note write silently a no-op.
      const idx = e.findIndex((x) => x.memberId === memberId && x.date === today);
      if (idx === -1) {
        // R11-fix: user typed a note BEFORE scoring. Previously the
        // `if (!existing) return e` early-return silently discarded
        // the note. Now we create a placeholder entry seeded with
        // score=3 (Neutral) so the user's input isn't lost. The
        // existing `log` flow later merges the user's chosen score
        // onto this entry (carrying the note forward via the
        // `next[idx].note` preservation in log's setEntries updater).
        // Tradeoff: a single Neutral score appears in analytics for
        // members who only typed a note — preferable to silent data
        // loss.
        if (trimmed === "") return e;
        // BUG-T5-mood-tracker-1: tag the row as a placeholder so
        // analytics filter it out until the user clicks a real face.
        return [
          ...e,
          {
            id: nanoid(8),
            memberId,
            date: today,
            score: 3,
            note: trimmed,
            isPlaceholder: true,
          },
        ];
      }
      return e.map((x, i) => (i === idx ? { ...x, note: trimmed || undefined } : x));
    });
  };

  const addMember = () => {
    if (!newMemberName.trim()) return;
    const id = nanoid(8);
    upsertMember({ id, name: newMemberName.trim() });
    setNewMemberName("");
  };

  const averageByDay = useMemo(() => {
    return days.map((d) => {
      // BUG-T5-mood-tracker-1: exclude placeholders (a row created by
      // typing a note before clicking a face) from analytics. They
      // stay visible in the UI but don't bias the trend / CUSUM /
      // Mann-Kendall until the user picks a real score.
      const todays = entries.filter((e) => e.date === d && !e.isPlaceholder);
      return {
        date: d,
        avg: todays.length > 0 ? mean(todays.map((x) => x.score)) : null,
        count: todays.length,
      };
    });
  }, [entries, days]);

  const overallAvg = useMemo(() => {
    const avgs = averageByDay.filter((d) => d.avg !== null).map((d) => d.avg as number);
    return avgs.length > 0 ? mean(avgs) : 0;
  }, [averageByDay]);

  const trend = useMemo(() => {
    const avgs = averageByDay.filter((d) => d.avg !== null).map((d) => d.avg as number);
    return trendDirection(avgs);
  }, [averageByDay]);

  /* ── Phase-15 analytics ───────────────────────────────────────────────── */
  // Daily-average mood line — sparse days (no entries) drop out so CUSUM
  // operates on actual observations only.
  const dailySeries = useMemo(
    () =>
      averageByDay
        .filter((d): d is typeof d & { avg: number } => d.avg !== null)
        .map((d) => ({ date: d.date, avg: Number(d.avg.toFixed(2)) })),
    [averageByDay]
  );
  const dailyValues = useMemo(() => dailySeries.map((d) => d.avg), [dailySeries]);

  // CUSUM regime-shift markers on the daily-average series. Drop any
  // changepoint that doesn't map to a date in `dailySeries` — the chart's
  // x-axis is `dailySeries[].date`, and the synthetic `String(cp.index)`
  // fallback would force `ifOverflow="extendDomain"` to add a phantom tick.
  const dailyChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (dailyValues.length < 4) return [];
    return cusum(dailyValues)
      .map((cp): CausalAnnotationData | null => {
        const date = dailySeries[cp.index]?.date;
        if (!date) return null;
        return {
          x: date,
          label: `Mood ${cp.direction === "up" ? "↑ regime" : "↓ regime"}`,
          detail: `CUSUM detected a sustained ${cp.direction === "up" ? "lift" : "drop"} in daily team mood at ${date}.`,
          confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
        };
      })
      .filter((a): a is CausalAnnotationData => a !== null);
  }, [dailyValues, dailySeries]);

  // Rolling-week mood: 7-point moving average over the daily series. The
  // MK test on a smoothed series captures the persistent trend rather than
  // day-to-day noise.
  const rollingWeek = useMemo(() => {
    if (dailyValues.length < 7) return [] as number[];
    const out: number[] = [];
    for (let i = 6; i < dailyValues.length; i++) {
      const window = dailyValues.slice(i - 6, i + 1);
      out.push(window.reduce((a, b) => a + b, 0) / window.length);
    }
    return out;
  }, [dailyValues]);

  const moodTrend = useMemo(
    () => (rollingWeek.length >= 5 ? mannKendall(rollingWeek) : null),
    [rollingWeek]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Team Mood Tracker",
      prompts: generateMoodTrackerPrompts({ entries, days, overallAvg }),
    }),
    [entries, days, overallAvg]
  );

  return (
    <ToolPageWrapper
      toolId="mood-tracker"
      title="Team Mood Tracker"
      description="Quick daily pulse checks with 14-day heatmap and team-average trend."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="mood-tracker"
          csvData={{
            headers: ["Date", "Member", "Score", "Note"],
            rows: entries.map((e) => {
              const m = members.find((x) => x.id === e.memberId);
              return [e.date, m?.name ?? e.memberId, e.score, e.note ?? ""];
            }),
          }}
          jsonData={entries}
        />
      </ActionRow>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          label="14-day Average"
          valueClassName="text-3xl text-accent flex items-center gap-2"
          value={
            <>
              {overallAvg.toFixed(2)}
              <Heart className="w-5 h-5" />
            </>
          }
        />
        <StatCard
          variant="compact"
          label="Trend"
          valueClassName="capitalize flex items-center gap-2"
          value={
            <>
              {trend}
              <TrendingUp
                className={`w-5 h-5 ${
                  trend === "rising"
                    ? "text-success"
                    : trend === "falling"
                      ? "text-danger"
                      : "text-sub"
                }`}
              />
            </>
          }
        />
        <StatCard variant="compact" label="Check-ins" value={entries.length} />
      </KpiGrid>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Smile className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text">Today&apos;s check-in</h3>
          </div>
          {members.length === 0 ? (
            <div className="flex gap-2">
              <Input
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Add a team member..."
                className="bg-bg border-border"
                aria-label="Team member name"
              />
              <Button onClick={addMember} className="gap-2 bg-accent text-bg hover:bg-accent/90">
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => {
                const todays = entries.find((e) => e.memberId === m.id && e.date === todayISO);
                // Prefer the in-flight draft so the user's typing isn't
                // clobbered by the persisted entry's note on every keystroke.
                const noteValue = noteDrafts[m.id] ?? todays?.note ?? "";
                return (
                  <div key={m.id} className="rounded-lg border border-border bg-bg p-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-text w-full sm:w-40 sm:truncate">{m.name}</span>
                      <div
                        role="group"
                        aria-label={`Mood for ${m.name}`}
                        className="flex flex-wrap gap-1.5 flex-1 w-full sm:w-auto"
                      >
                        {FACES.map((f) => (
                          <button
                            key={f.score}
                            type="button"
                            onClick={() => log(m.id, f.score)}
                            aria-pressed={todays?.score === f.score}
                            className={`flex-1 min-w-[60px] rounded-md border py-1.5 text-xs font-semibold transition ${
                              todays?.score === f.score
                                ? "border-transparent text-bg"
                                : "border-border text-sub hover:border-accent/40"
                            }`}
                            style={{
                              background: todays?.score === f.score ? f.color : "transparent",
                            }}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Textarea
                      value={noteValue}
                      onChange={(e) => updateNote(m.id, e.target.value)}
                      onBlur={() => commitNote(m.id)}
                      placeholder="Note (optional)..."
                      rows={2}
                      className="bg-surface border-border resize-none text-xs"
                      aria-label={`Note for ${m.name}`}
                    />
                  </div>
                );
              })}
              <div className="flex gap-2 pt-2">
                <Input
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="Add another team member..."
                  className="bg-bg border-border"
                  aria-label="Team member name"
                />
                <Button onClick={addMember} className="gap-2 bg-accent text-bg hover:bg-accent/90">
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent notes — surfaces optional context that would otherwise hide
          inside heatmap tooltips. Capped to 5 so the card stays scannable. */}
      {entries.some((e) => e.note && e.note.trim().length > 0) && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Smile className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-text">Recent Notes</h3>
            </div>
            <ul className="space-y-2">
              {entries
                .filter((e) => e.note && e.note.trim().length > 0)
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 5)
                .map((e) => {
                  const m = members.find((x) => x.id === e.memberId);
                  const face = FACES.find((f) => f.score === e.score);
                  return (
                    <li key={e.id} className="rounded-md border border-border bg-bg p-2">
                      <div className="flex items-center gap-2 text-xs text-sub font-data">
                        <span style={{ color: face?.color }}>{face?.label}</span>
                        <span>·</span>
                        <span>{m?.name ?? e.memberId}</span>
                        <span>·</span>
                        <span>{e.date}</span>
                      </div>
                      <div className="text-sub text-xs mt-0.5 whitespace-pre-wrap break-words">
                        {e.note}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </CardContent>
        </Card>
      )}

      {dailySeries.length > 0 && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Heart className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-text">Daily-average mood</h3>
              {moodTrend?.significant && (
                <span
                  className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    // For mood, "up" trend is good, "down" is concerning.
                    moodTrend.trend === "up"
                      ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  }`}
                  title={`Mann-Kendall p=${moodTrend.pValue.toFixed(3)} on 7-day rolling mean`}
                >
                  <span aria-hidden="true">{moodTrend.trend === "up" ? "↗ trend" : "↘ trend"}</span>
                  <span className="sr-only">{`Rolling-week mood trend ${moodTrend.trend} (Mann-Kendall p=${moodTrend.pValue.toFixed(3)})`}</span>
                </span>
              )}
            </div>
            <DailyMoodChart data={dailySeries} changepoints={dailyChangepoints} />
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Heart className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text">14-day Heatmap</h3>
          </div>
          {members.length === 0 ? (
            <div className="text-center py-8 text-sub text-sm">
              Add a team member to see the heatmap.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `clamp(80px, 25vw, 120px) repeat(${days.length}, 32px)`,
                }}
              >
                <div />
                {days.map((d) => (
                  <div
                    key={d}
                    className="text-xs text-sub font-data text-center rotate-[-45deg] origin-bottom-left mt-4"
                  >
                    {d.slice(5)}
                  </div>
                ))}
                {members.map((m) => (
                  <div key={m.id} style={{ display: "contents" }}>
                    <div className="text-xs text-text/80 truncate py-1">{m.name}</div>
                    {days.map((d) => {
                      const entry = entries.find((e) => e.memberId === m.id && e.date === d);
                      const score = entry?.score ?? null;
                      const color = score
                        ? FACES.find((f) => f.score === score)?.color
                        : "transparent";
                      // Append the note to the tooltip when present so the
                      // heatmap doubles as a hover-explorer over what people
                      // wrote that day, without bloating the cell visually.
                      const tooltip = score
                        ? entry?.note
                          ? `${m.name} — ${d} — ${score}/5\n${entry.note}`
                          : `${m.name} — ${d} — ${score}/5`
                        : "No entry";
                      return (
                        <div
                          key={d}
                          title={tooltip}
                          className="h-6 rounded border border-border"
                          style={{ background: color ?? "transparent" }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </ToolPageWrapper>
  );
}
