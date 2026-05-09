"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Milestone, Plus, Trash2 } from "lucide-react";
import { forecastLinear } from "@/lib/analytics/forecasting";
import { generateEpicRoadmapPrompts } from "@/lib/ai-prompts/epic-roadmap";
import { usePersisted } from "@/lib/utils/use-persisted";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { EPIC_ROADMAP_ACTIONS } from "@/lib/history/event-actions";

interface Epic {
  id: string;
  title: string;
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
  const qNum = parseInt(m[2], 10); // 1..4
  return year * 4 + qNum; // sentinel-safe: year*4+1..+4
}

function quartersBetween(from: string, to: string): string[] {
  const start = quarterIndex(from);
  const end = quarterIndex(to);
  if (start === 0 || end === 0 || end < start) return [];
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    // Subtract 1 before the divmod so q=4 stays in its own year. e.g.
    // i=8108 (2026 Q4) → (i-1)=8107 → year=2026, q=(8107%4)+1=4.
    const zero = i - 1;
    const year = Math.floor(zero / 4);
    const q = (zero % 4) + 1;
    out.push(`${year} Q${q}`);
  }
  return out;
}

export function EpicRoadmapClient() {
  const [epics, setEpics] = usePersisted<Epic[]>("agile-toolkit:epic-roadmap", []);
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
    log(EPIC_ROADMAP_ACTIONS.EPIC_ADDED, { epicId: epic.id });
  };
  const update = (id: string, patch: Partial<Epic>) => {
    setEpics((s) => s.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    log(EPIC_ROADMAP_ACTIONS.EPIC_UPDATED, {
      epicId: id,
      fields: Object.keys(patch),
    });
  };
  const remove = (id: string) => {
    const epic = epics.find((e) => e.id === id);
    setEpics((s) => s.filter((e) => e.id !== id));
    log(EPIC_ROADMAP_ACTIONS.EPIC_REMOVED, { epicId: id, title: epic?.title });
  };

  const columns = useMemo(() => quartersBetween(from, to), [from, to]);

  const progressSeries = epics.map((e, idx) => ({ x: idx, y: e.progress }));
  const projectedNext = progressSeries.length >= 2 ? forecastLinear(progressSeries, [progressSeries.length]) : [];

  const promptConfig = useMemo(
    () => ({
      toolName: "Epic Roadmap",
      prompts: generateEpicRoadmapPrompts({ epics, columns }),
    }),
    [epics, columns]
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
            headers: ["Epic", "Start Q", "End Q", "Progress", "Owner"],
            rows: epics.map((e) => [e.title, e.startQuarter, e.endQuarter, `${e.progress}%`, e.owner ?? ""]),
          }}
          jsonData={epics}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Epic
        </Button>
      </ActionRow>

      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div>
            <div className="text-xs text-sub">View from</div>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} className="bg-bg border-border font-data w-32" />
          </div>
          <div>
            <div className="text-xs text-sub">to</div>
            <Input value={to} onChange={(e) => setTo(e.target.value)} className="bg-bg border-border font-data w-32" />
          </div>
          {projectedNext[0] !== undefined && (
            <div className="ml-auto text-xs text-sub">
              Projected progress of next epic:{" "}
              <span className="text-accent font-data">{Math.max(0, Math.round(projectedNext[0].yHat))}%</span>
            </div>
          )}
        </CardContent>
      </Card>

      {columns.length === 0 ? (
        <EmptyState>Set a valid quarter range (e.g. 2026 Q1 → 2026 Q4).</EmptyState>
      ) : (
        <Card className="bg-surface border-border">
          <CardContent className="p-4 overflow-x-auto">
            <div
              className="grid gap-1 min-w-[600px]"
              style={{ gridTemplateColumns: `260px repeat(${columns.length}, minmax(80px, 1fr))` }}
            >
              <div />
              {columns.map((c) => (
                <div key={c} className="text-center text-xs font-data text-sub uppercase tracking-wider">
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
                    <div className="py-2 pr-2 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: e.color ?? "#00f0ff" }} />
                      <Input
                        value={e.title}
                        onChange={(ev) => update(e.id, { title: ev.target.value })}
                        className="bg-bg border-border text-sm h-7 flex-1"
                      />
                      <Input
                        type="number"
                        value={e.progress}
                        onChange={(ev) => update(e.id, { progress: Math.max(0, Math.min(100, Number(ev.target.value))) })}
                        className="bg-bg border-border font-data h-7 w-14"
                      />
                      <Button variant="ghost" size="sm" onClick={() => remove(e.id)} className="h-7 text-sub hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
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
                      return (
                        <div key={idx} className="py-3">
                          <div
                            className="h-4 relative overflow-hidden"
                            style={{
                              background: `${e.color ?? "#00f0ff"}22`,
                              borderLeft: isStart ? `3px solid ${e.color ?? "#00f0ff"}` : undefined,
                              borderRight: isEnd ? `3px solid ${e.color ?? "#00f0ff"}` : undefined,
                              borderTopLeftRadius: isStart ? 4 : 0,
                              borderBottomLeftRadius: isStart ? 4 : 0,
                              borderTopRightRadius: isEnd ? 4 : 0,
                              borderBottomRightRadius: isEnd ? 4 : 0,
                            }}
                          >
                            <div
                              className="h-full absolute left-0 top-0"
                              style={{
                                background: e.color ?? "#00f0ff",
                                width: `${cellFillPct}%`,
                                opacity: 0.45,
                              }}
                            />
                            {idx === Math.floor((start + end) / 2) && (
                              <div
                                className="absolute inset-0 flex items-center justify-center text-[10px] font-data"
                                style={{ color: e.color ?? "#00f0ff" }}
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
          </CardContent>
        </Card>
      )}
    </ToolPageWrapper>
  );
}
