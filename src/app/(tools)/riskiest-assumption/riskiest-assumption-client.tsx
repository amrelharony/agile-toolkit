"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AlertCircle,
  FlaskConical,
  CheckCircle2,
  XCircle,
  X,
  ShieldAlert,
} from "lucide-react";
import { generateRiskiestAssumptionPrompts } from "@/lib/ai-prompts/riskiest-assumption";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RISKIEST_ASSUMPTION_ACTIONS } from "@/lib/history/event-actions";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type Level = 1 | 2 | 3 | 4 | 5;
type Status = "untested" | "testing" | "validated" | "invalidated";

interface Assumption {
  id: string;
  statement: string;
  riskLevel: Level;
  evidenceLevel: Level;
  testIdea?: string;
  status: Status;
  description?: string;
}

interface State {
  assumptions: Assumption[];
}

const DEFAULT_STATE: State = { assumptions: [] };

const RA_ID = "riskiestAssumption:current"; // MUST match RA_ID in riskiest-assumption.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// writes round-trip into the UI. Drop-in [state, setState] (structural types).
function useRiskiestAssumption(): [State, (u: State | ((p: State) => State)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.riskiestAssumptions ?? []).find((d) => d.id === RA_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertRiskiestAssumption);
  const state: State = doc ? { assumptions: doc.assumptions } : DEFAULT_STATE;
  const setState = (u: State | ((p: State) => State)) => {
    const cur = (useWorkspaceStore.getState().riskiestAssumptions ?? []).find(
      (d) => d.id === RA_ID
    );
    const curState: State = cur ? { assumptions: cur.assumptions } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: RA_ID, assumptions: next.assumptions });
  };
  return [state, setState];
}

const STATUS_OPTS: { id: Status; label: string; tone: string }[] = [
  { id: "untested", label: "Untested", tone: "border-border bg-surface text-sub" },
  { id: "testing", label: "Testing", tone: "border-warning/40 bg-warning/10 text-warning" },
  {
    id: "validated",
    label: "Validated",
    tone: "border-success/40 bg-success/10 text-success",
  },
  { id: "invalidated", label: "Invalidated", tone: "border-danger/40 bg-danger/10 text-danger" },
];
const STATUS_TONE: Record<Status, string> = STATUS_OPTS.reduce(
  (a, x) => {
    a[x.id] = x.tone;
    return a;
  },
  {} as Record<Status, string>
);

function newId(): string {
  return crypto.randomUUID();
}

function clampLevel(n: number): Level {
  const v = Math.min(5, Math.max(1, Math.round(n)));
  return v as Level;
}

/** Typed level → 1-5, or `fallback` when blank/invalid (Number("") is 0, not "blank"). */
function parseLevel(raw: string, fallback: Level): Level {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? clampLevel(n) : fallback;
}

function score(a: Assumption): number {
  return a.riskLevel * (6 - a.evidenceLevel);
}

interface NumDraftInputProps {
  value: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}

/**
 * Numeric input that keeps a string draft so partial typing ("", "1") doesn't
 * hammer state with NaN/clamped values. Commits clamped 1-5 on blur.
 */
function NumDraftInput({ value, onCommit, ariaLabel }: NumDraftInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <Input
      type="number"
      min={1}
      max={5}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        // Blank/invalid reverts to the saved level; an unchanged value isn't re-committed.
        const next = parseLevel(draft, value as Level);
        if (next !== value) onCommit(next);
        setDraft(String(next));
      }}
      className="h-8 w-14 bg-bg border-border text-xs font-data"
      aria-label={ariaLabel}
    />
  );
}

export function RiskiestAssumptionClient() {
  const [state, setState] = useRiskiestAssumption();
  const [draft, setDraft] = useState({
    statement: "",
    riskLevel: "3",
    evidenceLevel: "3",
    testIdea: "",
    description: "",
  });
  // The card tracks an assumption by id and reads it from live state, so it
  // reflects later edits and disappears when the assumption is deleted.
  const [testCardId, setTestCardId] = useState<string | null>(null);
  const testCard = testCardId ? (state.assumptions.find((a) => a.id === testCardId) ?? null) : null;
  const testCardRef = useRef<HTMLDivElement>(null);
  const { log } = useHistoryLogger("riskiest-assumption");

  // Scroll the test card into view when the active assumption changes.
  // Lives below the ranked list, so it's easy to miss off-screen.
  useEffect(() => {
    if (!testCardId) return;
    testCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [testCardId]);

  const addAssumption = () => {
    const statement = draft.statement.trim();
    if (!statement) return;
    const riskLevel = parseLevel(draft.riskLevel, 3);
    const evidenceLevel = parseLevel(draft.evidenceLevel, 3);
    const testIdea = draft.testIdea.trim() || undefined;
    const description = draft.description.trim() || undefined;
    const a: Assumption = {
      id: newId(),
      statement,
      riskLevel,
      evidenceLevel,
      testIdea,
      status: "untested",
      description,
    };
    setState((s) => ({ assumptions: [...s.assumptions, a] }));
    log(RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_ADDED, {
      assumptionId: a.id,
      statement: a.statement,
      riskLevel: a.riskLevel,
      evidenceLevel: a.evidenceLevel,
      description,
      testIdea,
    });
    setDraft({
      statement: "",
      riskLevel: "3",
      evidenceLevel: "3",
      testIdea: "",
      description: "",
    });
  };

  const removeAssumption = (id: string) => {
    const a = state.assumptions.find((x) => x.id === id);
    setState((s) => ({
      assumptions: s.assumptions.filter((x) => x.id !== id),
    }));
    if (testCardId === id) setTestCardId(null);
    log(RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_REMOVED, {
      assumptionId: id,
      statement: a?.statement,
    });
  };

  const updateRisk = (id: string, riskLevel: Level) => {
    setState((s) => ({
      assumptions: s.assumptions.map((x) => (x.id === id ? { ...x, riskLevel } : x)),
    }));
    log(RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_UPDATED, {
      assumptionId: id,
      riskLevel,
    });
  };

  const updateEvidence = (id: string, evidenceLevel: Level) => {
    setState((s) => ({
      assumptions: s.assumptions.map((x) => (x.id === id ? { ...x, evidenceLevel } : x)),
    }));
    log(RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_UPDATED, {
      assumptionId: id,
      evidenceLevel,
    });
  };

  const updateStatus = (id: string, status: Status) => {
    setState((s) => ({
      assumptions: s.assumptions.map((x) => (x.id === id ? { ...x, status } : x)),
    }));
    log(RISKIEST_ASSUMPTION_ACTIONS.ASSUMPTION_UPDATED, {
      assumptionId: id,
      status,
    });
  };

  const generateTestCard = (a: Assumption) => {
    setTestCardId(a.id);
    log(RISKIEST_ASSUMPTION_ACTIONS.TEST_GENERATED, {
      assumptionId: a.id,
      statement: a.statement,
      riskLevel: a.riskLevel,
      evidenceLevel: a.evidenceLevel,
    });
  };

  const ranked = useMemo(
    () => [...state.assumptions].sort((a, b) => score(b) - score(a)),
    [state.assumptions]
  );

  // Quadrant matrix: x = evidenceLevel (1-5), y = riskLevel (1-5).
  // Quadrant "Test First" = high risk + low evidence (top-left).
  const quadrants = useMemo(() => {
    const tl: Assumption[] = [];
    const tr: Assumption[] = [];
    const bl: Assumption[] = [];
    const br: Assumption[] = [];
    for (const a of state.assumptions) {
      if (a.riskLevel >= 3 && a.evidenceLevel <= 3) tl.push(a);
      else if (a.riskLevel >= 3 && a.evidenceLevel > 3) tr.push(a);
      else if (a.riskLevel < 3 && a.evidenceLevel <= 3) bl.push(a);
      else br.push(a);
    }
    return { tl, tr, bl, br };
  }, [state.assumptions]);

  const stats = useMemo(() => {
    const untestedHigh = state.assumptions.filter(
      (a) => a.status === "untested" && a.riskLevel >= 4
    ).length;
    const validated = state.assumptions.filter((a) => a.status === "validated").length;
    const invalidated = state.assumptions.filter((a) => a.status === "invalidated").length;
    return {
      total: state.assumptions.length,
      untestedHigh,
      validated,
      invalidated,
    };
  }, [state.assumptions]);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Riskiest Assumption Canvas",
      prompts: generateRiskiestAssumptionPrompts(
        {
          assumptions: state.assumptions,
        },
        workspace
      ),
    }),
    [state.assumptions, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="riskiest-assumption"
      title="Riskiest Assumption Canvas"
      description="List the assumptions behind your bet, rate each on risk (1-5) and evidence (1-5), and surface the riskiest + least-evidenced first."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="riskiest-assumption"
          csvData={{
            headers: [
              "Statement",
              "Risk",
              "Evidence",
              "Score",
              "Status",
              "Test Idea",
              "Description",
            ],
            rows: ranked.map((a) => [
              a.statement,
              a.riskLevel,
              a.evidenceLevel,
              score(a),
              a.status,
              a.testIdea ?? "",
              a.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={AlertCircle}
          label="Total"
          value={stats.total}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={ShieldAlert}
          label="Untested + risky"
          value={stats.untestedHigh}
          hint="risk ≥ 4"
          tone={stats.untestedHigh > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Validated"
          value={stats.validated}
          tone={stats.validated > 0 ? "success" : "default"}
        />
        <StatCard variant="compact" icon={XCircle} label="Invalidated" value={stats.invalidated} />
      </KpiGrid>

      {/* Add form */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-text">Add assumption</div>
          <Textarea
            value={draft.statement}
            onChange={(e) => setDraft((d) => ({ ...d, statement: e.target.value }))}
            placeholder='Statement (e.g. "Users will pay $20/mo for the premium tier")'
            rows={2}
            className="bg-bg border-border resize-none text-sm"
            aria-label="Assumption statement"
          />
          <div className="grid grid-cols-1 md:grid-cols-[140px_140px_1fr] gap-2 items-start">
            <div className="flex items-center gap-2">
              <span className="text-xs text-sub">Risk</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={draft.riskLevel}
                onChange={(e) => setDraft((d) => ({ ...d, riskLevel: e.target.value }))}
                onBlur={(e) => {
                  const v = parseLevel(e.target.value, 3);
                  setDraft((d) => ({ ...d, riskLevel: String(v) }));
                }}
                className="h-9 bg-bg border-border font-data"
                aria-label="Risk level (1-5)"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-sub">Evidence</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={draft.evidenceLevel}
                onChange={(e) => setDraft((d) => ({ ...d, evidenceLevel: e.target.value }))}
                onBlur={(e) => {
                  const v = parseLevel(e.target.value, 3);
                  setDraft((d) => ({ ...d, evidenceLevel: String(v) }));
                }}
                className="h-9 bg-bg border-border font-data"
                aria-label="Evidence level (1-5)"
              />
            </div>
            <Textarea
              value={draft.testIdea}
              onChange={(e) => setDraft((d) => ({ ...d, testIdea: e.target.value }))}
              placeholder="Test idea (optional)..."
              rows={2}
              className="bg-bg border-border resize-none text-xs"
              aria-label="Test idea"
            />
          </div>
          <Textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="Description (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="Description"
          />
          <Button
            onClick={addAssumption}
            disabled={!draft.statement.trim()}
            className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add assumption
          </Button>
        </CardContent>
      </Card>

      {/* Matrix view */}
      {state.assumptions.length > 0 && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-sub font-semibold mb-3">
              Risk × Evidence matrix
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 min-h-[100px] min-w-0">
                <div className="text-xs uppercase tracking-wider text-danger font-bold mb-2">
                  Test first · high risk · low evidence
                </div>
                <ul className="space-y-1 text-xs text-text">
                  {quadrants.tl.length === 0 ? (
                    <li className="text-sub italic">empty</li>
                  ) : (
                    quadrants.tl.map((a) => (
                      <li key={a.id} className="break-words">
                        · {a.statement.slice(0, 80)}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 min-h-[100px] min-w-0">
                <div className="text-xs uppercase tracking-wider text-warning font-bold mb-2">
                  Monitor · high risk · high evidence
                </div>
                <ul className="space-y-1 text-xs text-text">
                  {quadrants.tr.length === 0 ? (
                    <li className="text-sub italic">empty</li>
                  ) : (
                    quadrants.tr.map((a) => (
                      <li key={a.id} className="break-words">
                        · {a.statement.slice(0, 80)}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="rounded-lg border border-border bg-bg p-3 min-h-[100px] min-w-0">
                <div className="text-xs uppercase tracking-wider text-sub font-bold mb-2">
                  Defer · low risk · low evidence
                </div>
                <ul className="space-y-1 text-xs text-text">
                  {quadrants.bl.length === 0 ? (
                    <li className="text-sub italic">empty</li>
                  ) : (
                    quadrants.bl.map((a) => (
                      <li key={a.id} className="break-words">
                        · {a.statement.slice(0, 80)}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="rounded-lg border border-success/40 bg-success/5 p-3 min-h-[100px] min-w-0">
                <div className="text-xs uppercase tracking-wider text-success font-bold mb-2">
                  Solid · low risk · high evidence
                </div>
                <ul className="space-y-1 text-xs text-text">
                  {quadrants.br.length === 0 ? (
                    <li className="text-sub italic">empty</li>
                  ) : (
                    quadrants.br.map((a) => (
                      <li key={a.id} className="break-words">
                        · {a.statement.slice(0, 80)}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ranked list */}
      <div className="space-y-2">
        {ranked.map((a, idx) => (
          <Card
            key={a.id}
            className={`bg-surface border-border ${
              idx === 0 && state.assumptions.length > 1 ? "border-l-2 border-l-accent" : ""
            }`}
          >
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Badge
                  variant="outline"
                  className="text-xs bg-bg border-border text-sub font-data shrink-0"
                >
                  #{idx + 1} · score {score(a)}
                </Badge>
                <div className="flex-1 text-sm text-text break-words">{a.statement}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAssumption(a.id)}
                  className="text-sub hover:text-danger h-6 w-6 p-0 shrink-0 min-touch-coarse"
                  aria-label={`Remove assumption #${idx + 1}`}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              </div>
              {a.description && (
                <div className="text-xs text-sub whitespace-pre-wrap">{a.description}</div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs uppercase tracking-wider text-sub">risk</span>
                  <NumDraftInput
                    value={a.riskLevel}
                    onCommit={(n) => updateRisk(a.id, n as Level)}
                    ariaLabel={`Risk for assumption #${idx + 1}`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs uppercase tracking-wider text-sub">evidence</span>
                  <NumDraftInput
                    value={a.evidenceLevel}
                    onCommit={(n) => updateEvidence(a.id, n as Level)}
                    ariaLabel={`Evidence for assumption #${idx + 1}`}
                  />
                </div>
                <Select value={a.status} onValueChange={(v) => updateStatus(a.id, v as Status)}>
                  <SelectTrigger
                    className={`h-8 text-xs w-32 border ${STATUS_TONE[a.status]}`}
                    aria-label={`Status for assumption #${idx + 1}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => generateTestCard(a)}
                  className="gap-1.5 text-xs border-border hover:border-accent/40 hover:bg-accent/5"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  Generate test card
                </Button>
              </div>
              {a.testIdea && (
                <div className="text-xs text-sub border-t border-border pt-2">
                  <span className="font-semibold text-text">Test idea:</span> {a.testIdea}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Test card panel */}
      {testCard && (
        <Card ref={testCardRef} className="bg-surface border-accent/40 mt-6">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <FlaskConical className="w-4 h-4 text-accent" />
                Test Card
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTestCardId(null)}
                className="h-6 w-6 p-0 text-sub hover:text-text min-touch-coarse"
                aria-label="Close test card"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-sub uppercase tracking-wider text-xs mb-1">Assumption</div>
                <div className="text-text">{testCard.statement}</div>
              </div>
              <div>
                <div className="text-sub uppercase tracking-wider text-xs mb-1">Score</div>
                <div className="text-text font-data">
                  risk {testCard.riskLevel} · evidence {testCard.evidenceLevel} · score{" "}
                  {score(testCard)}
                </div>
              </div>
              <div>
                <div className="text-sub uppercase tracking-wider text-xs mb-1">Test</div>
                <div className="text-text">
                  {testCard.testIdea ??
                    "(no test idea — write the cheapest experiment that produces a binary outcome)"}
                </div>
              </div>
              <div>
                <div className="text-sub uppercase tracking-wider text-xs mb-1">
                  Metric & threshold
                </div>
                <div className="text-text italic">
                  Define a single metric and the threshold that would invalidate this assumption.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </ToolPageWrapper>
  );
}
