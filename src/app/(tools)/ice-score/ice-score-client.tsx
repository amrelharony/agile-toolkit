"use client";

import { useId, useMemo, useRef, useState } from "react";
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
import {
  BacklogRowLink,
  ImportFromBacklog,
  useBacklogImport,
} from "@/components/prioritization/backlog-link";
import { linkNewRow } from "@/lib/prioritization/backlog-links";

/** "Impact", "Impact and Ease", "Impact, Confidence and Ease". */
function joinAnd(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** A score for display: at most two decimals, so 3.3 × 3 × 1 reads 9.9, not 9.899999999999999. */
function showScore(score: number): number {
  return Number(score.toFixed(2));
}

/** What's missing before an idea can be scored. */
function missingMessage(titleMissing: boolean, missingScores: readonly string[]): string {
  const parts = [...(titleMissing ? ["a title"] : []), ...missingScores];
  const range = missingScores.length > 0 ? " Each score runs from 1 to 10." : "";
  return `Enter ${joinAnd(parts)} to score this idea.${range}`;
}

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

  // "Import from backlog" (or a "Score with ICE" link) fills the title; the
  // next idea added links to that backlog item.
  const backlog = useBacklogImport("ice", (picked) => setTitle(picked.name));

  // An empty score used to become 5 without a word, so an idea scored on one
  // field still ranked as if all three were rated. All three are required;
  // after a failed Add the empty fields are flagged and a message names them.
  const errorId = useId();
  const [attempted, setAttempted] = useState(false);
  const titleMissing = !title.trim();
  const missingScores = (
    [
      ["Impact", impact],
      ["Confidence", confidence],
      ["Ease", ease],
    ] as const
  )
    .filter(([, raw]) => !Number.isFinite(parseFloat(raw)))
    .map(([label]) => label);
  const showError = attempted && (titleMissing || missingScores.length > 0);
  const flag = (missing: boolean) =>
    showError && missing ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  function add() {
    if (titleMissing || missingScores.length > 0) {
      setAttempted(true);
      return;
    }
    // BUG-T4-ice-score-1: clamp into [1, 10] HERE so the stored
    // fields match the input's documented range. The prior code
    // relied on `iceScore`'s internal clamp, which left the stored
    // `fields.impact` = "100" while the score reflected `10` —
    // confusing in the table.
    const clampScore = (raw: string): number => Math.min(10, Math.max(1, parseFloat(raw)));
    const i = clampScore(impact),
      c = clampScore(confidence),
      e = clampScore(ease);
    const score = iceScore(i, c, e);
    const item: PrioritizationItem = linkNewRow(
      {
        id: crypto.randomUUID(),
        framework: "ice",
        title: title.trim(),
        score,
        fields: { impact: i, confidence: c, ease: e },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      backlog.pending?.id
    );
    upsert(item);
    backlog.clear();
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
    setAttempted(false);
  }

  const byId = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);

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
      showScore(r.score),
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="ice-score"
      title="ICE Score Card"
      description="Lightweight Impact × Confidence × Ease scoring (each 1–10). Best for fast prioritisation of growth experiments and quick wins."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard
          title="Add experiment / idea"
          icon={Plus}
          actions={<ImportFromBacklog link={backlog} />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <Input
              className="sm:col-span-2"
              placeholder="Title"
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              {...flag(titleMissing)}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Impact 1-10"
              aria-label="Impact (1–10)"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              {...flag(missingScores.includes("Impact"))}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Confidence 1-10"
              aria-label="Confidence (1–10)"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              {...flag(missingScores.includes("Confidence"))}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Ease 1-10"
              aria-label="Ease (1–10)"
              value={ease}
              onChange={(e) => setEase(e.target.value)}
              {...flag(missingScores.includes("Ease"))}
            />
          </div>
          {showError && (
            <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
              {missingMessage(titleMissing, missingScores)}
            </p>
          )}
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
                    <th className="p-2 w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{r.rank}</td>
                      <td className="p-2">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {r.title}
                          <BacklogRowLink row={byId.get(r.id)} />
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.impact}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.confidence}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.ease}</td>
                      <td className="p-2 text-right font-mono">{showScore(r.score)}</td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => {
                            removeOne(r.id);
                            log(ICE_ACTIONS.ITEM_REMOVED, { id: r.id });
                          }}
                          aria-label={`Remove ${r.title}`}
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
