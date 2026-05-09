"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { WorkspaceSyncButton } from "@/components/shared/workspace-sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Smile, Heart, TrendingUp } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { trendDirection, mean } from "@/lib/analytics/anomaly";
import { generateMoodTrackerPrompts } from "@/lib/ai-prompts/mood-tracker";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MOOD_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";

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
  const [entries, setEntries] = usePersisted<MoodEntry[]>("agile-toolkit:mood-tracker", []);
  const [newMemberName, setNewMemberName] = useState("");
  const members = useWorkspaceStore((s) => s.teamMembers);
  const upsertMember = useWorkspaceStore((s) => s.upsertTeamMember);
  const { log: logEvent } = useHistoryLogger("mood-tracker");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const todayISO = todayLocalISO();
  // Recompute on every render so the 14-day window doesn't freeze across midnight.
  // The cost is trivial — 14-entry array — and stale data here would surprise users.
  const days = lastNDays(14);

  const log = (memberId: string, score: MoodEntry["score"]) => {
    sonify("mood-tracker", MOOD_EVENT[score]);
    setEntries((e) => {
      const existing = e.find((x) => x.memberId === memberId && x.date === todayISO);
      if (existing) return e.map((x) => (x === existing ? { ...x, score } : x));
      return [...e, { id: nanoid(8), memberId, date: todayISO, score }];
    });
    logEvent(MOOD_ACTIONS.MOOD_LOGGED, { memberId, score, date: todayISO });
  };

  const addMember = () => {
    if (!newMemberName.trim()) return;
    const id = nanoid(8);
    upsertMember({ id, name: newMemberName.trim() });
    setNewMemberName("");
  };

  const averageByDay = useMemo(() => {
    return days.map((d) => {
      const todays = entries.filter((e) => e.date === d);
      return { date: d, avg: todays.length > 0 ? mean(todays.map((x) => x.score)) : null, count: todays.length };
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
        <WorkspaceSyncButton toolName="Mood Tracker" hasImport={false} onPush={() => 0} />
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
                    ? "text-green-400"
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
                return (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg p-2">
                    <span className="text-sm text-text w-40 truncate">{m.name}</span>
                    <div className="flex gap-1.5 flex-1">
                      {FACES.map((f) => (
                        <button
                          key={f.score}
                          type="button"
                          onClick={() => log(m.id, f.score)}
                          className={`flex-1 rounded-md border py-1.5 text-xs font-semibold transition ${
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
                );
              })}
              <div className="flex gap-2 pt-2">
                <Input
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="Add another team member..."
                  className="bg-bg border-border"
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

      <Card className="bg-surface border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Heart className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text">14-day Heatmap</h3>
          </div>
          {members.length === 0 ? (
            <div className="text-center py-8 text-sub text-sm">Add a team member to see the heatmap.</div>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `120px repeat(${days.length}, 32px)` }}
              >
                <div />
                {days.map((d) => (
                  <div key={d} className="text-[9px] text-sub font-data text-center rotate-[-45deg] origin-bottom-left mt-4">
                    {d.slice(5)}
                  </div>
                ))}
                {members.map((m) => (
                  <div key={m.id} style={{ display: "contents" }}>
                    <div className="text-xs text-text/80 truncate py-1">{m.name}</div>
                    {days.map((d) => {
                      const entry = entries.find((e) => e.memberId === m.id && e.date === d);
                      const score = entry?.score ?? null;
                      const color = score ? FACES.find((f) => f.score === score)?.color : "transparent";
                      return (
                        <div
                          key={d}
                          title={score ? `${m.name} — ${d} — ${score}/5` : `No entry`}
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
