"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  ArrowRight,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ADKAR_ACTIONS } from "@/lib/history/event-actions";
import { generateAdkarPrompts } from "@/lib/ai-prompts/adkar";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { chartTheme } from "@/components/charts/chart-theme";
import { cn } from "@/lib/utils";

type Stage =
  | "awareness"
  | "desire"
  | "knowledge"
  | "ability"
  | "reinforcement";

interface StageTransition {
  stage: Stage;
  enteredAt: string;
}

interface Initiative {
  id: string;
  name: string;
  currentStage: Stage;
  stagesCompleted: Stage[];
  // Stage-entry timeline drives the avg-days-per-stage stat. Each entry
  // is the date the initiative *entered* that stage — the next entry's
  // delta is the time spent in the prior stage.
  stageHistory: StageTransition[];
  owner?: string;
  startDate: string;
  description?: string;
}

const STAGES: Stage[] = [
  "awareness",
  "desire",
  "knowledge",
  "ability",
  "reinforcement",
];

const STAGE_LABEL: Record<Stage, string> = {
  awareness: "Awareness",
  desire: "Desire",
  knowledge: "Knowledge",
  ability: "Ability",
  reinforcement: "Reinforcement",
};

const STAGE_BLURB: Record<Stage, string> = {
  awareness:
    "People understand the need for change and the risks of doing nothing.",
  desire:
    "People are motivated to participate — incentives are aligned with the change.",
  knowledge:
    "People know how to change — training, processes, and tooling are available.",
  ability:
    "People can demonstrate the new behavior in real work, with support nearby.",
  reinforcement:
    "Mechanisms (rituals, metrics, rewards) sustain the change so it sticks.",
};

const STAGE_COLOR: Record<Stage, string> = {
  awareness: "#a78bfa",
  desire: "#60a5fa",
  knowledge: "#22d3ee",
  ability: "#34d399",
  reinforcement: "#fbbf24",
};

/** Parse YYYY-MM-DD as local date so day-deltas don't drift across timezones. */
function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function AdkarClient() {
  const [initiatives, setInitiatives] = usePersisted<Initiative[]>(
    "agile-toolkit:adkar",
    []
  );
  const { log } = useHistoryLogger("adkar");
  const workspace = useWorkspaceStore<Workspace>((s) => ({
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
  }));

  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [startDate, setStartDate] = useState(todayLocalISO());
  const [description, setDescription] = useState("");

  const addInitiative = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const init: Initiative = {
      id: crypto.randomUUID(),
      name: trimmed,
      currentStage: "awareness",
      stagesCompleted: [],
      stageHistory: [{ stage: "awareness", enteredAt: todayLocalISO() }],
      owner: owner.trim() || undefined,
      startDate: startDate || todayLocalISO(),
      description: description.trim() || undefined,
    };
    setInitiatives((prev) => [init, ...prev]);
    log(ADKAR_ACTIONS.INITIATIVE_ADDED, {
      initiativeId: init.id,
      name: init.name,
      owner: init.owner,
    });
    setName("");
    setOwner("");
    setStartDate(todayLocalISO());
    setDescription("");
  };

  const removeInitiative = (id: string) => {
    const init = initiatives.find((i) => i.id === id);
    setInitiatives((prev) => prev.filter((i) => i.id !== id));
    log(ADKAR_ACTIONS.INITIATIVE_REMOVED, {
      initiativeId: id,
      name: init?.name,
    });
  };

  const advanceStage = (id: string) => {
    // Compute the transition BEFORE calling setState so React StrictMode
    // (which may invoke updaters twice) doesn't cause double-logging or stale
    // closure issues.
    const target = initiatives.find((i) => i.id === id);
    if (!target) return;
    const idx = STAGES.indexOf(target.currentStage);
    if (idx === STAGES.length - 1) return;
    const from = target.currentStage;
    const to = STAGES[idx + 1]!;
    setInitiatives((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        if (i.currentStage !== from) return i;
        return {
          ...i,
          currentStage: to,
          stagesCompleted: Array.from(
            new Set([...i.stagesCompleted, i.currentStage])
          ),
          stageHistory: [
            ...i.stageHistory,
            { stage: to, enteredAt: todayLocalISO() },
          ],
        };
      })
    );
    log(ADKAR_ACTIONS.STAGE_ADVANCED, {
      initiativeId: id,
      from,
      to,
    });
  };

  const perStage = useMemo(() => {
    const c: Record<Stage, number> = {
      awareness: 0,
      desire: 0,
      knowledge: 0,
      ability: 0,
      reinforcement: 0,
    };
    for (const i of initiatives) c[i.currentStage] += 1;
    return c;
  }, [initiatives]);

  const pctReinforcement =
    initiatives.length > 0
      ? perStage.reinforcement / initiatives.length
      : 0;

  const avgDaysPerStage = useMemo(() => {
    const deltas: number[] = [];
    for (const i of initiatives) {
      const h = i.stageHistory;
      for (let k = 1; k < h.length; k++) {
        const aDate = parseLocalDate(h[k - 1]!.enteredAt);
        const bDate = parseLocalDate(h[k]!.enteredAt);
        if (!aDate || !bDate) continue;
        const a = aDate.getTime();
        const b = bDate.getTime();
        const d = (b - a) / (1000 * 60 * 60 * 24);
        if (Number.isFinite(d) && d >= 0) deltas.push(d);
      }
    }
    if (deltas.length === 0) return null;
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }, [initiatives]);

  const funnelData = useMemo(
    () =>
      STAGES.map((s) => ({
        stage: STAGE_LABEL[s],
        count: perStage[s],
        color: STAGE_COLOR[s],
      })),
    [perStage]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "ADKAR Change Tracker",
      prompts: generateAdkarPrompts(
        {
          initiatives: initiatives.map((i) => ({
            name: i.name,
            currentStage: i.currentStage,
            stagesCompleted: i.stagesCompleted,
            owner: i.owner,
            startDate: i.startDate,
            description: i.description,
          })),
          perStage,
          pctReinforcement,
          avgDaysPerStage,
        },
        workspace
      ),
    }),
    [initiatives, perStage, pctReinforcement, avgDaysPerStage, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="adkar"
      title="ADKAR Change Tracker"
      description="Move each change initiative through Awareness → Desire → Knowledge → Ability → Reinforcement."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="adkar"
          csvData={{
            headers: [
              "Name",
              "Current stage",
              "Owner",
              "Start date",
              "Stages completed",
              "Description",
            ],
            rows: initiatives.map((i) => [
              i.name,
              i.currentStage,
              i.owner ?? "",
              i.startDate,
              i.stagesCompleted.join("; "),
              (i.description ?? "").replace(/\n/g, " "),
            ]),
          }}
          jsonData={initiatives}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Sparkles}
          label="Total initiatives"
          value={initiatives.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={TrendingUp}
          label="In Ability"
          value={perStage.ability}
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="At Reinforcement"
          value={`${(pctReinforcement * 100).toFixed(0)}%`}
          hint={`${perStage.reinforcement} initiative${
            perStage.reinforcement === 1 ? "" : "s"
          }`}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Avg days / stage"
          value={
            avgDaysPerStage !== null ? `${avgDaysPerStage.toFixed(1)}d` : "—"
          }
        />
      </KpiGrid>

      <CalloutAlert tone="info" className="mb-4">
        <strong>ADKAR</strong>: <em>Awareness</em> — understand the need.{" "}
        <em>Desire</em> — choose to participate. <em>Knowledge</em> — know how
        to change. <em>Ability</em> — apply the change in real work.{" "}
        <em>Reinforcement</em> — sustain it so it sticks.
      </CalloutAlert>

      {/* Add-initiative form */}
      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_180px_auto] gap-2">
            <div>
              <Label className="text-xs text-sub">Initiative</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Adopt trunk-based development"
                className="bg-bg border-border"
                aria-label="Initiative name"
              />
            </div>
            <div>
              <Label className="text-xs text-sub">Owner</Label>
              <Input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Owner (optional)"
                className="bg-bg border-border"
                aria-label="Owner"
              />
            </div>
            <div>
              <Label className="text-xs text-sub">Start date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-bg border-border"
                aria-label="Start date"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={addInitiative}
                className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
              >
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
          </div>
          <div className="mt-2">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)..."
              rows={2}
              className="bg-bg border-border resize-none text-xs"
              aria-label="Description"
            />
          </div>
        </CardContent>
      </Card>

      {initiatives.length === 0 ? (
        <EmptyState icon={Sparkles}>
          No initiatives yet. Add the first change you&apos;re tracking above.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-3 mb-6">
            {initiatives.map((i) => {
              const idx = STAGES.indexOf(i.currentStage);
              const isLast = idx === STAGES.length - 1;
              return (
                <Card key={i.id} className="bg-surface border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text">
                          {i.name}
                        </div>
                        <div className="text-xs text-sub mt-0.5">
                          {i.owner && `${i.owner} · `}started {i.startDate}
                        </div>
                        {i.description && (
                          <div className="text-xs text-sub mt-1 whitespace-pre-wrap">
                            {i.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => advanceStage(i.id)}
                          disabled={isLast}
                          className="gap-1.5 border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          {isLast ? "At final stage" : "Advance stage"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeInitiative(i.id)}
                          className="text-sub hover:text-danger"
                          aria-label={`Remove ${i.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {/* 5-stage progress bar */}
                    <div className="flex gap-1">
                      {STAGES.map((s, sIdx) => {
                        const completed = i.stagesCompleted.includes(s);
                        const isCurrent = i.currentStage === s;
                        return (
                          <div
                            key={s}
                            className={cn(
                              "flex-1 rounded-md border px-1.5 py-1 text-[10px] uppercase tracking-wider text-center",
                              completed
                                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                                : isCurrent
                                ? "border-accent/60 bg-accent/10 text-accent font-semibold"
                                : "border-border bg-bg text-sub"
                            )}
                          >
                            {sIdx + 1}. {STAGE_LABEL[s]}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Funnel chart (counts by stage) */}
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-accent" />
                Initiatives by current stage
              </div>
              <div className="h-64 -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={funnelData}
                    layout="vertical"
                    margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={chartTheme.gridColor}
                    />
                    <XAxis
                      type="number"
                      tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                      axisLine={{ stroke: chartTheme.gridColor }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                      axisLine={{ stroke: chartTheme.gridColor }}
                      width={100}
                    />
                    <Tooltip
                      contentStyle={chartTheme.tooltipStyle}
                      formatter={(v) => [String(v), "Initiatives"]}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {funnelData.map((d, idx) => (
                        <Cell key={idx} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STAGES.map((s) => (
                  <div key={s} className="text-xs text-sub">
                    <span className="font-semibold text-text">
                      {STAGE_LABEL[s]}:
                    </span>{" "}
                    {STAGE_BLURB[s]}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </ToolPageWrapper>
  );
}
