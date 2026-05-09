"use client";

import { useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Heart, Plus, Trash2, AlertTriangle, Users } from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PSYCH_SAFETY_ACTIONS } from "@/lib/history/event-actions";
import { generatePsychSafetyPrompts } from "@/lib/ai-prompts/psych-safety";

type QuestionId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7";

interface QuestionMeta {
  id: QuestionId;
  text: string;
  reversed: boolean;
}

interface Response {
  id: string;
  ts: string; // ISO timestamp
  scores: Record<QuestionId, number>; // 1-5 raw Likert
  respondent?: string;
  description?: string;
}

const QUESTIONS: QuestionMeta[] = [
  {
    id: "q1",
    text: "If I make a mistake on this team, it is held against me.",
    reversed: true,
  },
  {
    id: "q2",
    text: "Members of this team are able to bring up problems and tough issues.",
    reversed: false,
  },
  {
    id: "q3",
    text: "People on this team sometimes reject others for being different.",
    reversed: true,
  },
  {
    id: "q4",
    text: "It is safe to take a risk on this team.",
    reversed: false,
  },
  {
    id: "q5",
    text: "It is difficult to ask other members of this team for help.",
    reversed: true,
  },
  {
    id: "q6",
    text: "No one on this team would deliberately act in a way that undermines my efforts.",
    reversed: false,
  },
  {
    id: "q7",
    text: "Working with members of this team, my unique skills and talents are valued and utilized.",
    reversed: false,
  },
];

const STORAGE_KEY = "agile-toolkit:psych-safety";
const ORG_BENCHMARK = 4.0;

function adjustedScore(raw: number, reversed: boolean): number {
  return reversed ? 6 - raw : raw;
}

function defaultScores(): Record<QuestionId, number> {
  return QUESTIONS.reduce(
    (acc, q) => ({ ...acc, [q.id]: 3 }),
    {} as Record<QuestionId, number>
  );
}

interface RadarPoint {
  cx: number;
  cy: number;
  px: number;
  py: number;
  benchPx: number;
  benchPy: number;
}

/**
 * Project a 7-axis radar chart into 300x300 SVG coordinates. Returns axes
 * (one per question) plus the polygon points for the team and benchmark.
 */
function projectRadar(
  perQ: { id: QuestionId; reversedScore: number }[],
  benchmark: number,
  size = 300
): {
  cx: number;
  cy: number;
  radius: number;
  axes: RadarPoint[];
  teamPolygon: string;
  benchPolygon: string;
} {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.78;
  const n = perQ.length;
  const axes = perQ.map((q, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const norm = Math.max(0, Math.min(1, (q.reversedScore - 1) / 4));
    const r = radius * norm;
    const benchNorm = Math.max(0, Math.min(1, (benchmark - 1) / 4));
    const br = radius * benchNorm;
    return {
      cx: cx + Math.cos(angle) * radius,
      cy: cy + Math.sin(angle) * radius,
      px: cx + Math.cos(angle) * r,
      py: cy + Math.sin(angle) * r,
      benchPx: cx + Math.cos(angle) * br,
      benchPy: cy + Math.sin(angle) * br,
    };
  });
  const teamPolygon = axes.map((a) => `${a.px},${a.py}`).join(" ");
  const benchPolygon = axes.map((a) => `${a.benchPx},${a.benchPy}`).join(" ");
  return { cx, cy, radius, axes, teamPolygon, benchPolygon };
}

export function PsychSafetyClient() {
  const [responses, setResponses] = usePersisted<Response[]>(STORAGE_KEY, []);
  const { log } = useHistoryLogger("psych-safety");

  const [draftScores, setDraftScores] = useState<Record<QuestionId, number>>(
    defaultScores
  );
  const [respondent, setRespondent] = useState("");
  const [description, setDescription] = useState("");

  const submitResponse = () => {
    const id = crypto.randomUUID();
    const desc = description.trim();
    const trimmedRespondent = respondent.trim();
    const r: Response = {
      id,
      ts: new Date().toISOString(),
      scores: { ...draftScores },
      respondent: trimmedRespondent.length > 0 ? trimmedRespondent : undefined,
      description: desc.length > 0 ? desc : undefined,
    };
    setResponses((s) => [...s, r]);
    log(PSYCH_SAFETY_ACTIONS.RESPONSE_LOGGED, {
      responseId: id,
      respondent: r.respondent,
      description: r.description,
    });
    log(PSYCH_SAFETY_ACTIONS.ASSESSMENT_SAVED, {
      responseId: id,
      scores: r.scores,
    });
    setDraftScores(defaultScores());
    setRespondent("");
    setDescription("");
  };

  const removeResponse = (id: string) => {
    setResponses((s) => s.filter((r) => r.id !== id));
  };

  // Per-question average (raw and reversed-adjusted).
  const perQuestion = useMemo(() => {
    return QUESTIONS.map((q) => {
      const vals = responses.map((r) => r.scores[q.id]);
      if (vals.length === 0) {
        return { id: q.id, text: q.text, reversed: q.reversed, avg: 0, reversedScore: 0 };
      }
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return {
        id: q.id,
        text: q.text,
        reversed: q.reversed,
        avg,
        reversedScore: adjustedScore(avg, q.reversed),
      };
    });
  }, [responses]);

  // Team score = mean of all reversed-adjusted per-question averages.
  const teamScore = useMemo(() => {
    if (responses.length === 0) return 0;
    const sum = perQuestion.reduce((acc, q) => acc + q.reversedScore, 0);
    return sum / perQuestion.length;
  }, [perQuestion, responses.length]);

  const lowest = useMemo(() => {
    if (responses.length === 0) return undefined;
    return perQuestion.reduce(
      (acc, q) =>
        acc === undefined || q.reversedScore < acc.reversedScore ? q : acc,
      undefined as undefined | (typeof perQuestion)[number]
    );
  }, [perQuestion, responses.length]);

  // Anomaly: split responses by halves; compare team scores to detect a >0.5 drop.
  const { delta, anomaly } = useMemo(() => {
    if (responses.length < 4) return { delta: undefined, anomaly: false };
    const sorted = [...responses].sort((a, b) => a.ts.localeCompare(b.ts));
    const mid = Math.floor(sorted.length / 2);
    const prior = sorted.slice(0, mid);
    const recent = sorted.slice(mid);
    const meanScore = (rs: Response[]) => {
      const perQ = QUESTIONS.map((q) => {
        const vals = rs.map((r) => r.scores[q.id]);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return adjustedScore(avg, q.reversed);
      });
      return perQ.reduce((a, b) => a + b, 0) / perQ.length;
    };
    const priorScore = meanScore(prior);
    const recentScore = meanScore(recent);
    const d = recentScore - priorScore;
    return { delta: d, anomaly: d < -0.5 };
  }, [responses]);

  const radar = useMemo(
    () => projectRadar(perQuestion, ORG_BENCHMARK),
    [perQuestion]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Psychological Safety Assessment",
      prompts: generatePsychSafetyPrompts({
        questions: QUESTIONS.map((q) => ({
          id: q.id,
          text: q.text,
          reversed: q.reversed,
        })),
        perQuestionAvg: perQuestion.map((q) => ({
          id: q.id,
          avg: q.avg,
          reversedScore: q.reversedScore,
        })),
        teamScore,
        benchmark: ORG_BENCHMARK,
        responseCount: responses.length,
        lowestQuestionId: lowest?.id,
        delta,
      }),
    }),
    [perQuestion, teamScore, responses.length, lowest, delta]
  );

  const csvData = useMemo(
    () => ({
      headers: [
        "Timestamp",
        "Respondent",
        ...QUESTIONS.map((q) => q.id),
        "Description",
      ],
      rows: responses.map((r) => [
        r.ts,
        r.respondent ?? "",
        ...QUESTIONS.map((q) => r.scores[q.id]),
        r.description ?? "",
      ]),
    }),
    [responses]
  );

  return (
    <ToolPageWrapper
      toolId="psych-safety"
      title="Psychological Safety Assessment"
      description="Edmondson 7-question survey with team-vs-org benchmark and per-question radar."
      category="Team Health & Maturity"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="psych-safety"
          csvData={csvData}
          jsonData={responses}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Heart}
          label="Team score"
          value={responses.length === 0 ? "—" : `${teamScore.toFixed(2)}`}
          unit="/5"
          hint={`benchmark ${ORG_BENCHMARK.toFixed(1)}`}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Users}
          label="Responses"
          value={responses.length}
        />
        <StatCard
          variant="compact"
          label="Lowest question"
          value={lowest ? `Q${lowest.id.slice(1)}` : "—"}
          hint={lowest ? `${lowest.reversedScore.toFixed(2)}/5` : ""}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Anomaly"
          value={anomaly ? "drop" : "ok"}
          hint={
            delta !== undefined
              ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs prior half`
              : "needs ≥ 4 responses"
          }
          tone={anomaly ? "danger" : "default"}
        />
      </KpiGrid>

      {anomaly && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>Score dropped &gt; 0.5</strong> compared to the prior half of
          responses — investigate which dimensions slipped.
        </CalloutAlert>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-sub mb-3">
          Log a response
        </div>
        <div className="space-y-3">
          {QUESTIONS.map((q) => (
            <div
              key={q.id}
              className="rounded-md border border-border bg-bg p-3 space-y-2"
            >
              <div className="text-xs text-text">
                <span className="text-sub mr-1">Q{q.id.slice(1)}.</span>
                {q.text}
                {q.reversed && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-300">
                    reversed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={[draftScores[q.id]]}
                  onValueChange={(v) =>
                    setDraftScores((s) => ({ ...s, [q.id]: v[0] ?? 3 }))
                  }
                  className="flex-1"
                  aria-label={`Score for ${q.text}`}
                />
                <span className="font-data text-sm text-accent w-8 text-right">
                  {draftScores[q.id]}
                </span>
              </div>
            </div>
          ))}
          <Input
            value={respondent}
            onChange={(e) => setRespondent(e.target.value)}
            placeholder="Respondent (optional, kept anonymous-friendly)"
            className="bg-bg border-border text-sm"
            aria-label="Respondent"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description / additional context (optional)..."
            rows={2}
            className="bg-bg border-border text-sm resize-none"
            aria-label="Description"
          />
          <div className="flex justify-end">
            <Button
              onClick={submitResponse}
              className="gap-2 bg-accent text-bg hover:bg-accent/90"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Submit response
            </Button>
          </div>
        </div>
      </div>

      {responses.length === 0 ? (
        <EmptyState icon={Heart}>
          No responses yet. Submit the first one above to see the radar and
          team score.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Radar */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs uppercase tracking-wider text-sub mb-2">
              Per-question radar (1-5 reversed-adjusted)
            </div>
            <div className="flex justify-center">
              <svg
                viewBox="0 0 300 300"
                className="w-full max-w-[300px] h-auto"
                role="img"
                aria-label="Psychological safety radar chart"
              >
                {/* Concentric reference rings at 1, 2, 3, 4, 5. */}
                {[1, 2, 3, 4, 5].map((lvl) => (
                  <circle
                    key={lvl}
                    cx={radar.cx}
                    cy={radar.cy}
                    r={radar.radius * ((lvl - 1) / 4)}
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                  />
                ))}
                {/* Axis lines + labels */}
                {radar.axes.map((a, i) => (
                  <g key={i}>
                    <line
                      x1={radar.cx}
                      y1={radar.cy}
                      x2={a.cx}
                      y2={a.cy}
                      stroke="rgba(255,255,255,0.08)"
                    />
                    <text
                      x={a.cx}
                      y={a.cy}
                      dx={a.cx > radar.cx ? 6 : a.cx < radar.cx ? -6 : 0}
                      dy={a.cy > radar.cy ? 12 : a.cy < radar.cy ? -4 : 4}
                      fontSize={10}
                      fill="#94a3b8"
                      textAnchor={
                        Math.abs(a.cx - radar.cx) < 4
                          ? "middle"
                          : a.cx > radar.cx
                          ? "start"
                          : "end"
                      }
                      className="font-data"
                    >
                      Q{i + 1}
                    </text>
                  </g>
                ))}
                {/* Benchmark polygon */}
                <polygon
                  points={radar.benchPolygon}
                  fill="rgba(168, 85, 247, 0.10)"
                  stroke="rgba(168, 85, 247, 0.6)"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                />
                {/* Team polygon */}
                <polygon
                  points={radar.teamPolygon}
                  fill="rgba(0, 240, 255, 0.18)"
                  stroke="#00f0ff"
                  strokeWidth={2}
                />
              </svg>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-sub">
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-3 h-2 rounded"
                  style={{ background: "#00f0ff" }}
                />
                Team
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-3 h-2 rounded"
                  style={{
                    background: "rgba(168,85,247,0.4)",
                    border: "1px dashed rgba(168,85,247,0.7)",
                  }}
                />
                Org benchmark ({ORG_BENCHMARK.toFixed(1)})
              </span>
            </div>
          </div>

          {/* Per-question avg */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs uppercase tracking-wider text-sub mb-2">
              Per-question averages
            </div>
            <div className="space-y-2">
              {perQuestion.map((q, i) => (
                <div key={q.id} className="text-xs">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-text break-words">
                      <span className="text-sub mr-1">Q{i + 1}.</span>
                      {q.text}
                    </span>
                    <span className="font-data text-accent shrink-0">
                      {q.reversedScore.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${((q.reversedScore - 1) / 4) * 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {responses.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-sub">
            Responses ({responses.length})
          </div>
          {responses.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-border bg-bg p-2 text-xs flex items-start justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sub">
                  {new Date(r.ts).toLocaleString()}
                  {r.respondent && ` · ${r.respondent}`}
                </div>
                <div className="text-text font-data">
                  {QUESTIONS.map((q) => `Q${q.id.slice(1)}=${r.scores[q.id]}`).join(
                    " · "
                  )}
                </div>
                {r.description && (
                  <div className="text-sub whitespace-pre-wrap">
                    {r.description}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeResponse(r.id)}
                className="h-6 w-6 p-0 text-sub hover:text-danger shrink-0"
                aria-label="Remove response"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </ToolPageWrapper>
  );
}
