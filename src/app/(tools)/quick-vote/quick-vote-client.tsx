"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { BarChart3, Hand, PenLine, Radio } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink } from "@/lib/stores/workspace-types";
import type { RoundResult } from "@/lib/realtime/vote-room/kinds";
import type { ChoiceRoundResult } from "@/lib/realtime/vote-room/choice";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { QUICK_VOTE_ACTIONS } from "@/lib/history/event-actions";
import { cheer } from "@/lib/celebrate/cheer";
import { generateQuickVotePrompts } from "@/lib/ai-prompts/quick-vote";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { focusAfterRemoval } from "@/app/(tools)/sprint-goal/focus";
import { toast } from "@/lib/utils/toast";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { presetById, type QuickVotePreset } from "@/lib/quick-vote/presets";
import {
  DEFAULT_PRESET_ID,
  currentDraft,
  draftEdited,
  draftFromPreset,
  hasDecimalComma,
  normalizeDraft,
  typedNumber,
  validateRoundDraft,
  type DraftField,
  type RoundDraft,
} from "@/lib/quick-vote/draft";
import { roundFor } from "@/lib/quick-vote/sheets";
import { POLL_LINK_PARAMS, readPollLink } from "@/lib/quick-vote/link";
import {
  guessVerdict,
  latestVerdict,
  normalizeResults,
  presetName,
  resultKind,
  resultSummary,
  savedDay,
  showsAgreement,
  type SavedResult,
  type StoredNumberResult,
} from "@/lib/quick-vote/results";
import {
  MAX_CUSTOM_PRESETS,
  normalizeCustomPresets,
  type CustomPreset,
} from "@/lib/quick-vote/state";
import {
  hydrateQuickVote,
  quickVoteReady,
  quickVoteState,
  setDraft,
  updateCustomPresets,
  updateResults,
  useQuickVote,
} from "@/lib/quick-vote/store";
import { buildExample, type QuickVoteExample } from "./example";
import { toMarkdown } from "./markdown";
import { composerSources, savedFromRound } from "./model";
import { DELETE_FORMAT_SELECTOR, PresetPicker } from "./preset-picker";
import { RoundComposer, addToList } from "./round-composer";
import { RunRound } from "./run-round";
import { DELETE_RESULT_SELECTOR, ResultsList } from "./results-list";
import { SaveFormatForm } from "./save-format-form";

const DEFAULT_PRESET = presetById(DEFAULT_PRESET_ID) as QuickVotePreset;
const FIELD_ORDER: DraftField[] = ["question", "options", "labels", "limit", "min", "max", "unit"];

const ws = () => useWorkspaceStore.getState();

/** Take a poll link's parameters off the address, so a reload doesn't set the poll up again. */
function dropPollLink(): void {
  try {
    const url = new URL(window.location.href);
    for (const key of POLL_LINK_PARAMS) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* no history API: the poll is set up all the same */
  }
}

/** The draft as stored now (the page's copy can be a render behind). */
const freshDraft = (fallback: RoundDraft) =>
  normalizeDraft(useQuickVote.getState().draft) ?? fallback;

/**
 * Quick Vote: a fast vote for any meeting. Pick a format (fist of five,
 * ROTI, a poll, dot voting, value poker …), set the question, then run it
 * in a live room (anonymous, totals only), count hands on one screen, or
 * use hold-up cards on phones. Saved rounds keep their totals only, can be
 * exported or sent to the Decision Log or the retro, and a guess or a
 * value vote takes its follow-up there. The example is a read-only preview.
 */
export function QuickVoteClient() {
  const [ready, setReady] = useState(quickVoteReady);
  useEffect(() => {
    let live = true;
    void hydrateQuickVote().finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const rawResults = useQuickVote((s) => s.results);
  const rawPresets = useQuickVote((s) => s.customPresets);
  const rawDraft = useQuickVote((s) => s.draft);
  const storedResults = useMemo(() => normalizeResults(rawResults), [rawResults]);
  const storedPresets = useMemo(() => normalizeCustomPresets(rawPresets), [rawPresets]);
  const draft = useMemo(() => currentDraft(rawDraft), [rawDraft]);

  const [example, setExample] = useState<QuickVoteExample | null>(null);
  const preview = example !== null;
  const results = example?.results ?? storedResults;
  const customPresets = example?.customPresets ?? storedPresets;
  const preset = presetById(draft.presetId) ?? DEFAULT_PRESET;
  const readOnly = preview || !ready;

  const check = useMemo(() => validateRoundDraft(draft), [draft]);
  const round = useMemo(() => (check.ok ? roundFor(check.values) : null), [check]);
  const errors = check.ok ? {} : check.errors;
  const firstProblem = check.ok ? null : (FIELD_ORDER.map((f) => errors[f]).find(Boolean) ?? null);

  const backlogItems = useWorkspaceStore((s) => s.backlogItems);
  const stories = useWorkspaceStore((s) => s.stories);
  const retroBoards = useWorkspaceStore((s) => s.retroBoards);
  const sources = useMemo(
    () => composerSources(backlogItems, stories, retroBoards),
    [backlogItems, stories, retroBoards]
  );

  const { log } = useHistoryLogger("quick-vote");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const formatsRef = useRef<HTMLUListElement>(null);

  /* ── The round being set up ─────────────────────────────────────────── */

  /** The draft `d`'s format, or saved format, starts with. */
  const baseOf = (d: RoundDraft): RoundDraft => {
    const custom = d.customId ? customPresets.find((c) => c.id === d.customId) : undefined;
    if (custom) return { ...custom.draft, customId: custom.id };
    return draftFromPreset(presetById(d.presetId) ?? DEFAULT_PRESET);
  };

  /** Replace the round being set up; when the host had changed it, Undo brings it back. */
  const replaceDraft = (next: RoundDraft, label: string) => {
    const before = freshDraft(draft);
    if (!draftEdited(before, baseOf(before))) {
      setDraft(next);
      return;
    }
    undoable({ label, apply: () => setDraft(next), revert: () => setDraft(before) });
  };

  const pick = (p: QuickVotePreset) => {
    if (readOnly) return;
    if (draft.presetId === p.id && draft.customId === null) return;
    replaceDraft(draftFromPreset(p), `Set up ${p.name} in place of your round`);
    announce(`${p.name} set up. ${p.blurb}`);
  };

  // A link that asks for a poll (Picker's "Vote in Quick Vote" sends its
  // shortlist) sets one up once the saved rounds are in, checked and capped
  // (lib/quick-vote/link); a round the host had typed comes back with Undo.
  const linkRead = useRef(false);
  useEffect(() => {
    if (!ready || linkRead.current) return;
    linkRead.current = true;
    const link = readPollLink(window.location.search);
    if (!link) return;
    dropPollLink();
    const poll = presetById("poll") as QuickVotePreset;
    const base = draftFromPreset(poll);
    replaceDraft(
      {
        ...base,
        question: link.question ?? base.question,
        optionsText: link.options.join("\n"),
      },
      "Set up the poll from the link in place of your round"
    );
    announce(
      link.options.length > 0
        ? `Poll set up from the link, with ${link.options.length} ${
            link.options.length === 1 ? "option" : "options"
          }.`
        : "Poll set up from the link."
    );
    // Once, when the saved rounds are in: replaceDraft reads the store itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const pickCustom = (c: CustomPreset) => {
    if (readOnly) return;
    if (draft.customId === c.id) return;
    replaceDraft({ ...c.draft, customId: c.id }, `Set up “${c.name}” in place of your round`);
    announce(`${c.name} set up.`);
  };

  const change = (patch: Partial<RoundDraft>) => {
    if (readOnly) return;
    setDraft({ ...freshDraft(draft), ...patch });
  };

  /** Change the options list with Undo (Amr's suggestions, a list from the backlog). */
  const changeOptions = (next: (current: string) => string, label: string) => {
    if (readOnly) return;
    const before = freshDraft(draft);
    const text = next(before.optionsText);
    if (text === before.optionsText) {
      announce("Those options are already in the list.");
      return;
    }
    undoable({
      label,
      kind: "success",
      apply: () => setDraft({ ...freshDraft(before), optionsText: text }),
      revert: () => setDraft({ ...freshDraft(before), optionsText: before.optionsText }),
    });
  };

  const maxOptions =
    preset.kind === "rank" ? VOTE_LIMITS.maxRankOptions : VOTE_LIMITS.maxChoiceOptions;

  const addOptions = (list: string[]) =>
    changeOptions(
      (current) => addToList(current, list, maxOptions),
      list.length === 1 ? `Added the option “${list[0]}”` : `Added ${list.length} options`
    );

  const fillFromList = (list: string[], from: string) =>
    changeOptions(() => addToList("", list, maxOptions), `Filled the options from ${from}`);

  const startOver = () => {
    if (readOnly) return;
    replaceDraft(baseOf(freshDraft(draft)), "Started the round over");
    log(QUICK_VOTE_ACTIONS.ROUND_RESET, { preset: preset.id });
    announce("Back to the format's own question and answers.");
  };

  const saveFormat = (name: string) => {
    if (readOnly) return;
    const id = `qvf-${nanoid(8)}`;
    const saved: CustomPreset = {
      id,
      name,
      createdAt: new Date().toISOString(),
      draft: { ...freshDraft(draft), customId: id },
    };
    updateCustomPresets((list) => [...list, saved]);
    setDraft(saved.draft);
    log(QUICK_VOTE_ACTIONS.POLL_SAVED, { preset: saved.draft.presetId, kind: preset.kind });
    announce(`Saved “${name}” under Your formats.`);
  };

  const deleteFormat = (c: CustomPreset) => {
    if (readOnly) return;
    const index = customPresets.findIndex((x) => x.id === c.id);
    removeWithUndo<CustomPreset>({
      label: `Deleted the format “${c.name}”`,
      update: updateCustomPresets,
      match: (x) => x.id === c.id,
    });
    if (draft.customId === c.id) setDraft({ ...freshDraft(draft), customId: null });
    log(QUICK_VOTE_ACTIONS.POLL_REMOVED, { preset: c.draft.presetId });
    // The pressed button went with its row: the next format's delete takes
    // focus, or, with none left, the format set up now.
    focusAfterRemoval(
      formatsRef,
      DELETE_FORMAT_SELECTOR,
      Math.max(0, index),
      () =>
        gridRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
        gridRef.current?.querySelector<HTMLElement>("button")
    );
  };

  /* ── Results ────────────────────────────────────────────────────────── */

  /** File a closed round; returns the saved result, or null when it can't be kept. */
  const fileResult = (result: RoundResult): SavedResult | null => {
    if (preview) {
      toast.error("Clear the example first: nothing from it is saved.");
      return null;
    }
    const saved = savedFromRound(result, preset.id);
    if (!saved) {
      toast.error("This round couldn't be saved here.");
      return null;
    }
    updateResults((list) => [saved, ...list]);
    // Counts only, as everywhere a round goes: never who answered what.
    log(QUICK_VOTE_ACTIONS.RESULT_SAVED, {
      preset: saved.presetId,
      kind: resultKind(saved.result),
      ballots: saved.result.ballots,
      source: saved.result.source,
    });
    if (showsAgreement(saved)) cheer("quick-vote", "agreed");
    announce(`Saved. ${resultSummary(saved)}`);
    return saved;
  };
  const unfile = (id: string) => updateResults((list) => list.filter((x) => x.id !== id));

  /** The kit's Save round: the kit shows "Saved the round" with Undo. */
  const saveRound = (result: RoundResult): false | (() => void) => {
    const saved = fileResult(result);
    return saved ? () => unfile(saved.id) : false;
  };

  /** Count hands' Save round: no kit toast, so the Undo is ours. */
  const saveCounts = (result: ChoiceRoundResult, onUndone: () => void): boolean => {
    const saved = fileResult(result);
    if (!saved) return false;
    undoable({
      label: "Saved the round",
      kind: "success",
      // Filed just above, with its history line and Amr's moment in the same tick.
      apply: () => {},
      // The count form drops its "Saved" line and takes its counts back.
      revert: () => {
        unfile(saved.id);
        onUndone();
      },
    });
    return true;
  };

  const deleteResult = (saved: SavedResult) => {
    if (readOnly) return;
    const index = results.findIndex((x) => x.id === saved.id);
    removeWithUndo<SavedResult>({
      label: `Deleted the result “${saved.result.title}”`,
      update: updateResults,
      match: (x) => x.id === saved.id,
    });
    // The next row's delete takes focus, or, with none left, Load an example.
    focusAfterRemoval(resultsRef, DELETE_RESULT_SELECTOR, Math.max(0, index), () =>
      exportRef.current?.querySelector<HTMLElement>("button")
    );
  };

  const getLinks = (id: string) => quickVoteState().results.find((x) => x.id === id)?.sentTo;
  const setLinks = (
    id: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    if (preview) return;
    updateResults((list) =>
      list.map((x) => (x.id === id ? { ...x, sentTo: update(x.sentTo) } : x))
    );
  };

  const realAnswer = (saved: SavedResult, typed: string): string | null => {
    if (readOnly) return "Clear the example first.";
    if (!typed.trim()) return "Type the real answer.";
    if (hasDecimalComma(typed)) return "Use a point for decimals, like 14.5.";
    const n = typedNumber(typed);
    if (n === undefined || !Number.isFinite(n) || Math.abs(n) > 1e9) {
      return "The real answer needs to be a number.";
    }
    updateResults((list) => list.map((x) => (x.id === saved.id ? { ...x, realAnswer: n } : x)));
    announce(guessVerdict(saved.result as StoredNumberResult, n));
    return null;
  };

  const saveValue = (saved: SavedResult, value: number) => {
    if (readOnly || !saved.backlogItemId) return;
    const item = (ws().backlogItems ?? []).find((x) => x.id === saved.backlogItemId);
    if (!item) {
      toast.error("That backlog item has since been deleted, so nothing was saved.");
      return;
    }
    const before = saved.valueSaved;
    const mark = (v: number | undefined) =>
      updateResults((list) =>
        list.map((x) => {
          if (x.id !== saved.id) return x;
          const next = { ...x };
          if (v === undefined) delete next.valueSaved;
          else next.valueSaved = v;
          return next;
        })
      );
    undoable({
      label: `Set the business value of “${item.name}” to ${value}`,
      kind: "success",
      apply: () => {
        ws().upsertBacklogItem({
          ...item,
          businessValue: value,
          updatedAt: new Date().toISOString(),
        });
        mark(value);
      },
      revert: () => {
        ws().upsertBacklogItem(item);
        mark(before);
      },
    });
  };

  const itemName = (id: string) => sources.items.find((x) => x.id === id)?.name ?? null;

  /* ── Export and prompts ─────────────────────────────────────────────── */

  const markdown = useMemo(() => toMarkdown(results, customPresets), [results, customPresets]);
  const csvData = useMemo(
    () => ({
      headers: ["Saved", "Format", "Question", "People", "How", "Result"],
      rows: results.map((s) => [
        savedDay(s.savedAt),
        presetName(s),
        s.result.title,
        s.result.ballots,
        s.result.source === "live" ? "Live room" : "Counted by hand",
        resultSummary(s),
      ]),
    }),
    [results]
  );
  const promptConfig = useMemo(
    () => ({ toolName: "Quick Vote", prompts: generateQuickVotePrompts({ results }) }),
    [results]
  );

  const blockedReason = preview
    ? "Clear the example to run a round with your team."
    : !ready
      ? "Loading your saved rounds…"
      : firstProblem
        ? `Finish setting up the round first: ${firstProblem}`
        : null;

  return (
    <ToolPageWrapper
      toolId="quick-vote"
      title="Quick Vote"
      description="Quick polls for any meeting, live in a room or on hold-up phone cards."
    >
      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: a week of meetings&apos; votes, totals only. It&apos;s a read-only preview:
            nothing is saved.
          </p>
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="quick-vote"
          csvData={csvData}
          jsonData={{ results, customPresets }}
          markdown={markdown}
          targetRef={exportRef}
        />
      </ActionRow>

      <p className="mb-4 text-sm font-medium text-text" data-testid="quick-vote-verdict">
        {latestVerdict(results)}
      </p>

      {!ready ? (
        <WorkspaceLoading about="Quick Vote runs a fast vote in any meeting: live, by hand or on phone cards.">
          Loading your saved rounds…
        </WorkspaceLoading>
      ) : (
        <div className="space-y-4">
          <SectionCard title="Pick a format" icon={Hand}>
            <PresetPicker
              presetId={draft.presetId}
              customId={draft.customId}
              customPresets={customPresets}
              onPick={pick}
              onPickCustom={pickCustom}
              onDeleteCustom={deleteFormat}
              readOnly={readOnly}
              gridRef={gridRef}
              formatsRef={formatsRef}
            />
          </SectionCard>

          <SectionCard title={`Set up: ${preset.name}`} icon={PenLine} contentClassName="space-y-4">
            <RoundComposer
              key={`${draft.presetId}:${draft.customId ?? ""}`}
              draft={draft}
              preset={preset}
              errors={errors}
              onChange={change}
              onAddOptions={addOptions}
              onUseList={fillFromList}
              onStartOver={startOver}
              sources={sources}
              readOnly={readOnly}
            />
            <SaveFormatForm
              taken={customPresets.map((c) => c.name)}
              roundProblem={firstProblem}
              full={customPresets.length >= MAX_CUSTOM_PRESETS}
              disabled={readOnly}
              onSave={saveFormat}
            />
          </SectionCard>

          <SectionCard title="Run it" icon={Radio}>
            <RunRound
              preset={preset}
              round={round}
              blockedReason={blockedReason}
              onSave={saveRound}
              onSaveCounts={saveCounts}
              onCards={() =>
                log(QUICK_VOTE_ACTIONS.ROUND_STARTED, {
                  preset: preset.id,
                  kind: preset.kind,
                  mode: "cards",
                })
              }
              readOnly={readOnly}
            />
          </SectionCard>

          <div ref={exportRef}>
            <SectionCard title="Results" icon={BarChart3}>
              {results.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  action={<LoadExampleButton onLoad={() => setExample(buildExample())} />}
                >
                  No saved rounds yet. Run a round and press Save round: only its totals are kept,
                  never who answered what. Or load an example to see a week of results.
                </EmptyState>
              ) : (
                <ResultsList
                  listRef={resultsRef}
                  results={results}
                  readOnly={readOnly}
                  itemName={itemName}
                  onDelete={deleteResult}
                  onLinksChange={setLinks}
                  getLinks={getLinks}
                  onRealAnswer={realAnswer}
                  onSaveValue={saveValue}
                />
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </ToolPageWrapper>
  );
}
