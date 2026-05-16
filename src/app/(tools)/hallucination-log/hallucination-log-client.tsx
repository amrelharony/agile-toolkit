"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { AlertOctagon, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hallucination, Workspace } from "@/lib/stores/workspace-types";
import { generateHallucinationLogPrompts } from "@/lib/ai-prompts/hallucination-log";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HALLUCINATION_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const SEVERITIES: Hallucination["severity"][] = ["low", "medium", "high", "critical"];
const CAUSES: NonNullable<Hallucination["rootCause"]>[] = ["rag-miss", "prompt", "model", "context-window", "other"];
const SEVERITY_COLORS: Record<Hallucination["severity"], string> = {
  low: "#00ff88",
  medium: "#ffaa00",
  high: "#ff6b6b",
  critical: "#ff00aa",
};

export function HallucinationLogClient() {
  const list = useWorkspaceStore((s) => s.hallucinations ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertHallucination);
  const removeOne = useWorkspaceStore((s) => s.removeHallucination);
  const { log } = useHistoryLogger("hallucination-log");
  const exportRef = useRef<HTMLDivElement>(null);

  const [feature, setFeature] = useState("");
  const [input, setInput] = useState("");
  const [actual, setActual] = useState("");
  const [expected, setExpected] = useState("");
  const [severity, setSeverity] = useState<Hallucination["severity"]>("medium");
  const [rootCause, setRootCause] = useState<NonNullable<Hallucination["rootCause"]> | "">("");

  function add() {
    if (!input.trim() || !actual.trim()) return;
    // Cap free-text fields at 8000 chars apiece — that's already 32 KB just
    // for these three. Without the cap a single mega-paste could bloat
    // localStorage past the 5 MB origin quota and silently lose every other
    // tool's state on the next write.
    const MAX = 8000;
    const item: Hallucination = {
      id: crypto.randomUUID(),
      feature: feature.trim().slice(0, 200) || undefined,
      input: input.trim().slice(0, MAX),
      actual: actual.trim().slice(0, MAX),
      expected: expected.trim().slice(0, MAX) || undefined,
      severity,
      rootCause: rootCause || undefined,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(HALLUCINATION_ACTIONS.HALLUCINATION_LOGGED, { id: item.id, severity });
    emitSignal({ kind: "hallucination.logged", at: item.loggedAt, toolId: "hallucination-log", payload: item });
    setInput(""); setActual(""); setExpected(""); setFeature(""); setRootCause("");
  }

  function resolve(id: string) {
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const next: Hallucination = { ...item, resolvedAt: new Date().toISOString() };
    upsert(next);
    log(HALLUCINATION_ACTIONS.HALLUCINATION_RESOLVED, { id });
    emitSignal({ kind: "hallucination.resolved", at: next.resolvedAt!, toolId: "hallucination-log", payload: next });
  }

  function remove(id: string) {
    removeOne(id);
    log(HALLUCINATION_ACTIONS.HALLUCINATION_REMOVED, { id });
  }

  const open = useMemo(() => list.filter((x) => !x.resolvedAt), [list]);
  const resolved = list.length - open.length;

  const severityCounts = useMemo(() => {
    const counts: Record<Hallucination["severity"], number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const x of open) counts[x.severity]++;
    return SEVERITIES.map((s) => ({ severity: s, count: counts[s] }));
  }, [open]);

  const causeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const x of list) {
      const c = x.rootCause ?? "unknown";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts).map(([cause, count]) => ({ cause, count }));
  }, [list]);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    hallucinations: s.hallucinations, llmEvals: s.llmEvals, models: s.models,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Hallucination Log",
    prompts: generateHallucinationLogPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Date", "Feature", "Severity", "Root Cause", "Input", "Actual", "Expected", "Resolved"],
    rows: list.map((x) => [
      x.loggedAt.slice(0, 10), x.feature ?? "", x.severity, x.rootCause ?? "",
      x.input, x.actual, x.expected ?? "", x.resolvedAt ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="hallucination-log"
      title="Hallucination Log"
      description="Track AI quality incidents — input, expected, actual, severity, root cause, and resolution. Charts surface the loudest cause categories."
    >
      <div ref={exportRef} className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total" value={String(list.length)} />
          <KPI label="Open" value={String(open.length)} tone={open.length > 0 ? "danger" : "ok"} />
          <KPI label="Resolved" value={String(resolved)} tone="ok" />
          <KPI label="Critical open" value={String(open.filter((x) => x.severity === "critical").length)} tone="danger" />
        </div>

        <SectionCard title="Log new hallucination" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Feature (optional)" value={feature} onChange={(e) => setFeature(e.target.value)} />
            <Select value={severity} onValueChange={(v) => setSeverity(v as Hallucination["severity"])}>
              <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={rootCause || "unknown"} onValueChange={(v) => setRootCause(v === "unknown" ? "" : v as NonNullable<Hallucination["rootCause"]>)}>
              <SelectTrigger><SelectValue placeholder="Root cause" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Unknown</SelectItem>
                {CAUSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Input (what was sent to the model)" value={input} onChange={(e) => setInput(e.target.value)} className="mt-2" rows={2} />
          <Textarea placeholder="Actual response (the bad output)" value={actual} onChange={(e) => setActual(e.target.value)} className="mt-2" rows={2} />
          <Textarea placeholder="Expected (optional — what should have happened)" value={expected} onChange={(e) => setExpected(e.target.value)} className="mt-2" rows={2} />
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Log incident</Button>
        </SectionCard>

        {open.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Open by severity" icon={AlertOctagon}>
              <div className="-mx-2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={severityCounts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="severity" stroke="#888" fontSize={11} />
                    <YAxis stroke="#888" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                    <Bar dataKey="count" fill="#ff6b6b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
            <SectionCard title="By root cause" icon={AlertOctagon}>
              <div className="-mx-2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={causeCounts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="cause" stroke="#888" fontSize={11} />
                    <YAxis stroke="#888" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                    <Bar dataKey="count" fill="#9d4edd" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          </div>
        )}

        {list.length > 0 && (
          <SectionCard
            title={`Incidents (${list.length})`}
            icon={AlertOctagon}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="hallucination-log" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list]
                .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime())
                .map((x) => (
                  <li
                    key={x.id}
                    className={`rounded border p-3 text-sm ${x.resolvedAt ? "bg-emerald-500/5 border-emerald-500/30" : "bg-surface-deep border-border"}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded"
                          // Fallback to the medium colour when the persisted
                          // severity isn't in the known set — otherwise the
                          // template literal stringifies `undefined` into the
                          // CSS value, which the browser silently discards
                          // but linters and screen-readers see as broken.
                          style={{
                            backgroundColor: (SEVERITY_COLORS[x.severity] ?? "#ffaa00") + "20",
                            color: SEVERITY_COLORS[x.severity] ?? "#ffaa00",
                          }}
                        >
                          {x.severity}
                        </span>
                        {x.rootCause && <span className="text-xs text-sub">{x.rootCause}</span>}
                        {x.feature && <span className="text-xs text-text truncate">{x.feature}</span>}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {!x.resolvedAt && (
                          <button onClick={() => resolve(x.id)} className="text-emerald-400 hover:text-emerald-300" aria-label="Mark resolved">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => remove(x.id)} className="text-sub hover:text-red-400" aria-label="Remove">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    </div>
                    <p className="text-xs text-sub"><span className="text-text">In:</span> {x.input.slice(0, 200)}</p>
                    <p className="text-xs text-sub mt-1"><span className="text-text">Out:</span> {x.actual.slice(0, 200)}</p>
                    {x.expected && <p className="text-xs text-emerald-300 mt-1">Expected: {x.expected.slice(0, 200)}</p>}
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "danger" }) {
  const colorClass = tone === "danger" ? "text-red-400" : tone === "ok" ? "text-emerald-400" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
