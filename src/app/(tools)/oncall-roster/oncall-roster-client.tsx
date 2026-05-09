"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ONCALL_ACTIONS } from "@/lib/history/event-actions";
import { generateOncallRosterPrompts } from "@/lib/ai-prompts/oncall-roster";

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
}

const DEFAULT_STATE: OncallState = { shifts: [], pages: [] };

const SEVERITY_LABEL: Record<Severity, string> = {
  sev1: "SEV-1",
  sev2: "SEV-2",
  sev3: "SEV-3",
  sev4: "SEV-4",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  sev1: "bg-danger/15 text-danger border-danger/40",
  sev2: "bg-danger/10 text-danger border-danger/30",
  sev3: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  sev4: "bg-accent/10 text-accent border-accent/30",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftCovers(shift: OncallShift, ts: number): boolean {
  const start = new Date(shift.startDate).getTime();
  const endDate = new Date(shift.endDate);
  // Inclusive end-of-day so a same-day shift covers events that day.
  endDate.setHours(23, 59, 59, 999);
  const end = endDate.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return ts >= start && ts <= end;
}

function activeShiftAt(shifts: OncallShift[], ts: number): OncallShift | null {
  return shifts.find((s) => shiftCovers(s, ts)) ?? null;
}

function burnoutTone(count: number): "default" | "warning" | "danger" {
  if (count > 5) return "danger";
  if (count >= 3) return "warning";
  return "default";
}

function burnoutClasses(count: number): string {
  if (count > 5) return "border-danger/40 bg-danger/10 text-danger";
  if (count >= 3) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
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

export function OncallRosterClient() {
  const [state, setState] = usePersisted<OncallState>(
    "agile-toolkit:oncall-roster",
    DEFAULT_STATE
  );
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
    log(ONCALL_ACTIONS.PAGE_LOGGED, { pageId: id, removed: true });
  };

  const active = useMemo(() => activeShiftAt(state.shifts, now), [state.shifts, now]);

  const sortedShifts = useMemo(
    () =>
      [...state.shifts].sort((a, b) =>
        a.startDate.localeCompare(b.startDate)
      ),
    [state.shifts]
  );

  // Page count per shift (used by burnout heatmap).
  const pageCountByShift = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of state.pages) m.set(p.shiftId, (m.get(p.shiftId) ?? 0) + 1);
    return m;
  }, [state.pages]);

  const pagesThisMonth = useMemo(() => {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 1);
    const cutoffMs = cutoff.getTime();
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
      { person: string; totalPages: number; shifts: number }
    >();
    for (const s of state.shifts) {
      const cur = map.get(s.person) ?? {
        person: s.person,
        totalPages: 0,
        shifts: 0,
      };
      cur.shifts += 1;
      cur.totalPages += pageCountByShift.get(s.id) ?? 0;
      map.set(s.person, cur);
    }
    return Array.from(map.values())
      .map((p) => ({
        ...p,
        pagesPerShift: p.shifts > 0 ? p.totalPages / p.shifts : 0,
      }))
      .sort((a, b) => b.totalPages - a.totalPages);
  }, [state.shifts, pageCountByShift]);

  const topPagedPerson = personStats[0]?.person ?? null;

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
    [
      state.shifts,
      pageCountByShift,
      personStats,
      pagesThisMonth,
      topPagedPerson,
    ]
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
            headers: [
              "Person",
              "Start",
              "End",
              "Pages",
              "Description",
            ],
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
          hint={
            personStats[0]
              ? `${personStats[0].totalPages} pages`
              : "no pages logged"
          }
        />
      </KpiGrid>

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
                onChange={(e) =>
                  setShiftDraft((d) => ({ ...d, person: e.target.value }))
                }
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
                  onChange={(e) =>
                    setShiftDraft((d) => ({ ...d, startDate: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setShiftDraft((d) => ({ ...d, endDate: e.target.value }))
                  }
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
                onChange={(e) =>
                  setShiftDraft((d) => ({ ...d, description: e.target.value }))
                }
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
              No active shift covers right now. Add a shift covering today
              before logging pages.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-sub">
                Page will be assigned to{" "}
                <span className="text-accent font-data">{active.person}</span>{" "}
                ({active.startDate} → {active.endDate}).
              </p>
              <div>
                <Label htmlFor="oc-page-sev" className="text-xs text-sub">
                  Severity
                </Label>
                <Select
                  value={pageDraft.severity}
                  onValueChange={(v) =>
                    setPageDraft((d) => ({ ...d, severity: v as Severity }))
                  }
                >
                  <SelectTrigger
                    id="oc-page-sev"
                    className="bg-surface border-border"
                  >
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
                  onChange={(e) =>
                    setPageDraft((d) => ({ ...d, description: e.target.value }))
                  }
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
          No shifts yet. Add an oncall shift above to start tracking pages and
          burnout signals.
        </EmptyState>
      ) : (
        <SectionCard
          title="Rotation calendar (burnout heatmap)"
          icon={Calendar}
          titleSize="lg"
          className="mb-6"
        >
          <p className="text-xs text-sub mb-3">
            Each shift is colored by page count. Green &lt; 3 · amber 3-5 ·
            red &gt; 5.
          </p>
          <div className="space-y-2">
            {sortedShifts.map((s) => {
              const count = pageCountByShift.get(s.id) ?? 0;
              return (
                <div
                  key={s.id}
                  className={`p-3 rounded-md border ${burnoutClasses(
                    count
                  )} flex items-start gap-3`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-text">
                        {s.person}
                      </span>
                      <span className="text-xs font-data text-sub">
                        {s.startDate} → {s.endDate}
                      </span>
                      {active?.id === s.id && (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 text-[10px]"
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
                    <div className="font-data text-lg leading-tight">
                      {count}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider opacity-70">
                      pages
                    </div>
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
        <SectionCard
          title="Per-person paging stats"
          icon={User}
          titleSize="lg"
          className="mb-6"
        >
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Person</th>
                  <th className="py-2 pr-3">Shifts</th>
                  <th className="py-2 pr-3">Pages</th>
                  <th className="py-2 pr-3">Pages / shift</th>
                </tr>
              </thead>
              <tbody>
                {personStats.map((p) => (
                  <tr key={p.person} className="border-b border-border/40">
                    <td className="py-2 pr-3 text-text">{p.person}</td>
                    <td className="py-2 pr-3 font-data">{p.shifts}</td>
                    <td className="py-2 pr-3 font-data">
                      <Badge
                        variant="outline"
                        className={burnoutClasses(p.pagesPerShift)}
                      >
                        {p.totalPages}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-data">
                      {p.pagesPerShift.toFixed(2)}
                    </td>
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
              .sort(
                (a, b) =>
                  new Date(b.ts).getTime() - new Date(a.ts).getTime()
              )
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
                        <span className="text-accent">
                          {shift?.person ?? "(unknown)"}
                        </span>
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
