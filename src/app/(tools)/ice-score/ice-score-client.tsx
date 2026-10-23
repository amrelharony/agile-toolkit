"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Hash, Pencil, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { ScaleValue } from "@/components/shared/scale-picker";
import { IconButton } from "@/components/ui/icon-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { iceScore, rank } from "@/lib/analytics/scoring-rubric";
import { generateIcePrompts } from "@/lib/ai-prompts/ice-score";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ICE_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { undoable } from "@/lib/utils/undoable";
import {
  BacklogRowLink,
  ImportFromBacklog,
  useBacklogImport,
} from "@/components/prioritization/backlog-link";
import { linkNewRow } from "@/lib/prioritization/backlog-links";
import {
  ICE_SCALES,
  IceAddForm,
  IceRowEditor,
  sameIceValues,
  useIceAddForm,
  withIceValues,
  type IceValues,
} from "./ice-inputs";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { iceVerdict } from "./verdict";

const byScore = (a: PrioritizationItem, b: PrioritizationItem) => (b.score ?? 0) - (a.score ?? 0);
const keyOf = (x: PrioritizationItem) => x.id;

export function IceScoreClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "ice"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("ice-score");
  const exportRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function add(values: IceValues) {
    const score = iceScore(values.impact, values.confidence, values.ease);
    const item: PrioritizationItem = linkNewRow(
      {
        id: crypto.randomUUID(),
        framework: "ice",
        title: values.title,
        score,
        fields: withIceValues(undefined, values),
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
  }

  const form = useIceAddForm(add);
  // "Import from backlog" (or a "Score with ICE" link) fills the title; the
  // next idea added links to that backlog item.
  const backlog = useBacklogImport("ice", (picked) => form.update({ title: picked.name }));

  function save(row: PrioritizationItem, values: IceValues) {
    setEditingId(null);
    if (sameIceValues(row, values)) return;
    const score = iceScore(values.impact, values.confidence, values.ease);
    const next: PrioritizationItem = {
      ...row,
      title: values.title,
      score,
      fields: withIceValues(row.fields, values),
      updatedAt: new Date().toISOString(),
    };
    upsert(next);
    log(ICE_ACTIONS.ITEM_UPDATED, { id: row.id, score });
    emitSignal({
      kind: "prioritization.scored",
      at: next.updatedAt,
      toolId: "ice-score",
      payload: { framework: "ice", id: row.id, score },
    });
  }

  function remove(row: PrioritizationItem) {
    undoable({
      label: `Deleted “${row.title}”`,
      apply: () => {
        removeOne(row.id);
        log(ICE_ACTIONS.ITEM_REMOVED, { id: row.id });
      },
      revert: () => upsert(row),
    });
  }

  const loadExample = () => {
    buildExample().forEach(upsert);
    // An earlier empty "Add & score" shouldn't leave errors under the example.
    form.reset();
  };
  const clearExample = () => items.filter((x) => isExampleId(x.id)).forEach((x) => removeOne(x.id));

  // Rank numbers follow the scores; the order on screen stays put while an
  // idea is being edited, and "Re-sort" catches it up.
  const ranks = useMemo(
    () =>
      new Map(
        rank(items.map((x) => ({ id: x.id, title: x.title, fields: {}, score: x.score ?? 0 }))).map(
          (r) => [r.id, r.rank]
        )
      ),
    [items]
  );
  const { ordered, isStale, resort } = useStableOrder(items, keyOf, byScore);

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
        {hasExampleItems(items) && <ExampleNotice onClear={clearExample} />}

        <SectionCard title="Add experiment / idea" icon={Plus}>
          <IceAddForm form={form} footer={<ImportFromBacklog link={backlog} />} />
        </SectionCard>

        {items.length === 0 ? (
          <EmptyState
            icon={Hash}
            action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
          >
            No ideas yet. Add one above, or load an example to see a scored list.
          </EmptyState>
        ) : (
          <SectionCard
            title={`Ideas (${items.length}, highest ICE first)`}
            icon={Hash}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="ice-scores"
                  csvData={csvData}
                  jsonData={ranked}
                  markdown={toMarkdown(items)}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <p className="mb-3 text-sm font-medium text-text">{iceVerdict(items)}</p>
            <ResortChip isStale={isStale} onResort={resort} />
            <ol className="divide-y divide-border" aria-label="Ideas, highest ICE first">
              {ordered.map((row) => (
                <li key={row.id} className="py-3">
                  {editingId === row.id ? (
                    <IceRowEditor
                      row={row}
                      onSave={(values) => save(row, values)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <IceRow
                      row={row}
                      rank={ranks.get(row.id) ?? 0}
                      onEdit={() => setEditingId(row.id)}
                      onRemove={() => remove(row)}
                    />
                  )}
                </li>
              ))}
            </ol>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

/** One ranked idea: rank, title and backlog link, the three scores, ICE, actions. */
function IceRow({
  row,
  rank,
  onEdit,
  onRemove,
}: {
  row: PrioritizationItem;
  rank: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const f = row.fields ?? {};
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="w-6 shrink-0 font-mono text-xs text-sub" aria-label={`Rank ${rank}`}>
        {rank}
      </span>
      <span className="inline-flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2 text-sm text-text">
        {row.title}
        <BacklogRowLink row={row} />
      </span>
      <dl className="flex items-center gap-3 font-mono text-xs text-sub">
        {(
          [
            ["I", "Impact", "impact"],
            ["C", "Confidence", "confidence"],
            ["E", "Ease", "ease"],
          ] as const
        ).map(([short, name, key]) => (
          <div key={key} className="flex gap-1">
            <dt title={name}>
              <span aria-hidden="true">{short}</span>
              <span className="sr-only">{name}</span>
            </dt>
            <dd className="text-text">
              <ScaleValue steps={ICE_SCALES[key]} value={f[key]} />
            </dd>
          </div>
        ))}
      </dl>
      <span className="w-14 shrink-0 text-right font-mono text-sm text-text">
        <span className="sr-only">ICE </span>
        {row.score ?? 0}
      </span>
      <span className="flex shrink-0 items-center">
        <IconButton
          label={`Edit ${row.title}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${row.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
