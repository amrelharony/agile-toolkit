"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Activity, MessageSquare, Brain } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateDevexPrompts } from "@/lib/ai-prompts/devex-survey";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DEVEX_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

interface DevexResponse {
  id: string;
  respondent: string; // "" allowed (anonymous)
  date: string; // YYYY-MM-DD
  flowState: number;       // 1-5
  feedbackLoops: number;   // 1-5
  cognitiveLoad: number;   // 1-5 (higher = MORE load = worse)
  comments?: string;
}

interface DevexState {
  responses: DevexResponse[];
}

const DEFAULT_STATE: DevexState = { responses: [] };

interface DraftState {
  respondent: string;
  date: string;
  flowState: number;
  feedbackLoops: number;
  cognitiveLoad: number;
  comments: string;
}

function makeDraft(): DraftState {
  return {
    respondent: "",
    date: todayLocalISO(),
    flowState: 3,
    feedbackLoops: 3,
    cognitiveLoad: 3,
    comments: "",
  };
}

export function DevexSurveyClient() {
  const [state, setState] = usePersisted<DevexState>(
    "agile-toolkit:devex-survey",
    DEFAULT_STATE
  );
  const [draft, setDraft] = useState<DraftState>(makeDraft);
  const { log } = useHistoryLogger("devex-survey");

  const addResponse = () => {
    const response: DevexResponse = {
      id: crypto.randomUUID(),
      respondent: draft.respondent.trim(),
      date: draft.date,
      flowState: draft.flowState,
      feedbackLoops: draft.feedbackLoops,
      cognitiveLoad: draft.cognitiveLoad,
      comments: draft.comments.trim() || undefined,
    };
    setState((s) => ({ responses: [...s.responses, response] }));
    log(DEVEX_ACTIONS.RESPONSE_LOGGED, {
      responseId: response.id,
      respondent: response.respondent || "anonymous",
      date: response.date,
      flowState: response.flowState,
      feedbackLoops: response.feedbackLoops,
      cognitiveLoad: response.cognitiveLoad,
      comments: response.comments,
    });
    setDraft(makeDraft());
  };

  const removeResponse = (id: string) => {
    const response = state.responses.find((r) => r.id === id);
    setState((s) => ({ responses: s.responses.filter((x) => x.id !== id) }));
    log(DEVEX_ACTIONS.RESPONSE_REMOVED, {
      responseId: id,
      respondent: response?.respondent || "anonymous",
      date: response?.date,
    });
  };

  const sorted = useMemo(
    () => [...state.responses].sort((a, b) => a.date.localeCompare(b.date)),
    [state.responses]
  );

  // Averages — guard against /0 when no responses exist.
  const { avgFlow, avgFeedback, avgCognitive } = useMemo(() => {
    if (sorted.length === 0) {
      return { avgFlow: 0, avgFeedback: 0, avgCognitive: 0 };
    }
    const sumFlow = sorted.reduce((a, r) => a + r.flowState, 0);
    const sumFeed = sorted.reduce((a, r) => a + r.feedbackLoops, 0);
    const sumCog = sorted.reduce((a, r) => a + r.cognitiveLoad, 0);
    return {
      avgFlow: sumFlow / sorted.length,
      avgFeedback: sumFeed / sorted.length,
      avgCognitive: sumCog / sorted.length,
    };
  }, [sorted]);

  // Distribution: per-dimension count at each score 1-5.
  // Out-of-range values are dropped (not clamped into the 1 / 5 buckets) so
  // a stray `flowState: 7` doesn't show up as an extra response with a 5.
  const distribution = useMemo(() => {
    const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
    const count = (
      pred: (r: (typeof sorted)[number]) => boolean
    ): number => sorted.filter(pred).length;
    return [1, 2, 3, 4, 5].map((score) => ({
      score: `${score}`,
      flow: count((r) => inRange(r.flowState) && r.flowState === score),
      feedback: count(
        (r) => inRange(r.feedbackLoops) && r.feedbackLoops === score
      ),
      cognitive: count(
        (r) => inRange(r.cognitiveLoad) && r.cognitiveLoad === score
      ),
    }));
  }, [sorted]);

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
      toolName: "DevEx Survey",
      prompts: generateDevexPrompts(
        {
          responses: sorted,
          avgFlow,
          avgFeedback,
          avgCognitive,
        },
        workspace
      ),
    }),
    [sorted, avgFlow, avgFeedback, avgCognitive, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="devex-survey"
      title="DevEx Survey"
      description="Lightweight developer-experience pulse covering flow state, feedback loops, and cognitive load."
      category="Engineering Excellence"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="devex-survey"
          csvData={{
            headers: [
              "Date",
              "Respondent",
              "Flow",
              "Feedback Loops",
              "Cognitive Load",
              "Comments",
            ],
            rows: sorted.map((r) => [
              r.date,
              r.respondent || "anonymous",
              r.flowState,
              r.feedbackLoops,
              r.cognitiveLoad,
              r.comments ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          icon={Activity}
          label="Flow state (avg)"
          value={sorted.length === 0 ? "—" : avgFlow.toFixed(2)}
          hint={`${sorted.length} response(s) — higher is better`}
          tone={avgFlow >= 4 ? "success" : avgFlow > 0 && avgFlow <= 2 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={MessageSquare}
          label="Feedback loops (avg)"
          value={sorted.length === 0 ? "—" : avgFeedback.toFixed(2)}
          hint="Higher is better"
          tone={avgFeedback >= 4 ? "success" : avgFeedback > 0 && avgFeedback <= 2 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Brain}
          label="Cognitive load (avg)"
          value={sorted.length === 0 ? "—" : avgCognitive.toFixed(2)}
          hint="Lower is better"
          tone={avgCognitive > 0 && avgCognitive <= 2 ? "success" : avgCognitive >= 4 ? "danger" : "default"}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Log a response" icon={Plus} titleSize="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="devex-respondent" className="text-xs text-sub">
                  Respondent (optional)
                </Label>
                <Input
                  id="devex-respondent"
                  value={draft.respondent}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, respondent: e.target.value }))
                  }
                  placeholder="anon"
                  className="bg-surface border-border"
                />
              </div>
              <div>
                <Label htmlFor="devex-date" className="text-xs text-sub">
                  Date
                </Label>
                <Input
                  id="devex-date"
                  type="date"
                  value={draft.date}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, date: e.target.value }))
                  }
                  className="bg-surface border-border"
                />
              </div>
            </div>
            <SliderRow
              label="Flow state"
              hint="1 = constantly interrupted, 5 = uninterrupted deep work"
              value={draft.flowState}
              onChange={(v) => setDraft((d) => ({ ...d, flowState: v }))}
            />
            <SliderRow
              label="Feedback loops"
              hint="1 = slow / stale, 5 = fast and trusted"
              value={draft.feedbackLoops}
              onChange={(v) => setDraft((d) => ({ ...d, feedbackLoops: v }))}
            />
            <SliderRow
              label="Cognitive load"
              hint="1 = low (good), 5 = overwhelming (bad)"
              value={draft.cognitiveLoad}
              onChange={(v) => setDraft((d) => ({ ...d, cognitiveLoad: v }))}
            />
            <div>
              <Label htmlFor="devex-comments" className="text-xs text-sub">
                Comments (optional)
              </Label>
              <Textarea
                id="devex-comments"
                value={draft.comments}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, comments: e.target.value }))
                }
                placeholder="What's blocking you? What's working well?"
                rows={3}
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
              onClick={addResponse}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Submit response
            </Button>
          </div>
        </SectionCard>

        <ChartCard title="Score distribution" height={320}>
          <BarChart data={distribution} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
            <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
            <XAxis dataKey="score" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
            <Legend wrapperStyle={chartTheme.legendStyle} />
            <Bar dataKey="flow" name="Flow" fill={chartTheme.colors.cyan} />
            <Bar dataKey="feedback" name="Feedback" fill={chartTheme.colors.green} />
            <Bar dataKey="cognitive" name="Cog. load" fill={chartTheme.colors.amber} />
          </BarChart>
        </ChartCard>
      </div>

      {sorted.length > 0 && (
        <SectionCard title="Responses" titleSize="lg" className="mt-6">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Respondent</th>
                  <th className="py-2 pr-3">Flow</th>
                  <th className="py-2 pr-3">Feedback</th>
                  <th className="py-2 pr-3">Cog. load</th>
                  <th className="py-2 pr-3">Comments</th>
                  <th className="py-2 pr-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {[...sorted].reverse().map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-data text-text">{r.date}</td>
                    <td className="py-2 pr-3 text-sub">{r.respondent || "anon"}</td>
                    <td className="py-2 pr-3 font-data">{r.flowState}</td>
                    <td className="py-2 pr-3 font-data">{r.feedbackLoops}</td>
                    <td className="py-2 pr-3 font-data">{r.cognitiveLoad}</td>
                    <td className="py-2 pr-3 text-sub max-w-[260px]">
                      <span className="line-clamp-2 break-words whitespace-pre-wrap">
                        {r.comments ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeResponse(r.id)}
                        aria-label={`Remove response from ${r.date}`}
                        className="h-7 w-7 p-0 text-sub hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{label}</span>
        <span className="text-xs font-data text-accent">{value} / 5</span>
      </div>
      <Slider
        min={1}
        max={5}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <p className="text-xs text-sub">{hint}</p>
    </div>
  );
}
