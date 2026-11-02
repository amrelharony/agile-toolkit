"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { chartTheme } from "@/components/charts/chart-theme";
import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { Activity, Sparkles, Trophy, Flame, Target, Calendar } from "lucide-react";
import { useHistory } from "@/lib/history/use-history";
import { tools as ALL_TOOLS } from "@/lib/constants/tools";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateHistoryInsightPrompts } from "@/lib/ai-prompts/history-insights";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

const HEATMAP_DAYS = 35;
const ACCENT = "var(--chart-1)";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function generateDayKeys(daysBack: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    keys.push(dayKey(d));
  }
  return keys;
}

export default function InsightsPage() {
  const { profile, status } = useAuth();
  const { events } = useHistory({ limit: 5000 });

  const stats = useMemo(() => {
    const total = events.length;
    const milestones = events.filter((e) => e.isMilestone).length;

    // Daily counts for the last 30 days
    const dayKeys = generateDayKeys(30);
    const countsByDay = new Map<string, number>();
    for (const k of dayKeys) countsByDay.set(k, 0);
    for (const e of events) {
      const k = e.occurredAt.slice(0, 10);
      if (countsByDay.has(k)) {
        countsByDay.set(k, (countsByDay.get(k) ?? 0) + 1);
      }
    }
    const dailySeries = dayKeys.map((day) => ({
      day: day.slice(5),
      events: countsByDay.get(day) ?? 0,
    }));

    // Tool usage tally
    const toolCounts = new Map<string, number>();
    for (const e of events) toolCounts.set(e.toolId, (toolCounts.get(e.toolId) ?? 0) + 1);
    const toolSeries = Array.from(toolCounts.entries())
      .map(([toolId, count]) => ({
        toolId,
        name: ALL_TOOLS.find((t) => t.id === toolId)?.name ?? toolId,
        events: count,
      }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 8);

    const busiestTool = toolSeries[0]?.name ?? "—";

    // Streak: longest run of consecutive days with at least one event.
    let bestStreak = 0;
    let curStreak = 0;
    for (const k of dayKeys) {
      if ((countsByDay.get(k) ?? 0) > 0) {
        curStreak += 1;
        if (curStreak > bestStreak) bestStreak = curStreak;
      } else {
        curStreak = 0;
      }
    }

    // Heatmap (35 days × 1) — value buckets for cell colour
    const heatmapKeys = generateDayKeys(HEATMAP_DAYS);
    const heatmap = heatmapKeys.map((day) => ({
      day,
      count: countsByDay.get(day) ?? 0,
    }));
    const maxHeat = Math.max(1, ...heatmap.map((h) => h.count));

    return {
      total,
      milestones,
      busiestTool,
      bestStreak,
      dailySeries,
      toolSeries,
      heatmap,
      maxHeat,
    };
  }, [events]);

  const aiConfig = useMemo(() => generateHistoryInsightPrompts(events), [events]);

  const greeting = profile?.display_name ? `${profile.display_name.split(" ")[0]}'s` : "Your";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="container-meta"
    >
      {/* Header */}
      <div className="panel mb-6 flex items-start justify-between gap-3 flex-wrap px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-accent" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-fluid-h2 font-display font-bold text-text leading-tight">
              {greeting} activity
            </h1>
            <p className="text-fluid-body text-sub mt-1">
              Cross-tool analytics, streaks, and AI-powered digests.
            </p>
          </div>
        </div>
        <AiPromptGenerator config={aiConfig} />
      </div>

      {events.length === 0 ? (
        <EmptyState visitor={status !== "authenticated" && status !== "loading"} />
      ) : (
        <>
          {/* KPI cards.
              Container queries on each card mean the internal layout
              decides on its own card width — collapsing the sidebar
              shrinks each card without crossing a viewport breakpoint,
              and we still want the icon to drop below the value at
              narrow widths (< 11rem ≈ 176 px). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KpiCard
              icon={<Target className="w-4 h-4" />}
              label="Total events"
              value={stats.total.toString()}
            />
            <KpiCard
              icon={<Trophy className="w-4 h-4" />}
              label="Milestones"
              value={stats.milestones.toString()}
            />
            <KpiCard
              icon={<Flame className="w-4 h-4" />}
              label="Best streak"
              value={`${stats.bestStreak}d`}
            />
            <KpiCard
              icon={<Sparkles className="w-4 h-4" />}
              label="Busiest tool"
              value={stats.busiestTool}
              titleAttr={stats.busiestTool}
            />
          </div>

          {/* Daily activity */}
          <ChartCard
            title="Daily activity (last 30 days)"
            icon={Calendar}
            height={224}
            className="mb-6"
          >
            <BarChart data={stats.dailySeries} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: chartTheme.gridColor }}
                contentStyle={chartTheme.tooltipStyle}
              />
              <Bar dataKey="events" fill={ACCENT} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>

          {/* Two-column: tool usage + heatmap */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            <ChartCard title="Top tools by activity" height={256}>
              <BarChart
                data={stats.toolSeries}
                layout="vertical"
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="var(--rule)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={90}
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                />
                <Tooltip
                  cursor={{ fill: chartTheme.gridColor }}
                  contentStyle={chartTheme.tooltipStyle}
                />
                <Bar dataKey="events" fill={ACCENT} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>

            {/* @container: this card chooses its own grid density based
                on its width, so the heatmap squeezes into 7 cols × 5 rows
                on narrow cards (sidebar expanded + medium screens) and
                spreads to 14 cols × ~3 rows when the card is wide enough. */}
            <SectionCard
              title="Activity heatmap (last 35 days)"
              titleSize="sm"
              className="@container"
            >
              {/* The counts live only in colour and a hover title, so each
                  cell carries its day + count as text for screen readers. */}
              <ol
                aria-label="Events per day"
                className="grid grid-cols-7 @lg:grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5"
              >
                {stats.heatmap.map((cell) => {
                  const intensity = cell.count / stats.maxHeat;
                  const opacity = cell.count === 0 ? 0.06 : 0.18 + intensity * 0.82;
                  return (
                    <li
                      key={cell.day}
                      className="aspect-square rounded-sm border border-border"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${ACCENT} ${Math.round(opacity * 100)}%, transparent)`,
                      }}
                      title={`${cell.day}: ${cell.count} events`}
                    >
                      <span className="sr-only">
                        {cell.day}: {cell.count} {cell.count === 1 ? "event" : "events"}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="flex items-center justify-between text-xs text-sub mt-3">
                <span>{stats.heatmap[0]?.day}</span>
                <span className="flex items-center gap-1">
                  less
                  <span className="inline-flex gap-0.5" aria-hidden="true">
                    {[0.06, 0.3, 0.55, 0.8, 1].map((a) => (
                      <span
                        key={a}
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${ACCENT} ${Math.round(a * 100)}%, transparent)`,
                        }}
                      />
                    ))}
                  </span>
                  more
                </span>
                <span>{stats.heatmap[stats.heatmap.length - 1]?.day}</span>
              </div>
            </SectionCard>
          </div>

          {/* Trend line */}
          <ChartCard title="30-day trend" badge="experimental" height={192}>
            <LineChart data={stats.dailySeries} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ stroke: chartTheme.gridColor }}
                contentStyle={chartTheme.tooltipStyle}
              />
              <Line
                type="monotone"
                dataKey="events"
                stroke={ACCENT}
                strokeWidth={2}
                dot={{ fill: ACCENT, r: 2 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartCard>
        </>
      )}
    </motion.div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  titleAttr,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  titleAttr?: string;
}) {
  // @container makes this card a query parent. The label/value layout
  // adapts to the card's own width — useful when sidebar collapse changes
  // available content area without crossing a viewport breakpoint.
  //   < @sm (24rem ≈ 384 px container): tight stacked layout (default)
  //   ≥ @sm: comfortable spacing + larger value type
  return (
    <div className="@container bg-[var(--card)] border border-border rounded-lg p-3 @sm:p-4">
      <div className="flex items-center gap-2 text-sub text-xs">
        <span className="text-accent">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className="mt-1 text-xl @sm:text-2xl @md:text-3xl font-data font-bold text-text truncate"
        title={titleAttr}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ visitor }: { visitor: boolean }) {
  return (
    <div
      className={cn("border border-dashed border-border rounded-lg p-12 text-center", "text-sub")}
    >
      <Activity className="w-10 h-10 mx-auto mb-3 text-accent/30" aria-hidden="true" />
      <p className="text-sm font-medium text-text">Insights unlock as you use the toolkit</p>
      <p className="text-xs mt-1 max-w-md mx-auto">
        Open any tool — record retros, log impediments, run a planning poker session. Insights
        aggregate from your history.
      </p>
      {visitor && (
        <p className="text-xs mt-3 text-accent">
          Your history and insights are saved in this browser only.
        </p>
      )}
    </div>
  );
}
