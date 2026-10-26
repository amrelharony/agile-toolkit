"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ListChecks, PercentCircle, Scale } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateWeightedPrompts } from "@/lib/ai-prompts/weighted-decision";
import { WEIGHTED_DECISION_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import type { HandoffLink } from "@/lib/handoffs/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  WeightedCriterion,
  WeightedMatrix,
  WeightedOption,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  DEFAULT_WEIGHTED_MATRIX_ID,
  cellOf,
  findMatrix,
  matricesOf,
  matrixResult,
  rowsOf,
  sentText,
} from "@/lib/weighted/model";
import { optionCardLinks, repinCards } from "./card-links";
import { CriteriaPanel, type NewCriterion } from "./criteria-panel";
import { buildExample } from "./example";
import { matrixToMarkdown } from "./markdown";
import { MatrixPicker, type NewMatrix } from "./matrix-picker";
import { MatrixTable } from "./matrix-table";
import { ResultCard } from "./result-card";

/** `?matrix=<id>` opens one matrix (a decision record's "From weighted decision" link). */
export const MATRIX_PARAM = "matrix";

export function readMatrixParam(search: string): string | null {
  const v = new URLSearchParams(search).get(MATRIX_PARAM);
  return v && v.length <= 128 ? v : null;
}

const NO_MATRICES: WeightedMatrix[] = [];
const NO_OPTIONS: WeightedOption[] = [];
const NO_CRITERIA: WeightedCriterion[] = [];

/** Logged for matrices; not in WEIGHTED_DECISION_ACTIONS (lib/history/event-actions) yet. */
const MATRIX_ADDED = "matrix_added";
const MATRIX_REMOVED = "matrix_removed";

/**
 * The matrix to show: the one asked for (if it exists), else the newest
 * one, else nothing.
 */
function pickMatrix(matrices: readonly WeightedMatrix[], chosen: string | null) {
  return matrices.find((m) => m.id === chosen) ?? matrices[matrices.length - 1];
}

/** A row's matrixId for a new row: none for the default matrix (as legacy rows have it). */
const matrixIdFor = (id: string) => (id === DEFAULT_WEIGHTED_MATRIX_ID ? {} : { matrixId: id });

/**
 * Weighted Decision Matrix: named matrices of options scored 1–10 against
 * weighted criteria. Every number comes from lib/weighted (the agent
 * actions compute through it too): an empty cell is not scored, a Total
 * needs every weighted cell, the star needs a Total, near-ties and the
 * weight changes that would flip the result are named, and the result can
 * become a proposed decision record.
 */
export function WeightedDecisionClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.weightedMatrices) ?? NO_MATRICES;
  const options = useWorkspaceStore((s) => s.weightedOptions) ?? NO_OPTIONS;
  const criteria = useWorkspaceStore((s) => s.weightedCriteria) ?? NO_CRITERIA;
  // Read so a decision decided in the Decision Log re-renders the link.
  useWorkspaceStore((s) => s.decisions);
  const { log } = useHistoryLogger("weighted-decision");
  const announce = useAnnounce();
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    const id = readMatrixParam(window.location.search);
    if (id) setChosen(id);
  }, []);

  const matrices = useMemo(
    () => matricesOf(stored, options, criteria),
    [stored, options, criteria]
  );
  const selected = pickMatrix(matrices, chosen);
  const result = useMemo(
    () => (selected ? matrixResult(selected.id, criteria, options) : null),
    [selected, criteria, options]
  );
  const ownCriteria = selected ? rowsOf(selected.id, criteria) : NO_CRITERIA;
  const ownOptions = selected ? rowsOf(selected.id, options) : NO_OPTIONS;
  const example = selected ? isExampleId(selected.id) : false;
  // Example rows aren't the team's history.
  const record = (action: string, payload: Record<string, unknown>) => {
    if (!example) log(action, payload);
  };

  const select = useCallback((id: string) => {
    setChosen(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(MATRIX_PARAM, id);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* no history API: the choice still applies on this page */
    }
  }, []);

  /* ── Matrices ─────────────────────────────────────────────────────── */

  const ws = () => useWorkspaceStore.getState();
  /** The matrix's stored document, created on first change for the unnamed default one. */
  const docOf = (m: WeightedMatrix): WeightedMatrix =>
    m.createdAt ? m : { ...m, createdAt: new Date().toISOString() };

  const createMatrix = (values: NewMatrix) => {
    const m: WeightedMatrix = {
      id: `weightedMatrix_${nanoid(8)}`,
      ...values,
      createdAt: new Date().toISOString(),
    };
    ws().upsertWeightedMatrix(m);
    log(MATRIX_ADDED, { matrixId: m.id, name: m.name });
    select(m.id);
    announce(`Created the matrix ${m.name}`);
  };

  const patchMatrix = (m: WeightedMatrix, patch: Partial<WeightedMatrix>) => {
    const current = findMatrix(ws().weightedMatrices, m.id) ?? m;
    ws().upsertWeightedMatrix({
      ...docOf(current),
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  const deleteMatrix = (m: WeightedMatrix) => {
    const s = ws();
    const doc = (s.weightedMatrices ?? []).find((x) => x.id === m.id);
    const gone = {
      options: rowsOf(m.id, s.weightedOptions),
      criteria: rowsOf(m.id, s.weightedCriteria),
    };
    const goneCriteria = new Set(gone.criteria.map((c) => c.id));
    const cards = optionCardLinks(gone.options.map((o) => o.id));
    // Other matrices' options can't score these criteria in the page, but an
    // agent's might: keep what the delete strips so Undo puts it back.
    const stripped = (s.weightedOptions ?? [])
      .filter((o) => !gone.options.some((g) => g.id === o.id))
      .flatMap((o) =>
        Object.entries(o.scores ?? {})
          .filter(([k]) => goneCriteria.has(k))
          .map(([k, v]) => ({ optionId: o.id, criterionId: k, value: v }))
      );
    undoable({
      label: `Deleted the matrix “${m.name}”`,
      apply: () => {
        ws().removeWeightedMatrix(m.id);
        if (!isExampleId(m.id)) log(MATRIX_REMOVED, { matrixId: m.id, name: m.name });
      },
      revert: () => {
        const st = ws();
        if (doc) st.upsertWeightedMatrix(doc);
        gone.criteria.forEach(st.upsertWeightedCriterion);
        gone.options.forEach(st.upsertWeightedOption);
        for (const x of stripped) {
          const o = (ws().weightedOptions ?? []).find((y) => y.id === x.optionId);
          if (o)
            ws().upsertWeightedOption({ ...o, scores: { ...o.scores, [x.criterionId]: x.value } });
        }
        repinCards(cards);
        select(m.id);
      },
    });
    announce(`Deleted the matrix ${m.name}`);
  };

  /* ── Criteria ─────────────────────────────────────────────────────── */

  const addCriterion = (values: NewCriterion) => {
    if (!selected) return;
    const c: WeightedCriterion = {
      id: `weightedCrit_${nanoid(8)}`,
      ...values,
      ...matrixIdFor(selected.id),
    };
    ws().upsertWeightedCriterion(c);
    record(WEIGHTED_DECISION_ACTIONS.CRITERION_ADDED, { name: c.name, matrixId: selected.id });
    announce(`Added the criterion ${c.name}`);
  };

  const patchCriterion = (
    c: WeightedCriterion,
    patch: Partial<WeightedCriterion>,
    what: string
  ) => {
    const current = (ws().weightedCriteria ?? []).find((x) => x.id === c.id) ?? c;
    const next: WeightedCriterion = { ...current, ...patch };
    if (next.low === undefined) delete next.low;
    if (next.high === undefined) delete next.high;
    ws().upsertWeightedCriterion(next);
    announce(what);
  };

  const deleteCriterion = (c: WeightedCriterion) => {
    // The store strips the criterion's scores from every option; Undo puts them back.
    const scores = (ws().weightedOptions ?? []).flatMap((o) =>
      typeof o.scores?.[c.id] === "number" ? [{ optionId: o.id, value: o.scores[c.id] }] : []
    );
    undoable({
      label: `Deleted the criterion “${c.name}”`,
      description: scores.length > 0 ? `and its ${scores.length} scores` : undefined,
      apply: () => {
        ws().removeWeightedCriterion(c.id);
        record(WEIGHTED_DECISION_ACTIONS.CRITERION_REMOVED, { id: c.id, name: c.name });
      },
      revert: () => {
        ws().upsertWeightedCriterion(c);
        for (const x of scores) {
          const o = (ws().weightedOptions ?? []).find((y) => y.id === x.optionId);
          if (o) ws().upsertWeightedOption({ ...o, scores: { ...o.scores, [c.id]: x.value } });
        }
      },
    });
    announce(`Deleted the criterion ${c.name}`);
  };

  /* ── Options and scores ───────────────────────────────────────────── */

  const addOption = (name: string) => {
    if (!selected) return;
    const o: WeightedOption = {
      id: `weightedOpt_${nanoid(8)}`,
      name,
      scores: {},
      ...matrixIdFor(selected.id),
    };
    ws().upsertWeightedOption(o);
    record(WEIGHTED_DECISION_ACTIONS.OPTION_ADDED, { name, matrixId: selected.id });
    announce(`Added the option ${name}`);
  };

  const patchOption = (o: WeightedOption, patch: Partial<WeightedOption>) => {
    const current = (ws().weightedOptions ?? []).find((x) => x.id === o.id) ?? o;
    const next: WeightedOption = { ...current, ...patch };
    if (!next.note) delete next.note;
    ws().upsertWeightedOption(next);
  };

  const setScore = (o: WeightedOption, c: WeightedCriterion, score: number | null) => {
    const current = (ws().weightedOptions ?? []).find((x) => x.id === o.id) ?? o;
    const scores = { ...current.scores };
    if (score === null) delete scores[c.id];
    else scores[c.id] = score;
    ws().upsertWeightedOption({ ...current, scores });
    record(WEIGHTED_DECISION_ACTIONS.SCORE_CHANGED, {
      optionId: o.id,
      criterionId: c.id,
      n: score,
    });
  };

  const deleteOption = (o: WeightedOption) => {
    // The store unpins the option's canvas cards; Undo pins them back.
    const cards = optionCardLinks([o.id]);
    undoable({
      label: `Deleted the option “${o.name}”`,
      apply: () => {
        ws().removeWeightedOption(o.id);
        record(WEIGHTED_DECISION_ACTIONS.OPTION_REMOVED, { id: o.id, name: o.name });
      },
      revert: () => {
        ws().upsertWeightedOption(o);
        repinCards(cards);
      },
    });
    announce(`Deleted the option ${o.name}`);
  };

  /* ── Hand-off links (on the matrix document) ───────────────────────── */

  const getLinks = () =>
    selected ? findMatrix(ws().weightedMatrices, selected.id)?.sentTo : undefined;
  const setLinks = (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
    if (!selected) return;
    const current = findMatrix(ws().weightedMatrices, selected.id) ?? selected;
    ws().upsertWeightedMatrix({ ...docOf(current), sentTo: update(current.sentTo) });
  };

  /* ── Example ──────────────────────────────────────────────────────── */

  const loadExample = () => {
    const ex = buildExample(new Date().toISOString());
    const s = ws();
    s.upsertWeightedMatrix(ex.matrix);
    ex.criteria.forEach(s.upsertWeightedCriterion);
    ex.options.forEach(s.upsertWeightedOption);
    select(ex.matrix.id);
  };
  const clearExample = () => {
    for (const m of matrices.filter((x) => isExampleId(x.id))) ws().removeWeightedMatrix(m.id);
    setChosen(null);
  };

  /* ── Exports ──────────────────────────────────────────────────────── */

  // As the result card says it: a record deleted since reads as not sent.
  const sent = selected ? liveLink(selected.sentTo, "decision") : undefined;
  const markdown =
    selected && result
      ? matrixToMarkdown(selected, result, ownOptions, {
          sentLabel: sent
            ? sentText(getHandoffRoute("decision").isDone?.(sent.targetId) === true)
            : undefined,
        })
      : "";
  const csvData =
    result && selected
      ? {
          headers: [
            "Option",
            ...ownCriteria.map((c) => `${c.name} (w${c.weight})`),
            "Total",
            "Status",
          ],
          rows: result.options.map((r) => {
            const o = ownOptions.find((x) => x.id === r.id);
            return [
              r.name,
              // An unscored cell exports empty, not as a 0 score.
              ...ownCriteria.map((c) => {
                const cell = o ? cellOf(o, c.id) : { kind: "empty" as const };
                return cell.kind === "empty" ? "" : cell.value;
              }),
              r.total !== null ? Math.round(r.total * 100) / 100 : "",
              r.total !== null ? (r.id === result.leaderId ? "leader" : "complete") : "partial",
            ];
          }),
        }
      : undefined;

  const promptConfig = useMemo(
    () => ({
      toolName: "Weighted Decision Matrix",
      // Every option as the table shows it: a cell not scored is "—", never 0.
      prompts: result
        ? generateWeightedPrompts({ result, options: ownOptions, matrix: selected })
        : [],
    }),
    [ownOptions, result, selected]
  );

  return (
    <ToolPageWrapper
      toolId="weighted-decision"
      title="Weighted Decision Matrix (Pugh / MCDA)"
      description="Score each option against weighted criteria. Total = sum of score × weight, once every weighted cell is scored. Best for choosing between similar options."
    >
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading matrices…
        </p>
      ) : (
        <div className="space-y-4">
          {matrices.some((m) => isExampleId(m.id)) && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: choosing a feature-flag vendor. Two options finish within 5% (a tie), and
                one has a cell left empty, so it has no Total yet.
              </p>
            </div>
          )}

          <SectionCard
            title="Matrix"
            icon={Scale}
            actions={
              selected && result ? (
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="weighted-decision"
                    markdown={markdown}
                    clipboardText={markdown}
                    csvData={csvData}
                    jsonData={{
                      matrix: selected,
                      criteria: ownCriteria,
                      options: ownOptions,
                      result,
                    }}
                  />
                </>
              ) : undefined
            }
          >
            <MatrixPicker
              matrices={matrices}
              selected={selected}
              onSelect={select}
              onCreate={createMatrix}
              onRename={(m, name) => patchMatrix(m, { name })}
              onQuestion={(m, question) => patchMatrix(m, { question: question || undefined })}
              onDelete={deleteMatrix}
            />
          </SectionCard>

          {!selected || !result ? (
            <EmptyState
              icon={ListChecks}
              action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
            >
              No matrix yet. Create one for the decision in front of you (name it, list the criteria
              that matter and the options), or load an example to see a scored matrix.
            </EmptyState>
          ) : (
            <>
              <SectionCard title="Criteria">
                <CriteriaPanel
                  criteria={ownCriteria}
                  shares={result.criteria}
                  weightSum={result.weightSum}
                  onAdd={addCriterion}
                  onPatch={patchCriterion}
                  onDelete={deleteCriterion}
                />
              </SectionCard>

              <SectionCard title="Options and scores" icon={PercentCircle}>
                <MatrixTable
                  result={result}
                  options={ownOptions}
                  criteria={ownCriteria}
                  onScore={setScore}
                  onRename={(o, name) => patchOption(o, { name })}
                  onNote={(o, note) => patchOption(o, { note })}
                  onDelete={deleteOption}
                  onAdd={addOption}
                />
              </SectionCard>

              <SectionCard title="Result">
                <ResultCard
                  matrix={selected}
                  result={result}
                  onLinksChange={setLinks}
                  getLinks={getLinks}
                />
              </SectionCard>
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
