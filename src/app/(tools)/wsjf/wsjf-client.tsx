"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import dynamic from "next/dynamic";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { EditableName } from "@/components/shared/editable-name";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { wsjfScore, rank } from "@/lib/analytics/scoring-rubric";
import { generateWsjfPrompts } from "@/lib/ai-prompts/wsjf";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WSJF_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { undoable } from "@/lib/utils/undoable";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import {
  BacklogRowLink,
  ImportFromBacklog,
  useBacklogImport,
} from "@/components/prioritization/backlog-link";
import { ScaleValue, focusFirstInvalid } from "@/components/prioritization/scale-picker";
import { linkNewRow } from "@/lib/prioritization/backlog-links";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import {
  EMPTY_WSJF_DRAFT,
  FIBONACCI_STEPS,
  WsjfInputs,
  WsjfRowEditor,
  clearErrors,
  sameWsjfValues,
  validateWsjf,
  wsjfCustomFrom,
  wsjfDraftFrom,
  type WsjfDraft,
  type WsjfErrors,
  type WsjfValues,
} from "./wsjf-inputs";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const WsjfScoreChart = dynamic(() => import("./charts").then((m) => m.WsjfScoreChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

type AddErrors = WsjfErrors & { title?: string };

const COLUMNS = 8;

export function WsjfClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "wsjf"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("wsjf");
  const exportRef = useRef<HTMLDivElement>(null);

  const addFormRef = useRef<HTMLFormElement>(null);

  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<WsjfDraft>(EMPTY_WSJF_DRAFT);
  // Off-scale values a backlog prefill brought in, kept on offer as "Custom".
  const [custom, setCustom] = useState<WsjfDraft>(EMPTY_WSJF_DRAFT);
  const [errors, setErrors] = useState<AddErrors>({});
  const [attempt, setAttempt] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const refocusEdit = useRef<string | null>(null);

  // "Import from backlog" (or a "Score with WSJF" link) fills the form; the
  // next feature added links to that backlog item.
  const backlog = useBacklogImport("wsjf", (picked, prefill) => {
    const next = wsjfDraftFrom(prefill);
    setTitle(picked.name);
    setDraft(next);
    setCustom(wsjfCustomFrom(next));
    setErrors({});
  });

  // After a failed add, focus the first field that needs attention.
  useEffect(() => {
    if (attempt > 0) focusFirstInvalid(addFormRef.current);
  }, [attempt]);

  // A saved or cancelled row edit hands focus back to that row's Edit
  // button, wherever the new score ranked it.
  useEffect(() => {
    const id = refocusEdit.current;
    if (!id) return;
    refocusEdit.current = null;
    editButtons.current.get(id)?.focus();
  });

  function add(e: FormEvent) {
    e.preventDefault();
    const name = title.trim();
    const result = validateWsjf(draft);
    const found: AddErrors = result.ok ? {} : { ...result.errors };
    if (!name) found.title = "Enter a title.";
    if (!result.ok || !name) {
      setErrors(found);
      setAttempt((n) => n + 1);
      return;
    }
    const { businessValue, timeCriticality, rrOe, jobSize } = result.values;
    const score = wsjfScore(businessValue, timeCriticality, rrOe, jobSize);
    const item: PrioritizationItem = linkNewRow(
      {
        id: crypto.randomUUID(),
        framework: "wsjf",
        title: name.slice(0, 200),
        score,
        fields: { businessValue, timeCriticality, rrOe, jobSize },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      backlog.pending?.id
    );
    upsert(item);
    backlog.clear();
    log(WSJF_ACTIONS.ITEM_ADDED, { title: item.title, score });
    emitSignal({
      kind: "prioritization.scored",
      at: item.updatedAt,
      toolId: "wsjf",
      payload: { framework: "wsjf", id: item.id, score },
    });
    setTitle("");
    setDraft(EMPTY_WSJF_DRAFT);
    setCustom(EMPTY_WSJF_DRAFT);
    setErrors({});
  }

  /** The freshest copy of a row, so an edit never overwrites a newer write. */
  const freshRow = (id: string) =>
    (useWorkspaceStore.getState().prioritizations ?? []).find((x) => x.id === id);

  function rename(id: string, next: string) {
    const cur = freshRow(id);
    const name = next.trim().slice(0, 200);
    if (!cur || !name || name === cur.title) return;
    upsert({ ...cur, title: name, updatedAt: new Date().toISOString() });
    log(WSJF_ACTIONS.ITEM_UPDATED, { id, title: name });
  }

  function closeEditor(id: string) {
    refocusEdit.current = id;
    setEditingId(null);
  }

  function saveScores(id: string, values: WsjfValues) {
    const cur = freshRow(id);
    closeEditor(id);
    // Saving without a change leaves the row (and any custom value) as it was.
    if (!cur || sameWsjfValues(cur.fields, values)) return;
    const score = wsjfScore(
      values.businessValue,
      values.timeCriticality,
      values.rrOe,
      values.jobSize
    );
    const next: PrioritizationItem = {
      ...cur,
      fields: { ...cur.fields, ...values },
      score,
      updatedAt: new Date().toISOString(),
    };
    upsert(next);
    log(WSJF_ACTIONS.ITEM_UPDATED, { id, score });
    emitSignal({
      kind: "prioritization.scored",
      at: next.updatedAt,
      toolId: "wsjf",
      payload: { framework: "wsjf", id, score },
    });
  }

  // The table is ranked by score, so the restored item finds its own place.
  function remove(id: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    if (editingId === id) setEditingId(null);
    undoable({
      label: `Deleted “${shortName(item.title)}”`,
      apply: () => {
        removeOne(id);
        log(WSJF_ACTIONS.ITEM_REMOVED, { id });
      },
      revert: () => {
        const back = (useWorkspaceStore.getState().prioritizations ?? []).some((x) => x.id === id);
        if (!back) upsert(item);
      },
    });
  }

  // Example rows are written like any other item but never logged or
  // signalled: loading an example isn't the user's own scoring work.
  function loadExample() {
    for (const item of buildExample()) upsert(item);
  }

  function clearExample() {
    for (const x of items) if (isExampleId(x.id)) removeOne(x.id);
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

  // R10: prefix with rank so two features with the same (or same-truncated)
  // title don't collapse into one bar — Recharts uses dataKey="title" as
  // YAxis category and duplicate categories silently merge, hiding scores.
  //
  // Truncate the title BEFORE prefixing so the rank stays inside the 80px
  // YAxis margin even at rank ≥ 10 (where the prefix is "#10 " = 4 chars).
  // Total label width stays ≤ 18 chars.
  const chartData = ranked.slice(0, 10).map((r) => {
    const t = r.title.length > 14 ? r.title.slice(0, 14) + "…" : r.title;
    return { title: `#${r.rank} ${t}`, score: Number(r.score.toFixed(2)) };
  });

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
      toolName: "WSJF Calculator",
      prompts: generateWsjfPrompts({ items: ranked }, workspace),
    }),
    [ranked, workspace]
  );

  const markdown = useMemo(() => toMarkdown(items), [items]);

  const csvData = {
    headers: ["Rank", "Title", "BV", "TC", "RR/OE", "Size", "WSJF"],
    rows: ranked.map((r) => [
      r.rank,
      r.title,
      r.fields.businessValue ?? "",
      r.fields.timeCriticality ?? "",
      r.fields.rrOe ?? "",
      r.fields.jobSize ?? "",
      r.score.toFixed(2),
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="wsjf"
      title="WSJF Calculator"
      description="Weighted Shortest Job First: (Business Value + Time Criticality + Risk Reduction/Opportunity Enablement) ÷ Job Size."
    >
      {hasExampleItems(items) && <ExampleNotice onClear={clearExample} />}
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add feature" icon={Plus} actions={<ImportFromBacklog link={backlog} />}>
          <form
            ref={addFormRef}
            aria-label="Add feature"
            onSubmit={add}
            noValidate
            className="space-y-3"
          >
            <Field label="Feature title" error={errors.title}>
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  maxLength={200}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                  }}
                />
              )}
            </Field>
            <WsjfInputs
              draft={draft}
              custom={custom}
              errors={errors}
              onChange={(patch) => {
                setDraft((d) => ({ ...d, ...patch }));
                setErrors((prev) => clearErrors(prev, patch));
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" className="gap-1">
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add & score
              </Button>
              {items.length === 0 && <LoadExampleButton onLoad={loadExample} />}
            </div>
          </form>
        </SectionCard>

        {chartData.length > 0 && (
          <SectionCard
            title="Top 10 by WSJF"
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="wsjf-scores"
                  csvData={csvData}
                  jsonData={ranked}
                  markdown={markdown}
                  shareState={items}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <WsjfScoreChart data={chartData} />
            </div>
          </SectionCard>
        )}

        {ranked.length > 0 && (
          <SectionCard title="Features (sorted by WSJF)">
            <p className="mb-2 text-xs text-sub">
              Click a title to rename it. Use Edit to change its scores.
            </p>
            <TooltipProvider delayDuration={300}>
              <div className="table-wrap-responsive">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-sub uppercase">
                      <th className="p-2">#</th>
                      <th className="p-2">Title</th>
                      <th className="p-2 text-right">BV</th>
                      <th className="p-2 text-right">TC</th>
                      <th className="p-2 text-right">RR/OE</th>
                      <th className="p-2 text-right">Size</th>
                      <th className="p-2 text-right">WSJF</th>
                      <th className="p-2 w-20">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r) => {
                      const row = byId.get(r.id);
                      const editing = editingId === r.id && row !== undefined;
                      const editorId = `wsjf-edit-${r.id}`;
                      return (
                        <Fragment key={r.id}>
                          <tr className="border-t border-border">
                            <td className="p-2 font-mono text-xs">{r.rank}</td>
                            <td className="p-2">
                              <span className="flex flex-wrap items-center gap-2">
                                <EditableName
                                  value={r.title}
                                  onChange={(next) => rename(r.id, next)}
                                  ariaLabel={`Rename ${r.title}`}
                                  className="max-w-full"
                                />
                                <BacklogRowLink row={row} />
                              </span>
                            </td>
                            <td className="p-2 text-right font-mono text-xs">
                              <ScaleValue steps={FIBONACCI_STEPS} value={r.fields.businessValue} />
                            </td>
                            <td className="p-2 text-right font-mono text-xs">
                              <ScaleValue
                                steps={FIBONACCI_STEPS}
                                value={r.fields.timeCriticality}
                              />
                            </td>
                            <td className="p-2 text-right font-mono text-xs">
                              <ScaleValue steps={FIBONACCI_STEPS} value={r.fields.rrOe} />
                            </td>
                            <td className="p-2 text-right font-mono text-xs">
                              <ScaleValue steps={FIBONACCI_STEPS} value={r.fields.jobSize} />
                            </td>
                            <td className="p-2 text-right font-mono">{r.score.toFixed(2)}</td>
                            <td className="p-2">
                              <span className="flex items-center justify-end gap-1">
                                <IconButton
                                  ref={(el) => {
                                    if (el) editButtons.current.set(r.id, el);
                                    else editButtons.current.delete(r.id);
                                  }}
                                  label={`Edit scores for ${r.title}`}
                                  icon={<Pencil aria-hidden="true" />}
                                  aria-expanded={editing}
                                  aria-controls={editing ? editorId : undefined}
                                  onClick={() => (editing ? closeEditor(r.id) : setEditingId(r.id))}
                                  className="h-7 w-7 md:h-7 md:w-7 text-sub hover:text-accent min-touch-coarse"
                                />
                                <IconButton
                                  label={`Remove ${r.title}`}
                                  icon={<Trash2 aria-hidden="true" />}
                                  variant="danger-ghost"
                                  onClick={() => remove(r.id)}
                                  className="h-7 w-7 md:h-7 md:w-7 min-touch-coarse"
                                />
                              </span>
                            </td>
                          </tr>
                          {editing && (
                            <tr id={editorId}>
                              <td colSpan={COLUMNS} className="p-2 pt-0">
                                <WsjfRowEditor
                                  row={row}
                                  onSave={(values) => saveScores(r.id, values)}
                                  onCancel={() => closeEditor(r.id)}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
