"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Users, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HitlReview, Workspace } from "@/lib/stores/workspace-types";
import { generateHitlPrompts } from "@/lib/ai-prompts/hitl-quality";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HITL_ACTIONS } from "@/lib/history/event-actions";

export function HitlQualityClient() {
  const list = useWorkspaceStore((s) => s.hitlReviews ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertHitlReview);
  const removeOne = useWorkspaceStore((s) => s.removeHitlReview);
  const { log } = useHistoryLogger("hitl-quality");
  const exportRef = useRef<HTMLDivElement>(null);

  const [feature, setFeature] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [rating, setRating] = useState<HitlReview["rating"]>(3);
  const [agreed, setAgreed] = useState(true);
  const [reason, setReason] = useState("");

  function add() {
    const item: HitlReview = {
      id: crypto.randomUUID(),
      feature: feature.trim() || undefined,
      reviewer: reviewer.trim() || undefined,
      rating,
      agreedWithModel: agreed,
      reason: reason.trim() || undefined,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(HITL_ACTIONS.REVIEW_LOGGED, { rating, agreed });
    setReason("");
  }

  function remove(id: string) {
    removeOne(id);
    log(HITL_ACTIONS.REVIEW_REMOVED, { id });
  }

  const meanRating = list.length === 0 ? 0 : list.reduce((s, x) => s + x.rating, 0) / list.length;
  const agreementRate = list.length === 0 ? 0 : Math.round((list.filter((x) => x.agreedWithModel).length / list.length) * 100);

  // Per-day rolling
  const trendData = useMemo(() => {
    const byDay: Record<string, { date: string; mean: number; n: number; sum: number }> = {};
    for (const x of list) {
      const day = x.loggedAt.slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, mean: 0, n: 0, sum: 0 };
      byDay[day].n++;
      byDay[day].sum += x.rating;
    }
    return Object.values(byDay).map((d) => ({ ...d, mean: d.sum / d.n })).sort((a, b) => a.date.localeCompare(b.date));
  }, [list]);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    hitlReviews: s.hitlReviews,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "HITL Quality Tracker",
    prompts: generateHitlPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Date", "Feature", "Reviewer", "Rating", "Agreed", "Reason"],
    rows: list.map((x) => [x.loggedAt.slice(0, 10), x.feature ?? "", x.reviewer ?? "", x.rating, x.agreedWithModel ? "yes" : "no", x.reason ?? ""]),
  };

  return (
    <ToolPageWrapper
      toolId="hitl-quality"
      title="Human-in-the-Loop Quality Tracker"
      description="Capture reviewer ratings, agreement-with-model rate, and acceptance trend over time."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPI label="Reviews" value={String(list.length)} />
          <KPI label="Mean rating" value={meanRating.toFixed(2)} />
          <KPI label="Agreement rate" value={`${agreementRate}%`} tone={agreementRate > 80 ? "ok" : "default"} />
        </div>

        <SectionCard title="Log review" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input placeholder="Feature" value={feature} onChange={(e) => setFeature(e.target.value)} />
            <Input placeholder="Reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            <select
              aria-label="Reviewer rating, 1 to 5"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              value={rating}
              onChange={(e) => setRating(parseInt(e.target.value, 10) as HitlReview["rating"])}
            >
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Rating {n}/5</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>Reviewer agreed with the model output</span>
            </label>
          </div>
          <Textarea placeholder="Reason / notes (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2" rows={2} />
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Log</Button>
        </SectionCard>

        {trendData.length > 1 && (
          <SectionCard title="Mean rating over time" icon={Users}>
            <div className="-mx-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#888" fontSize={11} />
                  <YAxis domain={[1, 5]} stroke="#888" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f1117", border: "1px solid #2a2f3a", fontSize: 12 }} />
                  <Line dataKey="mean" stroke="#00f0ff" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        )}

        {list.length > 0 && (
          <SectionCard
            title={`Reviews (${list.length})`}
            icon={Users}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="hitl-reviews" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-1.5">
              {[...list].sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime()).slice(0, 50).map((x) => (
                <li key={x.id} className="flex items-center gap-2 border border-border bg-surface-deep rounded p-2 text-sm">
                  <span className="font-mono text-xs text-sub">{x.loggedAt.slice(0, 10)}</span>
                  <span className="font-bold w-6 text-center" style={{ color: x.rating >= 4 ? "#00ff88" : x.rating <= 2 ? "#ff6b6b" : "#ffaa00" }}>{x.rating}</span>
                  {x.feature && <span className="text-text">{x.feature}</span>}
                  {x.reviewer && <span className="text-xs text-sub">— {x.reviewer}</span>}
                  <span className={`text-xs ml-auto ${x.agreedWithModel ? "text-emerald-400" : "text-red-400"}`}>{x.agreedWithModel ? "agreed" : "disagreed"}</span>
                  <button onClick={() => remove(x.id)} aria-label="Remove review" className="text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
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
