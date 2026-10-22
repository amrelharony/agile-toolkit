"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Milestone, Plus, Trash2 } from "lucide-react";
import { forecastLinear } from "@/lib/analytics/forecasting";
import { generateEpicRoadmapPrompts } from "@/lib/ai-prompts/epic-roadmap";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { EPIC_ROADMAP_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { SAFE_CSS_COLOR_RE } from "@/lib/whiteboard/object-validator";

/** Hardened color picker — falls back to the default accent color if the
 * persisted color value doesn't match the strict whitelist (e.g. a
 * hand-edited localStorage payload that smuggled `;background:url(...)` into
 * an inline style). Mirrors the same guard used by the whiteboard renderer. */
function safeColor(c: string | undefined): string {
  if (typeof c !== "string" || c.length === 0 || c.length > 64) return "#00f0ff";
  return SAFE_CSS_COLOR_RE.test(c.trim()) ? c : "#00f0ff";
}

interface Epic {
  id: string;
  title: string;
  description?: string;
  startQuarter: string;
  endQuarter: string;
  progress: number;
  owner?: string;
  color?: string;
}

const COLORS = ["#00f0ff", "#a855f7", "#34d399", "#f59e0b", "#ef4444", "#6366f1", "#f472b6"];

// Use a 0-indexed quarter so encode/decode round-trip cleanly. The previous
// scheme `year*4 + q` (q in 1..4) decoded year as floor(i/4), which mapped
// year=2026 Q4 (i=8108) to year=2027 because 8108/4 == 2027 exactly — every
// Q4 was attributed to the following year in the timeline header.
//   Sentinel: 0 means "unparsable", real years map to year*4+1..year*4+4.
function quarterIndex(q: string): number {
  const m = q.match(/(\d{4})\s*Q([1-4])/i);
  if (!m) return 0;
  const year = parseInt(m[1], 10);
  // R5: require year >= 1900 — without this, a hand-edited or migrated
  // epic carrying `"0 Q1"` produced index 1 (non-zero, passes the
  // sentinel check) and the timeline header rendered literal "0 Q1".
  if (year < 1900 || year > 2200) return 0;
  const qNum = parseInt(m[2], 10); // 1..4
  return year * 4 + qNum; // sentinel-safe: year*4+1..+4
}

// R5: cap grid columns. A pasted "9999 Q1" through "9999 Q4" produced
// ~40k iterations and DOM nodes, freezing the tab. 40 quarters = 10
// years which is well past any reasonable roadmap horizon.
const MAX_QUARTERS_SPAN = 40;

function quartersBetween(from: string, to: string): string[] {
  const start = quarterIndex(from);
  const end = quarterIndex(to);
  if (start === 0 || end === 0 || end < start) return [];
  const out: string[] = [];
  const span = Math.min(end - start + 1, MAX_QUARTERS_SPAN);
  const stop = start + span - 1;
  for (let i = start; i <= stop; i++) {
    // Subtract 1 before the divmod so q=4 stays in its own year. e.g.
    // i=8108 (2026 Q4) → (i-1)=8107 → year=2026, q=(8107%4)+1=4.
    const zero = i - 1;
    const year = Math.floor(zero / 4);
    const q = (zero % 4) + 1;
    out.push(`${year} Q${q}`);
  }
  return out;
}

function EpicRowEditor({
  epic,
  update,
  logUpdate,
  remove,
}: {
  epic: Epic;
  update: (id: string, patch: Partial<Epic>) => void;
  logUpdate: (id: string, fields: string[]) => void;
  remove: (id: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(epic.title);
  const [descDraft, setDescDraft] = useState(epic.description ?? "");
  const lastTitleRef = useRef(epic.title);
  const lastDescRef = useRef(epic.description ?? "");

  useEffect(() => {
    setTitleDraft(epic.title);
    lastTitleRef.current = epic.title;
  }, [epic.title]);

  useEffect(() => {
    setDescDraft(epic.description ?? "");
    lastDescRef.current = epic.description ?? "";
  }, [epic.description]);

  const commitTitle = () => {
    if (titleDraft !== epic.title) {
      update(epic.id, { title: titleDraft });
    }
    if (titleDraft !== lastTitleRef.current) {
      lastTitleRef.current = titleDraft;
      logUpdate(epic.id, ["title"]);
    }
  };

  const commitDesc = () => {
    const normalized = descDraft.trim() ? descDraft : undefined;
    if (normalized !== epic.description) {
      update(epic.id, { description: normalized });
    }
    const normalizedForRef = normalized ?? "";
    if (normalizedForRef !== lastDescRef.current) {
      lastDescRef.current = normalizedForRef;
      logUpdate(epic.id, ["description"]);
    }
  };

  return (
    <div className="py-2 pr-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{ background: safeColor(epic.color) }} />
        <Input
          value={titleDraft}
          onChange={(ev) => setTitleDraft(ev.target.value)}
          onBlur={commitTitle}
          className="bg-bg border-border text-sm h-7 flex-1"
          aria-label="Epic title"
        />
        <ProgressCell
          label={`Progress % for ${epic.title || "epic"}`}
          value={epic.progress}
          onChange={(n) => {
            update(epic.id, { progress: n });
            logUpdate(epic.id, ["progress"]);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => remove(epic.id)}
          className="h-7 text-sub hover:text-danger"
          aria-label={`Remove ${epic.title || "epic"}`}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </div>
      <Textarea
        value={descDraft}
        onChange={(ev) => setDescDraft(ev.target.value)}
        onBlur={commitDesc}
        placeholder="Description (optional)..."
        rows={2}
        className="bg-bg border-border resize-none text-xs"
        aria-label="Epic description"
      />
    </div>
  );
}

function ProgressCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    // `Number("")` is 0, not NaN: an emptied field would commit 0 and wipe
    // the epic's progress. Treat blank as invalid and restore the value.
    if (draft.trim() !== "" && Number.isFinite(n)) {
      const clamped = Math.max(0, Math.min(100, n));
      if (clamped !== value) onChange(clamped);
      else setDraft(String(value));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      value={draft}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") ev.currentTarget.blur();
      }}
      className="bg-bg border-border font-data h-7 w-14"
      aria-label={label}
    />
  );
}

const ER_ID = "epicRoadmap:current"; // MUST match ER_ID in epic-roadmap.ts.
const EMPTY_EPICS: Epic[] = [];

// Synced workspace singleton (was isolated usePersisted/localStorage) wrapping
// the epics[] array. Drop-in [state, setState] (structural types).
function useEpics(): [Epic[], (u: Epic[] | ((p: Epic[]) => Epic[])) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.epicRoadmaps ?? []).find((d) => d.id === ER_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertEpicRoadmap);
  const epics = doc?.epics ?? EMPTY_EPICS;
  const setEpics = (u: Epic[] | ((p: Epic[]) => Epic[])) => {
    const cur =
      (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)?.epics ?? [];
    const next = typeof u === "function" ? u(cur) : u;
    upsert({ id: ER_ID, epics: next });
  };
  return [epics, setEpics];
}

export function EpicRoadmapClient() {
  const [epics, setEpics] = useEpics();
  const thisYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${thisYear} Q1`);
  const [to, setTo] = useState(`${thisYear} Q4`);
  const { log } = useHistoryLogger("epic-roadmap");

  const add = () => {
    const epic = {
      id: nanoid(6),
      title: "New epic",
      startQuarter: from,
      endQuarter: to,
      progress: 0,
      color: COLORS[epics.length % COLORS.length],
    };
    setEpics((s) => [...s, epic]);
    log(EPIC_ROADMAP_ACTIONS.EPIC_ADDED, {
      epicId: epic.id,
      title: epic.title,
    });
  };
  const update = (id: string, patch: Partial<Epic>) => {
    setEpics((s) => s.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const logUpdate = (id: string, fields: string[]) => {
    log(EPIC_ROADMAP_ACTIONS.EPIC_UPDATED, {
      epicId: id,
      fields,
    });
  };
  const remove = (id: string) => {
    const epic = epics.find((e) => e.id === id);
    setEpics((s) => s.filter((e) => e.id !== id));
    log(EPIC_ROADMAP_ACTIONS.EPIC_REMOVED, { epicId: id, title: epic?.title });
  };

  const columns = useMemo(() => quartersBetween(from, to), [from, to]);
  // BUG-T3-epic-roadmap-1: detect span truncation so we can surface a
  // notice. The user requested `to - from + 1` quarters but we capped
  // at MAX_QUARTERS_SPAN; epics beyond the cap render with incorrect
  // bar positions otherwise.
  const requestedSpan = useMemo(() => {
    const a = quarterIndex(from);
    const b = quarterIndex(to);
    if (a === 0 || b === 0 || b < a) return 0;
    return b - a + 1;
  }, [from, to]);
  const truncatedSpan = requestedSpan > MAX_QUARTERS_SPAN;

  // BUG-T3-epic-roadmap-3: x-coord is now `e.startQuarter` index, not
  // insertion order, so the projection is at least time-anchored instead
  // of being a meaningless regression against the order epics were added.
  const progressSeries = useMemo(
    () =>
      epics
        .map((e) => ({ x: quarterIndex(e.startQuarter), y: e.progress }))
        .filter((p) => p.x > 0)
        .sort((a, b) => a.x - b.x),
    [epics]
  );
  // The horizon must be expressed on the SAME axis as the points, because
  // `forecastLinear` evaluates `slope * x + intercept` at each horizon
  // literally. `progressSeries.length` (2, 3, …) is an insertion count, but
  // x is now `quarterIndex` (year*4+q ≈ 8105 for 2026 Q1), so the line was
  // extrapolated ~8100 units outside its own domain: two epics at 70% and
  // 50% one quarter apart projected 81100%. Evaluate one quarter past the
  // last observed point instead, and clamp — progress is a percentage.
  const projectedNext = useMemo(() => {
    if (progressSeries.length < 2) return [];
    const nextX = progressSeries[progressSeries.length - 1].x + 1;
    return forecastLinear(progressSeries, [nextX]).map((p) => ({
      ...p,
      yHat: Math.min(100, Math.max(0, p.yHat)),
    }));
  }, [progressSeries]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Epic Roadmap",
      prompts: generateEpicRoadmapPrompts({ epics, columns }),
    }),
    [epics, columns]
  );

  // ── Cross-tool signals: recent sprint completions + OKR updates ─────────
  // Epic timelines depend on both sprint outcomes (capacity to deliver) and
  // OKR shifts (whether the epic still maps to current objectives). When
  // either has changed in the last 14 days, prompt the user to revisit the
  // roadmap and update progress / dates.
  const events = useHistoryStore((s) => s.events);
  // BUG-RD3-epic-roadmap-1: `selectEvents({ sinceDays: 14 })` calls
  // Date.now() internally. With deps=[events] only, a tab left open
  // past midnight kept reporting events as "recent" relative to the
  // last events-change timestamp. Add a per-hour ticker so the memo
  // re-evaluates the cutoff at least hourly (sufficient granularity
  // for "last 14 days").
  const [hourTick, setHourTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHourTick((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const recentSprintAdds = useMemo(
    () =>
      selectEvents({
        toolId: "velocity",
        action: "sprint_added",
        sinceDays: 14,
        limit: 50,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, hourTick]
  );
  const recentOkrUpdates = useMemo(
    () =>
      selectEvents({
        toolId: "okrs",
        action: "progress_updated",
        sinceDays: 14,
        limit: 50,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, hourTick]
  );

  return (
    <ToolPageWrapper
      toolId="epic-roadmap"
      title="Epic Roadmap"
      description="Timeline view of epics across quarters with progress tracking and completion forecasting."
      category="Portfolio & Scaling"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="epic-roadmap"
          csvData={{
            headers: ["Epic", "Description", "Start Q", "End Q", "Progress", "Owner"],
            rows: epics.map((e) => [
              e.title,
              e.description ?? "",
              e.startQuarter,
              e.endQuarter,
              `${e.progress}%`,
              e.owner ?? "",
            ]),
          }}
          jsonData={epics}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Epic
        </Button>
      </ActionRow>

      {(recentSprintAdds.length > 0 || recentOkrUpdates.length > 0) && (
        <CalloutAlert tone="info" className="mb-3">
          {recentSprintAdds.length} sprint{recentSprintAdds.length === 1 ? "" : "s"} added,{" "}
          {recentOkrUpdates.length} OKR update{recentOkrUpdates.length === 1 ? "" : "s"} in last 14
          days &mdash; review epic timelines.
        </CalloutAlert>
      )}

      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="er-view-from" className="block text-xs text-sub">
              View from
            </label>
            <Input
              id="er-view-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-bg border-border font-data w-32"
            />
          </div>
          <div>
            <label htmlFor="er-view-to" className="block text-xs text-sub">
              <span className="sr-only">View </span>to
            </label>
            <Input
              id="er-view-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-bg border-border font-data w-32"
            />
          </div>
          {projectedNext[0] !== undefined && (
            <div className="ml-auto text-xs text-sub">
              Projected progress of next epic:{" "}
              <span className="text-accent font-data">
                {Math.max(0, Math.round(projectedNext[0].yHat))}%
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {columns.length === 0 ? (
        <EmptyState>Set a valid quarter range (e.g. 2026 Q1 → 2026 Q4).</EmptyState>
      ) : (
        <Card className="bg-surface border-border">
          {truncatedSpan && (
            <div className="px-4 pt-3 text-xs text-warning">
              Showing the first {MAX_QUARTERS_SPAN} quarters of {requestedSpan} requested. Narrow
              your “to” quarter to see every epic.
            </div>
          )}
          <CardContent className="p-4">
            <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
              <div
                className="grid gap-1 min-w-[600px]"
                style={{
                  gridTemplateColumns: `clamp(140px, 35vw, 260px) repeat(${columns.length}, minmax(80px, 1fr))`,
                }}
              >
                <div />
                {columns.map((c) => (
                  <div
                    key={c}
                    className="text-center text-xs font-data text-sub uppercase tracking-wider"
                  >
                    {c}
                  </div>
                ))}
                {epics.map((e) => {
                  const viewStartQ = quarterIndex(from);
                  const viewEndQ = quarterIndex(to);
                  const epicStartQ = quarterIndex(e.startQuarter);
                  const epicEndQ = quarterIndex(e.endQuarter);
                  const outOfView =
                    epicStartQ === 0 ||
                    epicEndQ === 0 ||
                    epicEndQ < viewStartQ ||
                    epicStartQ > viewEndQ;
                  const start = Math.max(0, epicStartQ - viewStartQ);
                  const end = Math.min(columns.length - 1, epicEndQ - viewStartQ);
                  const span = Math.max(1, end - start + 1);
                  return (
                    <div key={e.id} style={{ display: "contents" }}>
                      <EpicRowEditor
                        epic={e}
                        update={update}
                        logUpdate={logUpdate}
                        remove={remove}
                      />
                      {columns.map((_, idx) => {
                        if (outOfView || idx < start || idx > end) return <div key={idx} />;
                        const isStart = idx === start;
                        const isEnd = idx === end;
                        const cellStartPct = (idx - start) / span;
                        const cellEndPct = (idx - start + 1) / span;
                        const prog = e.progress / 100;
                        let cellFillPct = 0;
                        if (prog >= cellEndPct) cellFillPct = 100;
                        else if (prog > cellStartPct) {
                          cellFillPct = ((prog - cellStartPct) / (cellEndPct - cellStartPct)) * 100;
                        }
                        const color = safeColor(e.color);
                        return (
                          <div key={idx} className="py-3">
                            <div
                              className="h-4 relative overflow-hidden"
                              style={{
                                background: `${color}22`,
                                borderLeft: isStart ? `3px solid ${color}` : undefined,
                                borderRight: isEnd ? `3px solid ${color}` : undefined,
                                borderTopLeftRadius: isStart ? 4 : 0,
                                borderBottomLeftRadius: isStart ? 4 : 0,
                                borderTopRightRadius: isEnd ? 4 : 0,
                                borderBottomRightRadius: isEnd ? 4 : 0,
                              }}
                            >
                              <div
                                className="h-full absolute left-0 top-0"
                                style={{
                                  background: color,
                                  width: `${cellFillPct}%`,
                                  opacity: 0.45,
                                }}
                              />
                              {idx === Math.floor((start + end) / 2) && (
                                <div
                                  className="absolute inset-0 flex items-center justify-center text-xs font-data"
                                  style={{ color }}
                                >
                                  {e.progress}%
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {epics.length === 0 && (
                  <div
                    className="col-span-full text-center py-8 text-sub"
                    style={{ gridColumn: `1 / span ${columns.length + 1}` }}
                  >
                    <Milestone className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    Add epics to populate the roadmap.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </ToolPageWrapper>
  );
}
