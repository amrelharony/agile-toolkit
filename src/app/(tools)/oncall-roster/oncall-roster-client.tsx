"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Phone,
  Calendar,
  AlertTriangle,
  Flame,
  User,
  TrendingUp,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OncallRoster } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ONCALL_ACTIONS } from "@/lib/history/event-actions";
import { generateOncallRosterPrompts } from "@/lib/ai-prompts/oncall-roster";
import { SmartInput } from "@/components/shared/smart-input";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { mannKendall } from "@/lib/analytics/trend-test";
import { cusum } from "@/lib/analytics/changepoint";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";

// Recharts loads with the paging chart, not the page.
const PagingFrequencyChart = dynamic(() => import("./charts").then((m) => m.PagingFrequencyChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

type Severity = "sev1" | "sev2" | "sev3" | "sev4";

interface OncallShift {
  id: string;
  person: string;
  startDate: string;
  endDate: string;
  description?: string;
}

interface Page {
  id: string;
  shiftId: string;
  ts: string;
  severity: Severity;
  description?: string;
}

interface OncallState {
  shifts: OncallShift[];
  pages: Page[];
  /** Operator-supplied expected pages per week (default for capacity planning). */
  expectedPagesPerWeek?: number;
}

const DEFAULT_STATE: OncallState = { shifts: [], pages: [] };

const OR_ID = "oncallRoster:current"; // MUST match OR_ID in oncall-roster.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// shift/page writes round-trip into the UI. Drop-in [state, setState] bridging
// the local OncallState shape to the OncallRoster entity (structurally equal).
function useOncallRoster(): [
  OncallState,
  (u: OncallState | ((p: OncallState) => OncallState)) => void,
] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.oncallRosters ?? []).find((d) => d.id === OR_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertOncallRoster);
  const state: OncallState = doc
    ? { shifts: doc.shifts, pages: doc.pages, expectedPagesPerWeek: doc.expectedPagesPerWeek }
    : DEFAULT_STATE;
  const setState = (u: OncallState | ((p: OncallState) => OncallState)) => {
    const cur = (useWorkspaceStore.getState().oncallRosters ?? []).find(
      (d: OncallRoster) => d.id === OR_ID
    );
    const curState: OncallState = cur
      ? { shifts: cur.shifts, pages: cur.pages, expectedPagesPerWeek: cur.expectedPagesPerWeek }
      : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({
      id: OR_ID,
      shifts: next.shifts,
      pages: next.pages,
      expectedPagesPerWeek: next.expectedPagesPerWeek,
    });
  };
  return [state, setState];
}

const SEVERITY_LABEL: Record<Severity, string> = {
  sev1: "SEV-1",
  sev2: "SEV-2",
  sev3: "SEV-3",
  sev4: "SEV-4",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  sev1: "bg-danger/15 text-danger border-danger/40",
  sev2: "bg-danger/10 text-danger border-danger/30",
  sev3: "bg-warning/10 text-warning border-warning/30",
  sev4: "bg-accent/10 text-accent border-accent/30",
};

function todayIso(): string {
  // R11-fix: use LOCAL date components, not UTC. The previous
  // `toISOString().slice(0,10)` returned the UTC date — for a PT user
  // logging a shift at 23:00 local, "today" defaulted to TOMORROW
  // (UTC). The shift-coverage check uses `parseLocalDate`, so mixing
  // a UTC default with a local check produced off-by-one shifts.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// R5: parse YYYY-MM-DD strings as LOCAL date so the start/end of the
// shift window matches the user's clock, not UTC midnight. The
// previous `new Date("YYYY-MM-DD")` parsed as UTC midnight and then
// `setHours(23,59,...)` set local hours — mixing the two produced a
// UTC-offset-shifted window so a page logged "noon local" could fall
// outside the shift the user perceived as covering it.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function parseLocalDate(s: string): number {
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(s).getTime();
}
function shiftCovers(shift: OncallShift, ts: number): boolean {
  const start = parseLocalDate(shift.startDate);
  const endDate = new Date(parseLocalDate(shift.endDate));
  // Inclusive end-of-day so a same-day shift covers events that day.
  endDate.setHours(23, 59, 59, 999);
  const end = endDate.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return ts >= start && ts <= end;
}

function activeShiftAt(shifts: OncallShift[], ts: number): OncallShift | null {
  // For overlapping shifts (handover days), the newest start wins so a
  // hand-over to the next shift is reflected immediately.
  const candidates = shifts.filter((s) => shiftCovers(s, ts));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function burnoutTone(count: number): "default" | "warning" | "danger" {
  if (count > 5) return "danger";
  if (count >= 3) return "warning";
  return "default";
}

/**
 * Colour for a paging rate in pages per 7 days on call. The thresholds were
 * applied to raw per-shift counts, so 4 pages read the same on a 1-day and
 * a 14-day shift; they now apply to a rate normalized to a one-week shift.
 */
function burnoutClasses(pagesPerWeek: number): string {
  if (pagesPerWeek > 5) return "border-danger/40 bg-danger/10 text-danger";
  if (pagesPerWeek >= 3) return "border-warning/40 bg-warning/10 text-warning";
  return "border-success/40 bg-success/10 text-success";
}

/**
 * Calendar days a shift has been on call: start to end inclusive, or start
 * to today while it's still running (its pages so far cover only those days).
 * At least 1, so a shift that hasn't started can't divide by zero.
 */
function shiftDaysOnCall(shift: OncallShift, now: number): number {
  const start = parseLocalDate(shift.startDate);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = Math.min(parseLocalDate(shift.endDate), today.getTime());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  // Round, not floor: a DST change makes one day 23 or 25 hours long.
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function pagesPerWeek(pages: number, days: number): number {
  return (pages * 7) / Math.max(1, days);
}

interface ShiftDraft {
  person: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface PageDraft {
  severity: Severity;
  description: string;
}

function emptyShiftDraft(): ShiftDraft {
  const today = todayIso();
  return { person: "", startDate: today, endDate: today, description: "" };
}

function emptyPageDraft(): PageDraft {
  return { severity: "sev3", description: "" };
}

/**
 * Smart-default-backed input for the operator's expected pages-per-week.
 * Used as a capacity-planning anchor and surfaced as a SectionCard widget.
 */
function ExpectedPagesInput({
  id,
  value,
  commit,
}: {
  id?: string;
  value: number | undefined;
  commit: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string>(value === undefined ? "" : String(value));
  const lastSyncedRef = useRef<number | undefined>(value);
  useEffect(() => {
    if (lastSyncedRef.current === value) return;
    lastSyncedRef.current = value;
    setDraft(value === undefined ? "" : String(value));
  }, [value]);
  const pred = usePredictedDefault<number>("oncall-roster", "expectedPagesPerWeek", 5);
  return (
    <SmartInput<number>
      predicted={pred}
      onAccept={(v) => {
        setDraft(String(v));
        lastSyncedRef.current = v;
        commit(v);
      }}
      render={({ ghost, accept, chip }) => (
        <div className="flex flex-col gap-1">
          <Input
            id={id}
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft === "") {
                if (value !== undefined) {
                  lastSyncedRef.current = undefined;
                  commit(undefined);
                }
                return;
              }
              const n = Number(draft);
              // min=0 (the agent action rejects negatives too): put a
              // negative entry back to the committed value.
              if (!Number.isFinite(n) || n < 0) {
                setDraft(value === undefined ? "" : String(value));
                return;
              }
              if (n !== value) {
                lastSyncedRef.current = n;
                commit(n);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && draft === "") {
                e.preventDefault();
                accept();
              }
            }}
            placeholder={ghost ?? "e.g. 5"}
            className="bg-surface border-border font-data"
            aria-label="Expected pages per week"
          />
          {draft === "" && chip}
        </div>
      )}
    />
  );
}

export function OncallRosterClient() {
  const [state, setState] = useOncallRoster();
  const { log } = useHistoryLogger("oncall-roster");
  const [shiftDraft, setShiftDraft] = useState<ShiftDraft>(emptyShiftDraft);
  const [pageDraft, setPageDraft] = useState<PageDraft>(emptyPageDraft);
  const [now, setNow] = useState<number>(() => Date.now());

  // Re-evaluate "active shift" once a minute so the UI doesn't go stale.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const addShift = () => {
    const person = shiftDraft.person.trim();
    if (!person) return;
    if (!shiftDraft.startDate || !shiftDraft.endDate) return;
    if (shiftDraft.endDate < shiftDraft.startDate) return;
    const shift: OncallShift = {
      id: crypto.randomUUID(),
      person,
      startDate: shiftDraft.startDate,
      endDate: shiftDraft.endDate,
      description: shiftDraft.description.trim() || undefined,
    };
    setState((s) => ({ ...s, shifts: [...s.shifts, shift] }));
    log(ONCALL_ACTIONS.SHIFT_ADDED, {
      shiftId: shift.id,
      person: shift.person,
      startDate: shift.startDate,
      endDate: shift.endDate,
      description: shift.description,
    });
    setShiftDraft(emptyShiftDraft());
  };

  const removeShift = (id: string) => {
    const shift = state.shifts.find((s) => s.id === id);
    setState((s) => ({
      shifts: s.shifts.filter((x) => x.id !== id),
      // Cascade remove pages tied to this shift to keep counts honest.
      pages: s.pages.filter((p) => p.shiftId !== id),
    }));
    log(ONCALL_ACTIONS.SHIFT_REMOVED, {
      shiftId: id,
      person: shift?.person,
    });
  };

  const logPage = () => {
    const active = activeShiftAt(state.shifts, now);
    if (!active) return;
    const page: Page = {
      id: crypto.randomUUID(),
      shiftId: active.id,
      ts: new Date(now).toISOString(),
      severity: pageDraft.severity,
      description: pageDraft.description.trim() || undefined,
    };
    setState((s) => ({ ...s, pages: [...s.pages, page] }));
    log(ONCALL_ACTIONS.PAGE_LOGGED, {
      pageId: page.id,
      shiftId: active.id,
      person: active.person,
      severity: page.severity,
      description: page.description,
    });
    setPageDraft(emptyPageDraft());
  };

  const removePage = (id: string) => {
    setState((s) => ({ ...s, pages: s.pages.filter((p) => p.id !== id) }));
    log(ONCALL_ACTIONS.PAGE_REMOVED, { pageId: id });
  };

  const active = useMemo(() => activeShiftAt(state.shifts, now), [state.shifts, now]);

  const sortedShifts = useMemo(
    () => [...state.shifts].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [state.shifts]
  );

  // Page count per shift (used by burnout heatmap).
  const pageCountByShift = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of state.pages) m.set(p.shiftId, (m.get(p.shiftId) ?? 0) + 1);
    return m;
  }, [state.pages]);

  const pagesThisMonth = useMemo(() => {
    // Strict 30-day rolling window — avoids `setMonth(-1)` quirks around
    // month-end (e.g. Mar 31 → Mar 3 rather than Feb 28).
    const cutoffMs = now - 30 * 86400000;
    return state.pages.filter((p) => new Date(p.ts).getTime() >= cutoffMs).length;
  }, [state.pages, now]);

  const avgPagesPerShift = useMemo(() => {
    if (state.shifts.length === 0) return 0;
    return state.pages.length / state.shifts.length;
  }, [state.pages.length, state.shifts.length]);

  // Per-person aggregates.
  const personStats = useMemo(() => {
    const map = new Map<
      string,
      { person: string; totalPages: number; shifts: number; daysOnCall: number }
    >();
    for (const s of state.shifts) {
      const cur = map.get(s.person) ?? {
        person: s.person,
        totalPages: 0,
        shifts: 0,
        daysOnCall: 0,
      };
      cur.shifts += 1;
      cur.totalPages += pageCountByShift.get(s.id) ?? 0;
      cur.daysOnCall += shiftDaysOnCall(s, now);
      map.set(s.person, cur);
    }
    return Array.from(map.values())
      .map((p) => ({
        ...p,
        pagesPerShift: p.shifts > 0 ? p.totalPages / p.shifts : 0,
        pagesPerWeek: pagesPerWeek(p.totalPages, p.daysOnCall),
      }))
      .sort((a, b) => b.totalPages - a.totalPages);
  }, [state.shifts, pageCountByShift, now]);

  // Nobody is "top-paged" until someone has been paged; the first rostered
  // person used to be named with "0 pages".
  const topPaged = personStats[0] && personStats[0].totalPages > 0 ? personStats[0] : null;
  const topPagedPerson = topPaged?.person ?? null;

  // ── Tier-2: weekly paging trend + CUSUM changepoints ──────────────
  // Bucket pages into the most recent 26 calendar weeks: 25 full weeks
  // plus the current (partial) week as the final bucket. Older pages are
  // dropped so the chart stays focused on current paging behaviour.
  const weeklyPageSeries = useMemo<{
    counts: number[];
    weekLabels: string[];
  }>(() => {
    if (state.pages.length === 0) return { counts: [], weekLabels: [] };
    const WEEKS = 26;
    const today = new Date(now);
    // BUG-T5-oncall-roster-3: anchor on LOCAL week start (Sunday), not
    // UTC. The rest of the file uses local date math; a UTC anchor
    // here shifts the bucket boundary by up to 24h for users west of
    // UTC, so the same page can land in different weekly buckets
    // across runs and the week-over-week trend is off by one for
    // non-UTC users.
    // BUG-T5-oncall-roster-4: step back via `setDate(-N)` rather than
    // subtracting `N * 86_400_000` ms. The ms-arithmetic ignores DST
    // transitions — across a spring-forward / fall-back boundary the
    // anchor lands 1h off the local midnight and `setHours(0,0,0,0)`
    // can pull it back to the *previous* day, shifting all 26 buckets.
    // Anchor at today - (WEEKS-1) weeks so bucket WEEKS-1 starts on the
    // Sunday of the CURRENT week. The prior `- WEEKS * 7` anchor left the
    // current partial week without a bucket of its own — the scan-down
    // catch-all below then merged it into the last full week's bucket, so
    // the final chart point held up to ~13 days of pages. That inflated
    // point skewed Mann-Kendall toward "trending up" and could fabricate
    // a CUSUM "regime up" at the window's end on every render.
    const anchor = new Date(today);
    anchor.setDate(today.getDate() - (WEEKS - 1) * 7);
    const weekStart = new Date(anchor);
    weekStart.setDate(anchor.getDate() - anchor.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const ts = state.pages
      .map((p) => new Date(p.ts).getTime())
      .filter((t) => Number.isFinite(t) && t >= weekStart.getTime());
    if (ts.length === 0) return { counts: [], weekLabels: [] };
    const counts = new Array(WEEKS).fill(0) as number[];
    const labels: string[] = [];
    // BUG-T5-oncall-roster-5: build labels AND bucket boundaries via
    // setDate(), not via `weekStart.getTime() + w * 7 * 86_400_000`. A
    // DST transition inside the 26-week window puts the calendar a
    // single hour off, which is enough to shift labels onto the wrong
    // day (when a transition happens near midnight) and to mis-bucket
    // pages whose timestamps land in the hour the clocks jumped.
    const bucketStarts: number[] = [];
    for (let w = 0; w < WEEKS; w++) {
      const start = new Date(weekStart);
      start.setDate(weekStart.getDate() + w * 7);
      bucketStarts.push(start.getTime());
      labels.push(`${start.getMonth() + 1}/${String(start.getDate()).padStart(2, "0")}`);
    }
    for (const t of ts) {
      // Linear scan is fine for 26 buckets; binary-search wins nothing.
      let bucket = -1;
      for (let w = WEEKS - 1; w >= 0; w--) {
        if (t >= bucketStarts[w]) {
          bucket = w;
          break;
        }
      }
      if (bucket >= 0 && bucket < WEEKS) counts[bucket] += 1;
    }
    // Trim buckets BEFORE the first recorded page. They are "we weren't
    // using the tool yet", not "zero pages happened" — but the fixed
    // 26-entry array emitted them as genuine observations. Two consequences:
    // the `counts.length < 5` / `< 4` guards below could never fire (length
    // was only ever 0 or 26), and Mann-Kendall over ~21 structural zeros
    // followed by real data reported a significant UPWARD trend even when
    // paging was perfectly flat — a brand-new roster at a constant 2
    // pages/week rendered the red "trending up significantly · p=0.022"
    // chip. CUSUM likewise fired a "regime up" at the adoption point.
    // `kanban-client.tsx` anchors its weekly series the same way.
    const firstIdx = counts.findIndex((c) => c > 0);
    if (firstIdx > 0) {
      return { counts: counts.slice(firstIdx), weekLabels: labels.slice(firstIdx) };
    }
    return { counts, weekLabels: labels };
  }, [state.pages, now]);

  const pageTrend = useMemo(() => {
    if (weeklyPageSeries.counts.length < 5) return null;
    return mannKendall(weeklyPageSeries.counts);
  }, [weeklyPageSeries.counts]);

  const pageChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (weeklyPageSeries.counts.length < 4) return [];
    return cusum(weeklyPageSeries.counts).map((cp) => ({
      x: weeklyPageSeries.weekLabels[cp.index] ?? String(cp.index),
      label: cp.direction === "up" ? "Paging volume regime up" : "Paging volume regime down",
      detail: `CUSUM detected a sustained ${
        cp.direction === "up" ? "increase" : "decrease"
      } in paging starting in week ${cp.index + 1}.`,
      confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
    }));
  }, [weeklyPageSeries.counts, weeklyPageSeries.weekLabels]);

  const pagingChartData = useMemo(
    () =>
      weeklyPageSeries.counts.map((c, i) => ({
        week: weeklyPageSeries.weekLabels[i] ?? String(i),
        pages: c,
      })),
    [weeklyPageSeries.counts, weeklyPageSeries.weekLabels]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "On-Call Roster",
      prompts: generateOncallRosterPrompts({
        shifts: state.shifts.map((s) => ({
          person: s.person,
          startDate: s.startDate,
          endDate: s.endDate,
          pageCount: pageCountByShift.get(s.id) ?? 0,
          description: s.description,
        })),
        personStats,
        totalPagesThisMonth: pagesThisMonth,
        topPagedPerson,
      }),
    }),
    [state.shifts, pageCountByShift, personStats, pagesThisMonth, topPagedPerson]
  );

  return (
    <ToolPageWrapper
      toolId="oncall-roster"
      title="On-Call Roster & Burnout"
      description="Track rotations, log pages against the active shift, and surface burnout risk through a per-shift heatmap."
      category="Incidents & Reliability"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="oncall-roster"
          csvData={{
            headers: ["Person", "Start", "End", "Pages", "Description"],
            rows: sortedShifts.map((s) => [
              s.person,
              s.startDate,
              s.endDate,
              pageCountByShift.get(s.id) ?? 0,
              s.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={User}
          label="Active shift"
          value={active?.person ?? "—"}
          hint={active ? `${active.startDate} → ${active.endDate}` : "no coverage"}
          tone={active ? "success" : "warning"}
        />
        <StatCard
          variant="compact"
          icon={Phone}
          label="Pages (30d)"
          value={pagesThisMonth}
          tone={pagesThisMonth > 10 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Avg pages / shift"
          value={avgPagesPerShift.toFixed(1)}
          tone={avgPagesPerShift > 5 ? "danger" : avgPagesPerShift >= 3 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Flame}
          label="Top-paged person"
          value={topPagedPerson ?? "—"}
          hint={topPaged ? `${topPaged.totalPages} pages` : "no pages logged"}
        />
      </KpiGrid>

      <SectionCard title="Capacity expectation" icon={Phone} titleSize="lg" className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] gap-4 items-start">
          <div>
            <Label htmlFor="oncall-expected-pages" className="text-xs text-sub mb-1 block">
              Expected pages per week
            </Label>
            <ExpectedPagesInput
              id="oncall-expected-pages"
              value={state.expectedPagesPerWeek}
              commit={(next) => setState((s) => ({ ...s, expectedPagesPerWeek: next }))}
            />
          </div>
          <p className="text-xs text-sub max-w-prose">
            The team&apos;s expected paging load. Used as a baseline for the capacity-planning
            conversation; the predictor seeds a default if you haven&apos;t set one.
          </p>
        </div>
      </SectionCard>

      {pageTrend && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {pageTrend.significant ? (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border ${
                pageTrend.trend === "up"
                  ? "border-danger/40 text-danger bg-danger/10"
                  : "border-success/40 text-success bg-success/10"
              }`}
            >
              <TrendingUp className={`w-3 h-3 ${pageTrend.trend === "down" ? "rotate-180" : ""}`} />
              Weekly paging volume trending {pageTrend.trend} significantly
              <span className="opacity-60">· p={pageTrend.pValue.toFixed(3)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-border text-sub bg-surface">
              <TrendingUp className="w-3 h-3" />
              Weekly paging trend: no significant change
            </span>
          )}
          {pageChangepoints.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-warning/40 text-warning bg-warning/10">
              <AlertTriangle className="w-3 h-3" />
              {pageChangepoints.length} regime shift
              {pageChangepoints.length === 1 ? "" : "s"} detected (CUSUM)
            </span>
          )}
        </div>
      )}

      {pagingChartData.length > 1 && (
        <SectionCard title="Paging frequency by week" icon={Phone} titleSize="lg" className="mb-6">
          <div className="h-44 -mx-2">
            <PagingFrequencyChart data={pagingChartData} changepoints={pageChangepoints} />
          </div>
          <p className="text-xs text-sub mt-2">
            Pages aggregated by week. Dashed vertical lines mark CUSUM-detected regime shifts
            (sustained changes in paging volume).
          </p>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <SectionCard title="Add shift" icon={Plus} titleSize="lg">
          <div className="space-y-3">
            <div>
              <Label htmlFor="oc-person" className="text-xs text-sub">
                Person
              </Label>
              <Input
                id="oc-person"
                value={shiftDraft.person}
                onChange={(e) => setShiftDraft((d) => ({ ...d, person: e.target.value }))}
                placeholder="e.g. @aalvarez"
                className="bg-surface border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="oc-start" className="text-xs text-sub">
                  Start date
                </Label>
                <Input
                  id="oc-start"
                  type="date"
                  value={shiftDraft.startDate}
                  onChange={(e) => setShiftDraft((d) => ({ ...d, startDate: e.target.value }))}
                  className="bg-surface border-border font-data"
                />
              </div>
              <div>
                <Label htmlFor="oc-end" className="text-xs text-sub">
                  End date
                </Label>
                <Input
                  id="oc-end"
                  type="date"
                  value={shiftDraft.endDate}
                  onChange={(e) => setShiftDraft((d) => ({ ...d, endDate: e.target.value }))}
                  className="bg-surface border-border font-data"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="oc-shift-desc" className="text-xs text-sub">
                Description (optional)
              </Label>
              <Textarea
                id="oc-shift-desc"
                value={shiftDraft.description}
                onChange={(e) => setShiftDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Notes about this shift (handover, expected events…)"
                rows={2}
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
              onClick={addShift}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> Add shift
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Log a page" icon={Phone} titleSize="lg">
          {!active ? (
            <p className="text-xs text-sub italic">
              No active shift covers right now. Add a shift covering today before logging pages.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-sub">
                Page will be assigned to{" "}
                <span className="text-accent font-data">{active.person}</span> ({active.startDate} →{" "}
                {active.endDate}).
              </p>
              <div>
                <Label htmlFor="oc-page-sev" className="text-xs text-sub">
                  Severity
                </Label>
                <Select
                  value={pageDraft.severity}
                  onValueChange={(v) => setPageDraft((d) => ({ ...d, severity: v as Severity }))}
                >
                  <SelectTrigger id="oc-page-sev" className="bg-surface border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="oc-page-desc" className="text-xs text-sub">
                  Description (optional)
                </Label>
                <Textarea
                  id="oc-page-desc"
                  value={pageDraft.description}
                  onChange={(e) => setPageDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="What was paged? Any false-positive note?"
                  rows={2}
                  className="bg-surface border-border resize-none text-xs"
                />
              </div>
              <Button
                onClick={logPage}
                className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
              >
                <Phone className="w-4 h-4" aria-hidden="true" /> Log page
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      {state.shifts.length === 0 ? (
        <EmptyState icon={Calendar}>
          No shifts yet. Add an oncall shift above to start tracking pages and burnout signals.
        </EmptyState>
      ) : (
        <SectionCard
          title="Rotation calendar (burnout heatmap)"
          icon={Calendar}
          titleSize="lg"
          className="mb-6"
        >
          <p className="text-xs text-sub mb-3">
            Each shift is colored by pages per 7 days on call, so short and long shifts compare
            fairly. Green &lt; 3 · amber 3-5 · red &gt; 5.
          </p>
          <div className="space-y-2">
            {sortedShifts.map((s) => {
              const count = pageCountByShift.get(s.id) ?? 0;
              const rate = pagesPerWeek(count, shiftDaysOnCall(s, now));
              return (
                <div
                  key={s.id}
                  data-testid={`shift-${s.id}`}
                  className={`p-3 rounded-md border ${burnoutClasses(rate)} flex items-start gap-3`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-text">{s.person}</span>
                      <span className="text-xs font-data text-sub">
                        {s.startDate} → {s.endDate}
                      </span>
                      {active?.id === s.id && (
                        <Badge
                          variant="outline"
                          className="bg-success/15 text-success border-success/40 text-xs"
                        >
                          ACTIVE
                        </Badge>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-xs text-sub whitespace-pre-wrap break-words">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-data text-lg leading-tight">{count}</div>
                    <div className="text-xs uppercase tracking-wider opacity-70">pages</div>
                    <div className="text-xs font-data opacity-70">{rate.toFixed(1)} / 7 days</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeShift(s.id)}
                    className="h-7 w-7 p-0 text-sub hover:text-danger"
                    aria-label={`Remove shift for ${s.person}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {personStats.length > 0 && (
        <SectionCard title="Per-person paging stats" icon={User} titleSize="lg" className="mb-6">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-full md:min-w-[480px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Person</th>
                  <th className="py-2 pr-3">Shifts</th>
                  <th className="py-2 pr-3">Pages</th>
                  <th className="py-2 pr-3">Pages / shift</th>
                  <th className="py-2 pr-3">Pages / 7 days</th>
                </tr>
              </thead>
              <tbody>
                {personStats.map((p) => (
                  <tr key={p.person} className="border-b border-border">
                    <td className="py-2 pr-3 text-text">{p.person}</td>
                    <td className="py-2 pr-3 font-data">{p.shifts}</td>
                    <td className="py-2 pr-3 font-data">
                      <Badge variant="outline" className={burnoutClasses(p.pagesPerWeek)}>
                        {p.totalPages}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-data">{p.pagesPerShift.toFixed(2)}</td>
                    <td className="py-2 pr-3 font-data">{p.pagesPerWeek.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {state.pages.length > 0 && (
        <SectionCard title="Recent pages" icon={Phone} titleSize="lg">
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-2">
            {[...state.pages]
              .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
              .slice(0, 30)
              .map((p) => {
                const shift = state.shifts.find((s) => s.id === p.shiftId);
                return (
                  <li
                    key={p.id}
                    className="flex items-start gap-2 text-xs p-2 rounded-md border border-border bg-bg"
                  >
                    <Badge
                      variant="outline"
                      className={`${SEVERITY_BADGE[p.severity]} font-data shrink-0`}
                    >
                      {SEVERITY_LABEL[p.severity]}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-text font-data">
                          {new Date(p.ts).toLocaleString()}
                        </span>
                        <span className="text-sub">→</span>
                        <span className="text-accent">{shift?.person ?? "(unknown)"}</span>
                      </div>
                      {p.description && (
                        <p className="text-sub mt-0.5 whitespace-pre-wrap break-words">
                          {p.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removePage(p.id)}
                      className="h-6 w-6 p-0 text-sub hover:text-danger"
                      aria-label="Remove page"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
          </ul>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}
