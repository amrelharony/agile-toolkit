"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Hash, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { iceScore, rank } from "@/lib/analytics/scoring-rubric";
import { generateIcePrompts } from "@/lib/ai-prompts/ice-score";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ICE_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

export function IceScoreClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "ice"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("ice-score");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState("");
  const [confidence, setConfidence] = useState("");
  const [ease, setEase] = useState("");

  function add() {
    if (!title.trim()) return;
    // `parseFloat("")` → NaN, `parseFloat("abc")` → NaN.
    // `|| 5` would also clobber a legitimate `0`, so check NaN explicitly and
    // fall back to the midpoint only when the user genuinely left the field
    // empty.  `iceScore` will then clamp into [1, 10].
    const safeNum = (raw: string): number => {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return 5;
      // BUG-T4-ice-score-1: clamp into [1, 10] HERE so the stored
      // fields match the input's documented range. The prior code
      // relied on `iceScore`'s internal clamp, which left the stored
      // `fields.impact` = "100" while the score reflected `10` —
      // confusing in the table.
      return Math.min(10, Math.max(1, n));
    };
    const i = safeNum(impact),
      c = safeNum(confidence),
      e = safeNum(ease);
    const score = iceScore(i, c, e);
    const item: PrioritizationItem = {
      id: crypto.randomUUID(),
      framework: "ice",
      title: title.trim(),
      score,
      fields: { impact: i, confidence: c, ease: e },
      status: "scored",
      updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(ICE_ACTIONS.ITEM_ADDED, { title: item.title, score });
    emitSignal({
      kind: "prioritization.scored",
      at: item.updatedAt,
      toolId: "ice-score",
      payload: { framework: "ice", id: item.id, score },
    });
    setTitle("");
    setImpact("");
    setConfidence("");
    setEase("");
  }

  const ranked = useMemo(
    () =>
      rank(
        items.map((x) => ({
          id: x.id,
          title: x.title,
          fields: x.fields ?? {},
          score: x.score ?? 0,
        }))
      ),
    [items]
  );

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
        prioritizations: s.prioritizations,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "ICE Score",
      prompts: generateIcePrompts({ items: ranked }, workspace),
    }),
    [ranked, workspace]
  );

  const csvData = {
    headers: ["Rank", "Title", "Impact", "Confidence", "Ease", "Score"],
    rows: ranked.map((r) => [
      r.rank,
      r.title,
      r.fields.impact,
      r.fields.confidence,
      r.fields.ease,
      r.score,
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="ice-score"
      title="ICE Score Card"
      description="Lightweight Impact × Confidence × Ease scoring (each 1–10). Best for fast prioritisation of growth experiments and quick wins."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add experiment / idea" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <Input
              className="sm:col-span-2"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Impact 1-10"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Confidence 1-10"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Ease 1-10"
              value={ease}
              onChange={(e) => setEase(e.target.value)}
            />
          </div>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add & score
          </Button>
        </SectionCard>

        {ranked.length > 0 && (
          <SectionCard
            title={`Ideas (${ranked.length}, sorted by ICE)`}
            icon={Hash}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="ice-scores"
                  csvData={csvData}
                  jsonData={ranked}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">#</th>
                    <th className="p-2">Title</th>
                    <th className="p-2 text-right">I</th>
                    <th className="p-2 text-right">C</th>
                    <th className="p-2 text-right">E</th>
                    <th className="p-2 text-right">Score</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{r.rank}</td>
                      <td className="p-2">{r.title}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.impact}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.confidence}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.ease}</td>
                      <td className="p-2 text-right font-mono">{r.score}</td>
                      <td className="p-2">
                        <button
                          onClick={() => {
                            removeOne(r.id);
                            log(ICE_ACTIONS.ITEM_REMOVED, { id: r.id });
                          }}
                          aria-label="Remove item"
                          className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-danger"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
