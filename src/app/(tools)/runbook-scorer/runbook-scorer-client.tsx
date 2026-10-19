"use client";

import { useEffect, useId, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  BookOpen,
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpDown,
  ShieldCheck,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Runbook, ScoreValue, RunbookScorer } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RUNBOOK_SCORER_ACTIONS } from "@/lib/history/event-actions";
import { generateRunbookScorerPrompts } from "@/lib/ai-prompts/runbook-scorer";
import { mannKendall } from "@/lib/analytics/trend-test";

interface RunbookState {
  runbooks: Runbook[];
}

const DEFAULT_STATE: RunbookState = { runbooks: [] };

const RS_ID = "runbookScorer:current"; // MUST match RS_ID in runbook-scorer.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// runbook writes round-trip into the UI. Drop-in [state, setState].
function useRunbookScorer(): [
  RunbookState,
  (u: RunbookState | ((p: RunbookState) => RunbookState)) => void,
] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.runbookScorers ?? []).find((d) => d.id === RS_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertRunbookScorer);
  const state: RunbookState = doc ? { runbooks: doc.runbooks } : DEFAULT_STATE;
  const setState = (u: RunbookState | ((p: RunbookState) => RunbookState)) => {
    const cur = (useWorkspaceStore.getState().runbookScorers ?? []).find(
      (d: RunbookScorer) => d.id === RS_ID
    );
    const curState: RunbookState = cur ? { runbooks: cur.runbooks } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: RS_ID, runbooks: next.runbooks });
  };
  return [state, setState];
}

type SortKey = "hygiene" | "name" | "freshness";
type SortDir = "asc" | "desc";

function clampScore(v: number): ScoreValue {
  const n = Math.round(v);
  if (n <= 1) return 1;
  if (n >= 5) return 5;
  return n as ScoreValue;
}

function hygieneScore(r: Runbook): number {
  return (r.freshness + r.completeness + (r.testedRecently ? 5 : 1)) / 3;
}

function hygieneTone(value: number): "default" | "warning" | "danger" | "success" {
  if (value >= 4) return "success";
  if (value >= 3) return "default";
  if (value >= 2) return "warning";
  return "danger";
}

interface RunbookDraft {
  name: string;
  owner: string;
  description: string;
}

function emptyDraft(): RunbookDraft {
  return { name: "", owner: "", description: "" };
}

export function RunbookScorerClient() {
  const [state, setState] = useRunbookScorer();
  const { log } = useHistoryLogger("runbook-scorer");
  const [draft, setDraft] = useState<RunbookDraft>(emptyDraft);
  const [sortKey, setSortKey] = useState<SortKey>("hygiene");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const addRunbook = () => {
    const name = draft.name.trim();
    if (!name) return;
    const description = draft.description.trim() || undefined;
    const runbook: Runbook = {
      id: crypto.randomUUID(),
      name,
      owner: draft.owner.trim() || undefined,
      freshness: 3,
      completeness: 3,
      testedRecently: false,
      description,
    };
    setState((s) => ({ runbooks: [runbook, ...s.runbooks] }));
    log(RUNBOOK_SCORER_ACTIONS.RUNBOOK_ADDED, {
      runbookId: runbook.id,
      name: runbook.name,
      owner: runbook.owner,
      description,
    });
    setDraft(emptyDraft());
  };

  const removeRunbook = (id: string) => {
    const r = state.runbooks.find((x) => x.id === id);
    setState((s) => ({ runbooks: s.runbooks.filter((x) => x.id !== id) }));
    log(RUNBOOK_SCORER_ACTIONS.RUNBOOK_REMOVED, {
      runbookId: id,
      name: r?.name,
    });
  };

  const updateRunbook = (id: string, patch: Partial<Runbook>) => {
    setState((s) => ({
      runbooks: s.runbooks.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    log(RUNBOOK_SCORER_ACTIONS.RUNBOOK_SCORED, {
      runbookId: id,
      fields: Object.keys(patch),
    });
  };

  const totalRunbooks = state.runbooks.length;

  const avgHygiene = useMemo(() => {
    if (totalRunbooks === 0) return 0;
    return state.runbooks.reduce((acc, r) => acc + hygieneScore(r), 0) / totalRunbooks;
  }, [state.runbooks, totalRunbooks]);

  const staleCount = useMemo(
    () => state.runbooks.filter((r) => r.freshness < 3).length,
    [state.runbooks]
  );
  const untestedCount = useMemo(
    () => state.runbooks.filter((r) => !r.testedRecently).length,
    [state.runbooks]
  );

  // Hygiene-over-time series — derived from runbooks ordered by their
  // `lastReviewedAt` timestamp. Treats each review as a sample and reports
  // a Mann-Kendall trend chip so the team can see whether reviews have been
  // raising or eroding hygiene. Returns null until 5 reviewed runbooks exist.
  const hygieneTrend = useMemo(() => {
    const reviewed = state.runbooks.filter((r) => r.lastReviewedAt);
    if (reviewed.length < 5) return null;
    const ordered = [...reviewed].sort((a, b) =>
      (a.lastReviewedAt ?? "").localeCompare(b.lastReviewedAt ?? "")
    );
    return {
      mk: mannKendall(ordered.map((r) => hygieneScore(r))),
      sampleSize: ordered.length,
    };
  }, [state.runbooks]);

  const sorted = useMemo(() => {
    const list = state.runbooks.map((r) => ({
      runbook: r,
      hygiene: hygieneScore(r),
    }));
    list.sort((a, b) => {
      let diff = 0;
      if (sortKey === "name") diff = a.runbook.name.localeCompare(b.runbook.name);
      else if (sortKey === "freshness") diff = a.runbook.freshness - b.runbook.freshness;
      else diff = a.hygiene - b.hygiene;
      return sortDir === "asc" ? diff : -diff;
    });
    return list;
  }, [state.runbooks, sortKey, sortDir]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Runbook Maturity Scorer",
      prompts: generateRunbookScorerPrompts({
        runbooks: state.runbooks.map((r) => ({
          name: r.name,
          owner: r.owner,
          freshness: r.freshness,
          completeness: r.completeness,
          testedRecently: r.testedRecently,
          hygiene: hygieneScore(r),
          lastReviewedAt: r.lastReviewedAt,
          description: r.description,
        })),
        avgHygiene,
        staleCount,
        untestedCount,
      }),
    }),
    [state.runbooks, avgHygiene, staleCount, untestedCount]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  // Exposes the active sort on its column header.
  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined;

  return (
    <ToolPageWrapper
      toolId="runbook-scorer"
      title="Runbook Maturity Scorer"
      description="Score each runbook on freshness, completeness, and tested-recently to surface a team-wide hygiene index."
      category="Incidents & Reliability"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="runbook-scorer"
          csvData={{
            headers: [
              "Runbook",
              "Owner",
              "Freshness",
              "Completeness",
              "Tested recently",
              "Last reviewed",
              "Hygiene",
              "Description",
            ],
            rows: state.runbooks.map((r) => [
              r.name,
              r.owner ?? "",
              r.freshness,
              r.completeness,
              r.testedRecently ? "yes" : "no",
              r.lastReviewedAt ?? "",
              hygieneScore(r).toFixed(2),
              r.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard variant="compact" icon={BookOpen} label="Runbooks" value={totalRunbooks} />
        <StatCard
          variant="compact"
          icon={ShieldCheck}
          label="Avg hygiene"
          value={totalRunbooks === 0 ? "—" : avgHygiene.toFixed(2)}
          hint="of 5"
          tone={totalRunbooks === 0 ? "default" : hygieneTone(avgHygiene)}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Stale (freshness <3)"
          value={staleCount}
          tone={staleCount > 0 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Untested"
          value={untestedCount}
          tone={untestedCount > 0 ? "danger" : "default"}
        />
      </KpiGrid>

      {/* Mann-Kendall trend chip on hygiene-by-review-date. Surfaces only
          when statistically significant — otherwise we suppress the chip to
          avoid implying a trend from noisy data. */}
      {hygieneTrend?.mk.significant && (
        <div className="flex items-center justify-end mb-4 -mt-2">
          <Badge
            variant="outline"
            className={`font-mono text-xs tracking-wider uppercase ${
              hygieneTrend.mk.trend === "up"
                ? "border-success/40 text-success bg-success/10"
                : "border-warning/40 text-warning bg-warning/10"
            }`}
            title={`Mann-Kendall p=${hygieneTrend.mk.pValue.toFixed(3)} across ${hygieneTrend.sampleSize} reviewed runbooks`}
          >
            {hygieneTrend.mk.trend === "up" ? "↗" : "↘"} hygiene index trending
          </Badge>
        </div>
      )}

      <SectionCard title="Add a runbook" icon={Plus} titleSize="lg" className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Label htmlFor="rb-name" className="text-xs text-sub">
              Name
            </Label>
            <Input
              id="rb-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRunbook();
              }}
              placeholder="e.g. Checkout 5xx triage"
              className="bg-surface border-border"
            />
          </div>
          <div>
            <Label htmlFor="rb-owner" className="text-xs text-sub">
              Owner
            </Label>
            <Input
              id="rb-owner"
              value={draft.owner}
              onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))}
              placeholder="optional"
              className="bg-surface border-border"
            />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="rb-desc" className="text-xs text-sub">
              Description (optional)
            </Label>
            <Textarea
              id="rb-desc"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Notes about scope, owners, last drill…"
              rows={2}
              className="bg-surface border-border resize-none text-xs"
            />
          </div>
          <div className="sm:col-span-3">
            <Button
              onClick={addRunbook}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> Add runbook
            </Button>
          </div>
        </div>
      </SectionCard>

      {state.runbooks.length === 0 ? (
        <EmptyState icon={BookOpen}>
          No runbooks yet. Add one above to start scoring hygiene.
        </EmptyState>
      ) : (
        <SectionCard title="Runbooks" icon={BookOpen} titleSize="lg" className="mb-6">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-full md:min-w-[760px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3" aria-sort={ariaSort("name")}>
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="flex items-center gap-1 hover:text-text"
                      aria-label={`Sort by name (${sortKey === "name" ? sortDir : "asc"})`}
                    >
                      Name{" "}
                      {sortKey === "name" ? (
                        <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <ArrowDownAZ className="w-3 h-3 opacity-40" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3" aria-sort={ariaSort("freshness")}>
                    <button
                      type="button"
                      onClick={() => toggleSort("freshness")}
                      className="flex items-center gap-1 hover:text-text"
                      aria-label={`Sort by freshness (${sortKey === "freshness" ? sortDir : "asc"})`}
                    >
                      Freshness{" "}
                      <ArrowUpDown
                        className={`w-3 h-3 ${sortKey === "freshness" ? "" : "opacity-40"}`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th className="py-2 pr-3">Completeness</th>
                  <th className="py-2 pr-3">Tested</th>
                  <th className="py-2 pr-3">Last reviewed</th>
                  <th className="py-2 pr-3" aria-sort={ariaSort("hygiene")}>
                    <button
                      type="button"
                      onClick={() => toggleSort("hygiene")}
                      className="flex items-center gap-1 hover:text-text"
                      aria-label={`Sort by hygiene (${sortKey === "hygiene" ? sortDir : "asc"})`}
                    >
                      Hygiene{" "}
                      <ArrowUpDown
                        className={`w-3 h-3 ${sortKey === "hygiene" ? "" : "opacity-40"}`}
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th className="py-2 pr-3 w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ runbook: r, hygiene }) => (
                  <RunbookRow
                    key={r.id}
                    runbook={r}
                    hygiene={hygiene}
                    onUpdate={(patch) => updateRunbook(r.id, patch)}
                    onRemove={() => removeRunbook(r.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {state.runbooks.length > 0 && (
        <SectionCard title="Per-runbook detail" titleSize="lg">
          <div className="space-y-3">
            {sorted.map(({ runbook: r, hygiene }) => (
              <RunbookEditor
                key={`editor-${r.id}`}
                runbook={r}
                hygiene={hygiene}
                onUpdate={(patch) => updateRunbook(r.id, patch)}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}

function RunbookRow({
  runbook,
  hygiene,
  onUpdate,
  onRemove,
}: {
  runbook: Runbook;
  hygiene: number;
  onUpdate: (patch: Partial<Runbook>) => void;
  onRemove: () => void;
}) {
  const tone = hygieneTone(hygiene);
  const badgeClass =
    tone === "danger"
      ? "bg-danger/15 text-danger border-danger/40"
      : tone === "warning"
        ? "bg-warning/10 text-warning border-warning/30"
        : tone === "success"
          ? "bg-success/10 text-success border-success/30"
          : "bg-accent/10 text-accent border-accent/30";

  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-3 text-text">{runbook.name}</td>
      <td className="py-2 pr-3 text-sub">{runbook.owner ?? "—"}</td>
      <td className="py-2 pr-3 font-data">{runbook.freshness}</td>
      <td className="py-2 pr-3 font-data">{runbook.completeness}</td>
      <td className="py-2 pr-3">
        <Switch
          checked={runbook.testedRecently}
          onCheckedChange={(v) => onUpdate({ testedRecently: v })}
          aria-label={`Tested recently for ${runbook.name}`}
        />
      </td>
      <td className="py-2 pr-3 font-data text-sub">{runbook.lastReviewedAt ?? "—"}</td>
      <td className="py-2 pr-3">
        <Badge variant="outline" className={`${badgeClass} font-data`}>
          {hygiene.toFixed(2)}
        </Badge>
      </td>
      <td className="py-2 pr-3 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${runbook.name}`}
          className="h-7 w-7 p-0 text-sub hover:text-danger min-touch-coarse"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </td>
    </tr>
  );
}

function RunbookEditor({
  runbook,
  hygiene,
  onUpdate,
}: {
  runbook: Runbook;
  hygiene: number;
  onUpdate: (patch: Partial<Runbook>) => void;
}) {
  const uid = useId();
  const [descriptionDraft, setDescriptionDraft] = useState(runbook.description ?? "");
  const [reviewedDraft, setReviewedDraft] = useState(runbook.lastReviewedAt ?? "");
  useEffect(() => setDescriptionDraft(runbook.description ?? ""), [runbook.description]);
  useEffect(() => setReviewedDraft(runbook.lastReviewedAt ?? ""), [runbook.lastReviewedAt]);

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">{runbook.name}</div>
          {runbook.owner && <div className="text-xs text-sub">{runbook.owner}</div>}
        </div>
        <Badge
          variant="outline"
          className={`font-data ${
            hygiene >= 4
              ? "bg-success/10 text-success border-success/30"
              : hygiene >= 3
                ? "bg-accent/10 text-accent border-accent/30"
                : hygiene >= 2
                  ? "bg-warning/10 text-warning border-warning/30"
                  : "bg-danger/15 text-danger border-danger/40"
          }`}
        >
          Hygiene {hygiene.toFixed(2)}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-sub mb-1 block">
              Freshness ({runbook.freshness} / 5)
            </Label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[runbook.freshness]}
              onValueChange={(vals) => onUpdate({ freshness: clampScore(vals[0] ?? 3) })}
              aria-label={`Freshness for ${runbook.name}`}
            />
          </div>
          <div>
            <Label className="text-xs text-sub mb-1 block">
              Completeness ({runbook.completeness} / 5)
            </Label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[runbook.completeness]}
              onValueChange={(vals) => onUpdate({ completeness: clampScore(vals[0] ?? 3) })}
              aria-label={`Completeness for ${runbook.name}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={`${uid}-tested`}
              checked={runbook.testedRecently}
              onCheckedChange={(v) => onUpdate({ testedRecently: v })}
              aria-label={`Tested recently for ${runbook.name}`}
            />
            <Label htmlFor={`${uid}-tested`} className="text-xs text-sub">
              Tested recently
            </Label>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor={`${uid}-reviewed`} className="text-xs text-sub">
              Last reviewed
            </Label>
            <Input
              id={`${uid}-reviewed`}
              type="date"
              value={reviewedDraft}
              onChange={(e) => setReviewedDraft(e.target.value)}
              onBlur={() => {
                if (reviewedDraft !== (runbook.lastReviewedAt ?? "")) {
                  onUpdate({ lastReviewedAt: reviewedDraft || undefined });
                }
              }}
              className="bg-surface border-border font-data"
            />
          </div>
          <div>
            <Label htmlFor={`${uid}-description`} className="text-xs text-sub">
              Description (optional)
            </Label>
            <Textarea
              id={`${uid}-description`}
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={() => {
                const next = descriptionDraft.trim();
                if (next !== (runbook.description ?? "")) {
                  onUpdate({ description: next || undefined });
                }
              }}
              placeholder="Notes about scope, owners, last drill…"
              rows={3}
              className="bg-surface border-border resize-none text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
