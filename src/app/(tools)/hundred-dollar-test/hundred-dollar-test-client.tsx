"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { BarChart3, Plus, Radio, Vote } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AllocationRound, PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import type { AllocationRoundResult } from "@/lib/realtime/vote-room/allocation";
import { generateHundredDollarPrompts } from "@/lib/ai-prompts/hundred-dollar-test";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HUNDRED_DOLLAR_ACTIONS } from "@/lib/history/event-actions";
import { todayIso } from "@/lib/sprints/series";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import {
  HUNDRED_FRAMEWORK,
  allocationOf,
  allocationRoundFrom,
  capAllocation,
  dollars,
  hundredDollarSheet,
  hundredDollarVerdict,
  hundredRows,
  roundDayProblem,
  roundsFor,
  splitSummary,
  teamAverages,
  withAllocation,
  withoutAllocation,
} from "@/lib/hundred-dollar/allocation";
import { DayField } from "../health-check/day-field";
import { useDayPick, useToday } from "../health-check/use-today";
import { AddItemForm } from "./add-item-form";
import { buildExample, type HundredDollarExample } from "./example";
import { ItemRow } from "./item-row";
import { toMarkdown } from "./markdown";
import { RoundHistory, RoundPicker, TeamResults, roundLabel, roundWhen } from "./team-results";

const keyOf = (x: PrioritizationItem) => x.id;
/** Biggest amount first; items with no amount yet after a deliberate $0. */
const byAmount = (a: PrioritizationItem, b: PrioritizationItem) =>
  (allocationOf(b) ?? -1) - (allocationOf(a) ?? -1);

const ws = () => useWorkspaceStore.getState();
const freshRows = () => hundredRows(ws().prioritizations);

/**
 * The $100 Test: split $100 across competing items. Two ways at once:
 *  - the agreed split, one $100 the group settles together (or one
 *    person's), typed per item and saved when the box is left;
 *  - team rounds, where everyone splits their own $100 anonymously in the
 *    vote room (or on paper), and only the per-item totals, how many gave
 *    each something and the spread bands are kept.
 * The results show the team's averages beside the agreed split. The
 * example is a read-only preview that never reaches the workspace.
 */
export function HundredDollarTestClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const storedRounds = useWorkspaceStore((s) => s.allocationRounds);
  const [example, setExample] = useState<HundredDollarExample | null>(null);
  const preview = example !== null;
  const liveRows = useMemo(() => hundredRows(all), [all]);
  const rows = example?.rows ?? liveRows;
  const rounds = useMemo(
    () => roundsFor(example?.rounds ?? storedRounds, "hundred-dollar-test"),
    [example, storedRounds]
  );
  const { log } = useHistoryLogger("hundred-dollar-test");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  // Why the last amount typed was changed, shown under that item.
  const [allocNote, setAllocNote] = useState<{ id: string; text: string } | null>(null);
  const [pickedRound, setPickedRound] = useState<string | null>(null);
  // For Clear all amounts' Undo: the rows as they were.
  const beforeReset = useRef<PrioritizationItem[]>([]);
  const today = useToday();
  // The day a team round is saved under: today unless picked (paper splits collected earlier).
  const [roundDay, setRoundDay] = useDayPick(today);

  const round = rounds.find((r) => r.id === pickedRound) ?? rounds[0] ?? null;
  const latest = rounds[0] ?? null;
  const split = splitSummary(rows);
  const verdict = hundredDollarVerdict(rows, latest);
  const { ordered, isStale, resort } = useStableOrder(rows, keyOf, byAmount);

  /* ── Writes (never in the preview) ──────────────────────────────────── */

  const add = (title: string) => {
    if (preview) return;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(),
      framework: HUNDRED_FRAMEWORK,
      title,
      fields: {},
      status: "open",
      updatedAt: new Date().toISOString(),
    };
    ws().upsertPrioritization(item);
    log(HUNDRED_DOLLAR_ACTIONS.ITEM_ADDED, { title });
    announce(`Added ${title}`);
  };

  const rename = (row: PrioritizationItem, title: string) => {
    if (preview) return;
    const fresh = freshRows().find((x) => x.id === row.id);
    if (!fresh || fresh.title === title) return;
    ws().upsertPrioritization({ ...fresh, title, updatedAt: new Date().toISOString() });
  };

  /** Save a typed amount, capped (and said so); returns what was saved. */
  const setAmount = (row: PrioritizationItem, typed: number): number | null => {
    if (preview) return null;
    const current = freshRows();
    const fresh = current.find((x) => x.id === row.id);
    if (!fresh) return null;
    const { saved, note } = capAllocation(current, row.id, typed);
    setAllocNote(note ? { id: row.id, text: note } : null);
    if (allocationOf(fresh) === saved) return saved;
    ws().upsertPrioritization(withAllocation(fresh, saved, new Date().toISOString()));
    log(HUNDRED_DOLLAR_ACTIONS.ALLOCATION_CHANGED, { id: row.id, n: saved });
    return saved;
  };

  const remove = (row: PrioritizationItem) => {
    if (preview) return;
    if (allocNote?.id === row.id) setAllocNote(null);
    undoable({
      label: `Deleted “${row.title}”`,
      apply: () => {
        ws().removePrioritization(row.id);
        log(HUNDRED_DOLLAR_ACTIONS.ITEM_REMOVED, { id: row.id });
      },
      revert: () => ws().upsertPrioritization(row),
    });
    announce(`Deleted ${row.title}`);
  };

  const saveRound = (result: AllocationRoundResult) => {
    if (preview) return false;
    const ids = new Set(freshRows().map((x) => x.id));
    if (!result.items.some((x) => ids.has(x.id))) {
      // Refused: the kit keeps Save round available.
      toast.error("Every item in the round has since been deleted, so nothing was saved.");
      return false;
    }
    const dayProblem = roundDayProblem(roundDay, todayIso());
    if (dayProblem) {
      toast.error(`${dayProblem} Nothing was saved.`);
      return false;
    }
    const saved = allocationRoundFrom(result, {
      id: `allocationRound_${nanoid(8)}`,
      date: roundDay,
    });
    ws().upsertAllocationRound(saved);
    setPickedRound(saved.id);
    // Counts only, as everywhere a round goes: never who gave what.
    log(HUNDRED_DOLLAR_ACTIONS.ALLOCATION_CHANGED, {
      round: true,
      ballots: saved.ballots,
      items: saved.items.length,
      source: saved.source,
    });
    announce(hundredDollarVerdict(freshRows(), saved));
    return () => {
      ws().removeAllocationRound(saved.id);
    };
  };

  const deleteRound = (r: AllocationRound) => {
    if (preview) return;
    if (pickedRound === r.id) setPickedRound(null);
    undoable({
      label: `Deleted the round of ${roundLabel(r)}`,
      apply: () => ws().removeAllocationRound(r.id),
      revert: () => ws().upsertAllocationRound(r),
    });
    announce(`Deleted the round of ${roundLabel(r)}`);
  };

  /* ── Exports and prompts ────────────────────────────────────────────── */

  const markdown = useMemo(() => toMarkdown(rows, rounds), [rows, rounds]);

  const csvData = useMemo(() => {
    const team = new Map((latest ? teamAverages(latest) : []).map((a) => [a.itemId, a.mean]));
    return {
      headers: ["Item", "Agreed split", ...(latest ? ["Team average (latest round)"] : [])],
      rows: rows.map((it) => {
        const a = allocationOf(it);
        const mean = team.get(it.id);
        return [
          it.title,
          a === null ? "" : a,
          ...(latest
            ? [mean === undefined || mean === null ? "" : Math.round(mean * 10) / 10]
            : []),
        ];
      }),
    };
  }, [rows, latest]);

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
      toolName: "$100 Test",
      prompts: generateHundredDollarPrompts({ items: [...rows].sort(byAmount) }, workspace),
    }),
    [rows, workspace]
  );

  // A sheet signature, so a running round only changes when the items do.
  const sheetKey = rows.map((x) => `${x.id}|${x.title}`).join("\n");
  const sheet = useMemo(
    () => hundredDollarSheet(rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by the items only
    [sheetKey]
  );

  return (
    <ToolPageWrapper
      toolId="hundred-dollar-test"
      title="$100 Test"
      description="Split $100 across competing items: agree one split together, or let everyone split their own anonymously and compare the averages."
    >
      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: five themes for next quarter, the group&apos;s agreed split and one anonymous
            round of six people. It&apos;s a read-only preview: nothing is saved.
          </p>
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="100-dollar-test"
          csvData={csvData}
          jsonData={{ items: rows, rounds }}
          markdown={markdown}
          targetRef={exportRef}
        />
      </ActionRow>

      <p className="mb-4 text-sm font-medium text-text" data-testid="hundred-dollar-verdict">
        {verdict}
      </p>

      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KPI label="Items" value={String(rows.length)} />
          <KPI label="Given out" value={dollars(split.total)} />
          <KPI
            label="Left to give"
            value={dollars(split.remaining)}
            tone={split.remaining < -0.005 ? "danger" : split.full ? "ok" : "default"}
          />
        </div>
        {rows.length > 0 && split.given > 0 && !split.full && (
          <div
            role="status"
            className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
          >
            {split.remaining > 0
              ? `Give out the remaining ${dollars(split.remaining)}: the $100 Test only works when the whole budget is split.`
              : `The split is over budget by ${dollars(-split.remaining)}. Lower an item to bring it to $100.`}
          </div>
        )}

        <SectionCard title="Add item" icon={Plus}>
          <AddItemForm disabled={preview} onAdd={add} />
        </SectionCard>

        {rows.length === 0 ? (
          <EmptyState
            icon={Vote}
            action={<LoadExampleButton onLoad={() => setExample(buildExample())} />}
          >
            No items yet. Add two or more above, then split $100 between them, or load an example to
            see a team round beside an agreed split.
          </EmptyState>
        ) : (
          <SectionCard
            title="The agreed split"
            icon={Vote}
            actions={
              <ResetButton
                label="Clear all amounts"
                title="Clear every amount in the agreed split?"
                description="The items stay; each one's amount is cleared. Saved team rounds aren't touched."
                confirmLabel="Clear amounts"
                doneLabel="Cleared the agreed split"
                disabled={preview || split.given === 0}
                onReset={() => {
                  const before = freshRows();
                  beforeReset.current = before;
                  const now = new Date().toISOString();
                  for (const row of before) {
                    if (allocationOf(row) !== null) {
                      ws().upsertPrioritization(withoutAllocation(row, now));
                    }
                  }
                  setAllocNote(null);
                  log(HUNDRED_DOLLAR_ACTIONS.TEST_RESET, { items: before.length });
                }}
                onUndo={() => {
                  for (const row of beforeReset.current) ws().upsertPrioritization(row);
                }}
              />
            }
          >
            <p className="mb-3 text-sm text-sub">
              One $100 split the group agrees on together, or your own. Each amount is saved when
              you leave its box or press Enter, in whole dollars.
            </p>
            <ResortChip isStale={isStale} onResort={resort} what="Amounts" />
            <ul className="space-y-2" aria-label="Items, biggest amount first">
              {ordered.map((row) => (
                <ItemRow
                  key={row.id}
                  row={row}
                  note={allocNote?.id === row.id ? allocNote.text : null}
                  readOnly={preview}
                  onRename={(title) => rename(row, title)}
                  onAmount={(typed) => setAmount(row, typed)}
                  onDelete={() => remove(row)}
                />
              ))}
            </ul>
          </SectionCard>
        )}

        <SectionCard title="Ask the team" icon={Radio} contentClassName="space-y-3">
          <p className="text-sm text-sub">
            Everyone splits their own $100 across the items, anonymously. The round keeps only each
            item&apos;s total, how many people gave it something and how many gave it an amount in
            each band of the $100, never anyone&apos;s split or who answered. Averages show from 3
            answers; who backed what and the spread from 5.
          </p>
          <DayField
            label="Round held on"
            value={roundDay}
            max={today}
            problem={(d) => roundDayProblem(d, today)}
            onChange={setRoundDay}
            hint={roundDay !== today ? "Backdated" : "Paper rounds can be backdated."}
            disabled={preview}
          />
          <VoteRoundPanel
            tool="hundred-dollar-test"
            toolName="$100 Test"
            sheet={sheet}
            onSave={saveRound}
            blockedReason={
              preview
                ? "Clear the example to run a round with your team."
                : rows.length < 2
                  ? "Add at least two items to split between first, then run a round."
                  : null
            }
          />
        </SectionCard>

        {round && (
          <SectionCard title="Team results" icon={BarChart3} contentClassName="space-y-4">
            <RoundPicker
              rounds={rounds}
              selectedId={round.id}
              onSelect={(id) => setPickedRound(id)}
            />
            <p className="text-sm text-sub">
              {hundredDollarVerdict(rows, round)}
              {rounds.length === 1 && ` (${roundWhen(round)})`}
            </p>
            <TeamResults round={round} rows={rows} />
            <RoundHistory rounds={rounds} readOnly={preview} onDelete={deleteRound} />
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
}) {
  const colorClass =
    tone === "danger" ? "text-danger" : tone === "ok" ? "text-success" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs uppercase tracking-wider text-sub">{label}</div>
      <div className={`mt-1 font-data text-xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}
