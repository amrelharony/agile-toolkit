"use client";

/**
 * The Kano Model: for each feature, how customers feel if it has it and if
 * it doesn't; the Kano evaluation table turns each answer pair into a
 * class, and a feature's category is its most common class.
 *
 * - The category is derived, never picked, by the method registry (the
 *   agent actions read it the same way): from survey counts once 3 people
 *   have answered, or from one person's answer pair (marked as such).
 *   Better and Worse need 3 answers that aren't Reverse or Questionable.
 * - Answers come three ways: one person's pair in the form, survey counts
 *   tallied elsewhere, or a survey round through the vote-room kit (a live
 *   room, or the kit's 5×5 count grid per feature when rooms are off). A
 *   round keeps only each feature's joint counts; saving replaces a
 *   feature's earlier counts unless "Add to earlier answers" is on, with
 *   Undo, and never counts the same round twice.
 * - A category picked by hand on the old page still counts, as "Picked by
 *   hand" with "Add answers"; the page never writes one.
 * - Lists go what-customers-expect first (Decide order's ranking) and hold
 *   still while a feature is edited. Delete and Clear features come with
 *   Undo.
 */

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Heart, Plus, Radio, ScatterChart } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ImportFromBacklog, useBacklogImport } from "@/components/prioritization/backlog-link";
import {
  draftFrom,
  exportRows,
  useMethodActions,
  withClears,
  type MethodDraft,
} from "@/components/prioritization/method-tool";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateKanoPrompts } from "@/lib/ai-prompts/kano-model";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KANO_ACTIONS } from "@/lib/history/event-actions";
import { hasExampleItems } from "@/lib/utils/example-id";
import { toast } from "@/lib/utils/toast";
import { KANO } from "@/lib/prioritization/methods";
import { KANO_CATEGORY_LABEL, KANO_MIN_RESPONSES } from "@/lib/prioritization/methods/kano";
import type { PairRoundResult } from "@/lib/realtime/vote-room/pair";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { KANO_CONFIG } from "./config";
import { KanoInputs, KanoRowEditor, MODE_KEY, validateKanoDraft } from "./inputs";
import { toMarkdown } from "./markdown";
import {
  FRAMEWORK,
  compareFeatures,
  featureView,
  kanoGroups,
  kanoRows,
  promptGroups,
  shortName,
  toCsv,
} from "./model";
import { BetterWorsePlot, EvaluationTable, KanoRoundPreview } from "./results";
import { FeatureRow } from "./rows";
import { applyKanoRound, holdsRound, kanoSurvey } from "./survey";
import { kanoVerdict } from "./verdict";

const NO_ROWS: PrioritizationItem[] = [];

const newDraft = (title = ""): MethodDraft => ({ ...draftFrom(title), [MODE_KEY]: "pair" });

export function KanoModelClient() {
  const all = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
  const ranked = useMemo(() => kanoRows(all), [all]);
  const actions = useMethodActions(KANO_CONFIG);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("kano-model");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLLIElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addToEarlier, setAddToEarlier] = useState(false);
  // Save and Cancel unmount the editor: focus goes back to the row's Edit
  // button, in whichever list the feature lands.
  const { refFor, returnTo } = useReturnFocus();
  const closeEditor = (id: string) => {
    setEditingId(null);
    returnTo(`edit:${id}`);
  };

  // "Import from backlog" (or a "Score with Kano" link) fills the title; an
  // item already answered here opens its row instead of a second one.
  const formRef = useRef<ItemFormState<MethodDraft, string> | null>(null);
  const backlog = useBacklogImport(
    FRAMEWORK,
    (picked) => formRef.current?.reset(newDraft(picked.name)),
    {
      onEdit: (row) => {
        setEditingId(row.id);
        announce(`Editing “${shortName(row.title)}”: it's already on the Kano list.`);
      },
    }
  );
  const focusEditor = () => editorRef.current?.querySelector<HTMLElement>("input")?.focus();

  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: () => newDraft(),
    validate: validateKanoDraft,
    onSave: (values) => {
      const row = actions.add(withClears(KANO, values), backlog.pending?.id);
      backlog.clear();
      const cat = KANO.evaluate(KANO.read(row.fields)).bucket;
      announce(
        cat
          ? `Added “${shortName(row.title)}”: ${KANO_CATEGORY_LABEL[cat as keyof typeof KANO_CATEGORY_LABEL]}`
          : `Added “${shortName(row.title)}”: it needs ${KANO_MIN_RESPONSES} answers for a category`
      );
    },
  });
  formRef.current = form;

  // The lists hold their order while a feature is edited; "Re-sort" catches up.
  const { ordered, isStale, resort } = useStableOrder(ranked, (r) => r.row.id, compareFeatures);

  // A round's counts replace each feature's earlier ones (or add to them).
  const saveRound = (result: PairRoundResult) => {
    const rows = useWorkspaceStore.getState().prioritizations ?? [];
    const next = applyKanoRound(rows, result, { add: addToEarlier });
    if (next.length === 0) {
      toast.error(
        rows.some((r) => r.framework === FRAMEWORK && holdsRound(r, result))
          ? "This round is already saved."
          : result.items.some((x) => x.joint)
            ? "The round's features are no longer on the list, so nothing was saved."
            : `No feature had ${result.minN} answers, so nothing was saved.`
      );
      return false;
    }
    const before = new Map(rows.map((r) => [r.id, r]));
    for (const r of next) upsert(r);
    log(KANO_ACTIONS.ITEM_UPDATED, {
      round: result.roundId,
      features: next.length,
      ballots: result.ballots,
      source: result.source,
      added: addToEarlier,
    });
    announce(
      `${next.length === 1 ? "1 feature" : `${next.length} features`} ${addToEarlier ? "updated with" : "categorised from"} ${result.ballots} answers`
    );
    return () => {
      for (const r of next) {
        const cur = (useWorkspaceStore.getState().prioritizations ?? []).find((x) => x.id === r.id);
        const prev = before.get(r.id);
        // Only a feature still as the round left it goes back.
        if (cur && prev && cur.updatedAt === r.updatedAt) upsert(prev);
      }
    };
  };

  const resetSnapshot = useRef<PrioritizationItem[]>([]);
  const reset = () => {
    const mine = (useWorkspaceStore.getState().prioritizations ?? []).filter(
      (r) => r.framework === FRAMEWORK
    );
    resetSnapshot.current = mine;
    for (const r of mine) removeOne(r.id);
    setEditingId(null);
    log(KANO_ACTIONS.KANO_RESET, { features: mine.length });
  };
  const undoReset = () => {
    const have = new Set((useWorkspaceStore.getState().prioritizations ?? []).map((r) => r.id));
    for (const r of resetSnapshot.current) if (!have.has(r.id)) upsert(r);
  };

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
      toolName: "Kano Model",
      prompts: generateKanoPrompts({ grouped: promptGroups(ranked) }, workspace),
    }),
    [ranked, workspace]
  );

  const rows = ranked.map((r) => r.row);
  const groups = kanoGroups(ordered).filter((g) => g.features.length > 0);
  const survey = kanoSurvey(all);
  const onlyExamples = rows.length > 0 && survey.sheet === null && hasExampleItems(rows);

  return (
    <ToolPageWrapper
      toolId="kano-model"
      title="Kano Model Builder"
      description={KANO_CONFIG.description}
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(rows) && <ExampleNotice onClear={actions.clearExample} />}

        <SectionCard title="Add feature" icon={Plus}>
          <ItemForm
            form={form}
            submitLabel="Add"
            submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            footer={<ImportFromBacklog link={backlog} onRoutedToEdit={focusEditor} />}
          >
            <Field label={KANO_CONFIG.titleLabel} error={form.errors.title} required>
              {(props) => (
                <Input
                  {...props}
                  value={form.draft.title}
                  onChange={(e) => form.update({ title: e.target.value })}
                  placeholder={KANO_CONFIG.titlePlaceholder}
                />
              )}
            </Field>
            <KanoInputs
              method={KANO}
              draft={form.draft}
              update={form.update}
              errors={form.errors}
              size="md"
            />
          </ItemForm>
        </SectionCard>

        {ranked.length === 0 ? (
          <EmptyState
            icon={Heart}
            action={
              <LoadExampleButton
                onLoad={() => {
                  actions.loadExample();
                  // An earlier empty "Add" shouldn't leave errors under the example.
                  form.reset();
                }}
                className="mt-4"
              />
            }
          >
            {KANO_CONFIG.emptyText}
          </EmptyState>
        ) : (
          <>
            <SectionCard
              title={`Features (${ranked.length})`}
              icon={Heart}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="kano-model"
                    csvData={toCsv(ranked)}
                    jsonData={exportRows(KANO, ranked)}
                    markdown={toMarkdown(ranked)}
                    targetRef={exportRef}
                  />
                  <ResetButton
                    label="Clear features"
                    title="Remove every Kano feature?"
                    description={`${ranked.length === 1 ? "1 feature" : `${ranked.length} features`} with their answers. Backlog items they link to stay in the backlog.`}
                    confirmLabel="Clear features"
                    doneLabel="Cleared the Kano features"
                    onReset={reset}
                    onUndo={undoReset}
                  />
                </>
              }
            >
              <p className="mb-3 text-sm font-medium text-text">{kanoVerdict(ranked)}</p>
              <ResortChip isStale={isStale} onResort={resort} />
              {groups.map((g) => (
                // Named by its heading with the count ("Must-be (2)").
                <section key={g.id} aria-labelledby={`kano-list-${g.id}`} className="mb-4">
                  <h3
                    id={`kano-list-${g.id}`}
                    className="text-xs font-medium uppercase tracking-wider text-sub"
                  >
                    {g.label} ({g.features.length})
                  </h3>
                  <p className="text-xs text-sub">{g.meaning}</p>
                  <ol className="divide-y divide-border">
                    {g.features.map((f) => (
                      <li
                        key={f.ranked.row.id}
                        ref={editingId === f.ranked.row.id ? editorRef : undefined}
                        className="py-3"
                      >
                        {editingId === f.ranked.row.id ? (
                          <KanoRowEditor
                            ranked={f.ranked}
                            onSave={(draft) => {
                              closeEditor(f.ranked.row.id);
                              actions.save(f.ranked.row.id, draft);
                              const after = featureView(
                                kanoRows(useWorkspaceStore.getState().prioritizations ?? []).find(
                                  (r) => r.row.id === f.ranked.row.id
                                ) ?? f.ranked
                              );
                              if (after.category && after.category !== f.category) {
                                announce(
                                  `${shortName(draft.title)} is now ${KANO_CATEGORY_LABEL[after.category]}`
                                );
                              }
                            }}
                            onCancel={() => closeEditor(f.ranked.row.id)}
                          />
                        ) : (
                          <FeatureRow
                            feature={f}
                            onEdit={() => setEditingId(f.ranked.row.id)}
                            onRemove={() => actions.remove(f.ranked.row)}
                            editRef={refFor(`edit:${f.ranked.row.id}`)}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </SectionCard>

            <SectionCard title="Better vs Worse" icon={ScatterChart}>
              <BetterWorsePlot rows={ranked} />
            </SectionCard>
          </>
        )}

        <SectionCard title="Ask customers" icon={Radio} contentClassName="space-y-3">
          {onlyExamples ? (
            <p className="text-sm text-sub">
              Clear the example to survey customers about your own features.
            </p>
          ) : (
            <>
              <p className="text-sm text-sub">
                Each person answers the two questions about every feature, anonymously; only the
                totals per feature are kept. From a survey, a feature&apos;s category shows from{" "}
                {KANO_MIN_RESPONSES} answers.
              </p>
              {survey.left > 0 && survey.sheet && (
                <p className="text-xs text-sub">
                  The survey asks about {survey.sheet.items.length} features (unanswered ones first;
                  a round takes at most {VOTE_LIMITS.maxPairItems}).{" "}
                  {survey.left === 1 ? "1 is" : `${survey.left} are`} left for the next round.
                </p>
              )}
              <label className="flex items-start gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={addToEarlier}
                  onChange={(e) => setAddToEarlier(e.target.checked)}
                />
                <span>
                  Add to earlier answers
                  <span className="block text-xs text-sub">
                    Off: a round&apos;s counts replace a feature&apos;s earlier answers.
                  </span>
                </span>
              </label>
              <VoteRoundPanel
                tool="kano-model"
                toolName="Kano survey"
                sheet={survey.sheet}
                minN={KANO_MIN_RESPONSES}
                onSave={saveRound}
                renderResults={(r) => <KanoRoundPreview result={r} rows={all} add={addToEarlier} />}
              />
            </>
          )}
        </SectionCard>

        <AdvancedAnalysis summary="How the category is found">
          <EvaluationTable />
        </AdvancedAnalysis>
      </div>
    </ToolPageWrapper>
  );
}
