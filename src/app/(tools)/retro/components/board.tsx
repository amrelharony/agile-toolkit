"use client";

/**
 * The live retro board. Owns the per-action history logging + sonification,
 * the countdown timer interval, the k-means theme clustering (once the board
 * crosses CLUSTER_MIN_CARDS), and the export path. All mutations flow through
 * the parent-supplied `onUpdate` functional updater so the synced workspace
 * doc stays the single source of truth.
 *
 * Facilitator mode: in the Vote phase "Voting as" picks who the next vote
 * belongs to, each person with their own MAX_VOTES (`votesBy`); "Me" keeps
 * the single `userVotes` budget. The facilitator can step back a phase
 * (votes are kept) and add a card in any phase.
 */

import { useState, useCallback, useEffect, useId, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { RotateCcw, Eraser } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportButton } from "@/components/shared/export-button";
import { ExampleNotice, hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { generateRetroPrompts } from "@/lib/ai-prompts/retro";
import { emit as sonify } from "@/lib/sonification/emit";
import { todayLocalISO } from "@/lib/utils/formatters";
import { type HistoryLogger } from "@/lib/history/use-history-logger";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import { kMeansAuto } from "@/lib/analytics/clustering";
import { undoable } from "@/lib/utils/undoable";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { RetroCard as StoredRetroCard } from "@/lib/stores/workspace-types";
import type { HandoffLink } from "@/lib/handoffs/types";
import { type BoardState, MAX_VOTES, PHASES } from "../types";
import { carriedOverCard } from "../archive";
import {
  makeId,
  CLUSTER_MIN_CARDS,
  CLUSTER_COLORS,
  extractCardFeatures,
  buildExportJson,
  removeCardWithGroup,
  restoreRemovedCards,
  voterKey,
  voterNames,
  votesCastBy,
  withoutVotesBy,
} from "../helpers";
import { PhaseIndicator } from "./phase-indicator";
import { TimerWidget } from "./timer-widget";
import { RetroColumnPanel } from "./retro-column-panel";
import { LastRetroActions } from "./last-retro-actions";
import { SINGLE_VOTER, VoterPicker } from "./voter-picker";
import { toMarkdown } from "../markdown";
import { themed, tint } from "@/lib/utils/theme-color";

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function Board({
  state,
  onUpdate,
  onReset,
  onClearExample,
  logger,
}: {
  state: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  onReset: () => void;
  /** Removes the example cards; the notice shows while any are on the board. */
  onClearExample?: () => void;
  logger: HistoryLogger;
}) {
  const { log } = logger;
  const [confirmNewOpen, setConfirmNewOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const announce = useAnnounce();

  // Team names for "Voting as" and the assignee field (Actions phase).
  const assigneeListId = useId();
  const teamNames = useWorkspaceStore(
    useShallow((s) => Array.from(new Set((s.teamMembers ?? []).map((m) => (m.name ?? "").trim()))))
  ).filter(Boolean);

  // Who the next vote belongs to. A name that has left the list (a voter
  // typed in before Clear Board) falls back to "Me".
  const [voter, setVoter] = useState<string>(SINGLE_VOTER);
  const voters = voterNames(teamNames, state.votesBy);
  const activeVoter =
    (voter && voters.find((n) => n.toLowerCase() === voter.trim().toLowerCase())) || SINGLE_VOTER;
  const votesUsed = activeVoter ? votesCastBy(state.votesBy, activeVoter) : state.userVotes;
  const hasVotes = state.cards.some((c) => c.votes > 0);

  // Timer tick — only depend on timerRunning, not timerSeconds, to avoid
  // interval churn on every tick. Functional updater accesses latest state.
  useEffect(() => {
    if (!state.timerRunning) return;
    const id = setInterval(() => {
      onUpdate((prev) => ({
        ...prev,
        timerSeconds: Math.max(0, prev.timerSeconds - 1),
        timerRunning: prev.timerSeconds <= 1 ? false : prev.timerRunning,
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [state.timerRunning, onUpdate]);

  const handleAdvancePhase = useCallback(() => {
    // BUG-T7-retro-1: compute the transition BEFORE dispatch so we
    // never depend on an updater closure variable that React 18 may
    // re-invoke (StrictMode) or invoke at unspecified timing.
    const idx = PHASES.findIndex((p) => p.key === state.phase);
    const next = PHASES[idx + 1];
    if (!next) return;
    const transition = { from: state.phase, to: next.key };
    sonify("retro", "phase-advance");
    onUpdate((prev) => {
      // Re-check inside the updater to handle a concurrent advance.
      const i = PHASES.findIndex((p) => p.key === prev.phase);
      const nx = PHASES[i + 1];
      if (!nx) return prev;
      return { ...prev, phase: nx.key };
    });
    log(RETRO_ACTIONS.PHASE_ADVANCED, transition);
    announce(`${next.label} phase. ${next.description}.`);
  }, [onUpdate, log, announce, state.phase]);

  // Step back one phase. Nothing is undone: votes, groups and actions stay.
  // Not logged: PHASE_ADVANCED is a forward milestone.
  const handleBackPhase = useCallback(() => {
    const idx = PHASES.findIndex((p) => p.key === state.phase);
    const back = idx > 0 ? PHASES[idx - 1] : undefined;
    if (!back) return;
    onUpdate((prev) => {
      const i = PHASES.findIndex((p) => p.key === prev.phase);
      const pv = i > 0 ? PHASES[i - 1] : undefined;
      return pv ? { ...prev, phase: pv.key } : prev;
    });
    announce(`Back to the ${back.label} phase.${hasVotes ? " Votes cast so far are kept." : ""}`);
  }, [onUpdate, announce, state.phase, hasVotes]);

  const handleAddCard = useCallback(
    (columnKey: string, text: string) => {
      sonify("retro", "card-add");
      const cardId = makeId();
      onUpdate((prev) => ({
        ...prev,
        cards: [
          ...prev.cards,
          {
            id: cardId,
            columnKey,
            text,
            votes: 0,
            groupedWith: null,
            isActionItem: false,
            assignee: "",
            discussing: false,
          },
        ],
      }));
      log(RETRO_ACTIONS.CARD_ADDED, { cardId, columnKey, text });
    },
    [onUpdate, log]
  );

  const handleVote = useCallback(
    (id: string) => {
      // BUG-T7-retro-1: compute the vote count + branch BEFORE dispatch.
      // The previous pattern wrote `nextVoteCount` from inside an updater
      // closure and read it synchronously after dispatch — React 18
      // doesn't guarantee eager invocation of updaters.
      if (state.phase !== "vote") return;
      // "Me" spends `userVotes`; a picked person spends their own budget.
      const who = activeVoter;
      const used = who ? votesCastBy(state.votesBy, who) : state.userVotes;
      if (used >= MAX_VOTES) return;
      const card = state.cards.find((c) => c.id === id);
      const nextVoteCount = (card?.votes ?? 0) + 1;
      sonify("retro", "vote");
      onUpdate((prev) => {
        if (prev.phase !== "vote") return prev;
        const cards = prev.cards.map((c) => (c.id === id ? { ...c, votes: c.votes + 1 } : c));
        if (!who) {
          if (prev.userVotes >= MAX_VOTES) return prev;
          return { ...prev, userVotes: prev.userVotes + 1, cards };
        }
        const cast = votesCastBy(prev.votesBy, who);
        if (cast >= MAX_VOTES) return prev;
        return {
          ...prev,
          cards,
          votesBy: { ...prev.votesBy, [voterKey(prev.votesBy, who)]: cast + 1 },
        };
      });
      log(RETRO_ACTIONS.CARD_VOTED, { cardId: id, voteCount: nextVoteCount });
      if (used + 1 >= MAX_VOTES) {
        announce(
          who ? `${who} has used all ${MAX_VOTES} votes.` : `You have used all ${MAX_VOTES} votes.`
        );
      }
    },
    [onUpdate, log, announce, activeVoter, state.phase, state.userVotes, state.votesBy, state.cards]
  );

  // A voter typed in by the facilitator (no team roster). Kept on the board
  // with 0 votes so the name survives a reload, then picked.
  const handleAddVoter = useCallback(
    (name: string) => {
      const clean = name.trim();
      if (!clean) return;
      onUpdate((prev) => {
        const key = voterKey(prev.votesBy, clean);
        if (prev.votesBy && Object.prototype.hasOwnProperty.call(prev.votesBy, key)) return prev;
        return { ...prev, votesBy: { ...prev.votesBy, [clean]: 0 } };
      });
      setVoter(clean);
    },
    [onUpdate]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const card = state.cards.find((c) => c.id === id);
      if (!card) return;
      // The card goes with every card grouped under it. Keep the board as it
      // was so Undo can put them all back in place, still grouped.
      const snapshot = state.cards;
      const { removed } = removeCardWithGroup(snapshot, id);
      const cascadedCount = removed.size - 1;
      undoable({
        label: `Deleted “${shortName(card.text)}”`,
        description:
          cascadedCount > 0
            ? `And ${cascadedCount} card${cascadedCount === 1 ? "" : "s"} grouped under it.`
            : undefined,
        apply: () => {
          onUpdate((prev) => ({ ...prev, cards: removeCardWithGroup(prev.cards, id).cards }));
          log(RETRO_ACTIONS.CARD_REMOVED, { cardId: id, cascadedCount });
        },
        revert: () =>
          onUpdate((prev) => ({
            ...prev,
            cards: restoreRemovedCards(prev.cards, snapshot, removed),
          })),
      });
    },
    [onUpdate, log, state.cards]
  );

  const handleGroup = useCallback(
    (id: string, parentId: string | null) => {
      // Track which branch the updater took so we can log post-commit.
      // Use distinct nullable refs instead of a single union variable so
      // TS's control-flow analysis (which doesn't cross closures) doesn't
      // narrow the variable to its initial literal.
      let didGroup: { sourceId: string; targetId: string } | null = null;
      let didUngroup: { cardId: string } | null = null;
      onUpdate((prev) => {
        if (parentId === null) {
          didUngroup = { cardId: id };
          return {
            ...prev,
            cards: prev.cards.map((c) => (c.id === id ? { ...c, groupedWith: null } : c)),
          };
        }
        // Reject self-grouping and reject grouping under a card that doesn't
        // exist or sits in another column. Walk the parent chain to also
        // reject cycles — without this, an imported state can produce a
        // groupedWith loop that the renderer hides but every consumer
        // (export, AI prompt, multiplayer sync) trips over.
        const child = prev.cards.find((c) => c.id === id);
        const parent = prev.cards.find((c) => c.id === parentId);
        if (!child || !parent || parent.id === id) return prev;
        if (parent.columnKey !== child.columnKey) return prev;
        let cursor: string | null = parent.groupedWith;
        const seen = new Set<string>([parent.id]);
        while (cursor) {
          if (cursor === id || seen.has(cursor)) return prev;
          seen.add(cursor);
          cursor = prev.cards.find((c) => c.id === cursor)?.groupedWith ?? null;
        }
        didGroup = { sourceId: id, targetId: parentId };
        return {
          ...prev,
          cards: prev.cards.map((c) => (c.id === id ? { ...c, groupedWith: parentId } : c)),
        };
      });
      if (didGroup) log(RETRO_ACTIONS.CARDS_GROUPED, didGroup);
      else if (didUngroup) log(RETRO_ACTIONS.CARDS_UNGROUPED, didUngroup);
    },
    [onUpdate, log]
  );

  const handleToggleAction = useCallback(
    (id: string) => {
      // BUG-T7-retro-1: compute next value before dispatch.
      const card = state.cards.find((c) => c.id === id);
      if (!card) return;
      const nextIsActionItem = !card.isActionItem;
      onUpdate((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, isActionItem: !c.isActionItem } : c)),
      }));
      log(RETRO_ACTIONS.ACTION_TOGGLED, { cardId: id, isActionItem: nextIsActionItem });
    },
    [onUpdate, log, state.cards]
  );

  const handleAssigneeChange = useCallback(
    (id: string, val: string) => {
      onUpdate((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, assignee: val } : c)),
      }));
    },
    [onUpdate]
  );

  const handleToggleDiscussing = useCallback(
    (id: string) => {
      onUpdate((prev) => {
        if (prev.phase !== "discuss") return prev;
        const target = prev.cards.find((c) => c.id === id);
        if (!target) return prev;
        const next = !target.discussing;
        return {
          ...prev,
          // Toggling a card "into" discussion focuses just that one — clear any
          // others so the highlight ring stays meaningful at a glance.
          cards: prev.cards.map((c) =>
            c.id === id
              ? { ...c, discussing: next }
              : next && c.discussing
                ? { ...c, discussing: false }
                : c
          ),
        };
      });
    },
    [onUpdate]
  );

  // Where an action was sent. Read fresh through onUpdate, like every edit.
  const handleLinksChange = useCallback(
    (id: string, update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      onUpdate((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, sentTo: update(c.sentTo) } : c)),
      }));
    },
    [onUpdate]
  );

  // Copy an action from the last retro onto this board as an action item.
  // Once per action: a second click while the first is on the board is a no-op.
  const handleCarryOver = useCallback(
    (action: StoredRetroCard) => {
      const card = carriedOverCard(
        action,
        state.format.columns.map((c) => c.key),
        makeId()
      );
      undoable({
        label: `Carried over “${shortName(action.text)}”`,
        apply: () => {
          onUpdate((prev) =>
            prev.cards.some((c) => c.carriedFrom === action.id)
              ? prev
              : { ...prev, cards: [...prev.cards, card] }
          );
          log(RETRO_ACTIONS.CARD_ADDED, {
            cardId: card.id,
            columnKey: card.columnKey,
            text: card.text,
            carriedFrom: action.id,
          });
        },
        revert: () =>
          onUpdate((prev) => ({ ...prev, cards: prev.cards.filter((c) => c.id !== card.id) })),
      });
    },
    [onUpdate, log, state.format.columns]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Retrospective Board",
      prompts: generateRetroPrompts({
        formatName: state.format.name,
        columns: state.format.columns,
        cards: state.cards,
      }),
    }),
    [state.format, state.cards]
  );

  // ── Phase-15: lightweight theme clustering across all cards ────────
  // Only kicks in once the board reaches CLUSTER_MIN_CARDS — small boards
  // get nothing rather than misleading 1-card "themes". Memoised on the
  // text+id signature so card edits, additions, and removals all retrigger
  // exactly once per tick.
  const clusters = useMemo(() => {
    if (state.cards.length < CLUSTER_MIN_CARDS) return null;
    const features = state.cards.map((c) => extractCardFeatures(c.text));
    const result = kMeansAuto(features);
    const byCardId: Record<string, number> = {};
    state.cards.forEach((c, i) => {
      byCardId[c.id] = result.labels[i] ?? -1;
    });
    const counts = new Array(result.k).fill(0) as number[];
    for (const lbl of result.labels) {
      if (lbl >= 0 && lbl < result.k) counts[lbl]++;
    }
    return { byCardId, counts, k: result.k };
  }, [state.cards]);

  // Exports read only the format and cards, so the timer's per-second ticks
  // don't rebuild them.
  const markdown = useMemo(
    () => toMarkdown({ format: state.format, cards: state.cards }),
    [state.format, state.cards]
  );
  const exportJson = useMemo(
    () => buildExportJson({ format: state.format, cards: state.cards }),
    [state.format, state.cards]
  );

  // Everyone's votes go too, "Me" and each person's.
  const clearBoard = useCallback(() => {
    onUpdate((prev) => ({
      ...withoutVotesBy(prev),
      cards: [],
      userVotes: 0,
      phase: "write",
      timerRunning: false,
      timerSeconds: 300,
    }));
  }, [onUpdate]);

  // Both resets discard every card. An empty board has nothing to lose, so
  // they act at once; otherwise they confirm first.
  const cardCount = state.cards.length;
  const cardsLabel = `${cardCount} card${cardCount !== 1 ? "s" : ""}`;
  // Example cards aren't kept under Past retros, so only the team's own count.
  const ownCount = state.cards.filter((c) => !isExampleId(c.id)).length;
  const ownCardsLabel = `${ownCount} card${ownCount !== 1 ? "s" : ""}`;
  const requestNewRetro = () => {
    if (ownCount === 0) onReset();
    else setConfirmNewOpen(true);
  };
  const requestClearBoard = () => {
    if (cardCount === 0) clearBoard();
    else setConfirmClearOpen(true);
  };
  // A confirmed clear can be undone: the cards, votes (each person's too) and
  // phase come back. Cards and voters added since the clear are kept.
  const confirmClearBoard = () => {
    const before = state;
    undoable({
      label: `Cleared ${cardsLabel}`,
      apply: clearBoard,
      revert: () =>
        onUpdate((prev) => {
          const ids = new Set(before.cards.map((c) => c.id));
          const restored: BoardState = {
            ...prev,
            cards: [...before.cards, ...prev.cards.filter((c) => !ids.has(c.id))],
            userVotes: before.userVotes,
            phase: before.phase,
          };
          return before.votesBy || prev.votesBy
            ? { ...restored, votesBy: { ...prev.votesBy, ...before.votesBy } }
            : restored;
        }),
    });
  };

  const totalCards = state.cards.filter((c) => c.groupedWith === null).length;
  const actionCount = state.cards.filter((c) => c.isActionItem).length;
  const colCount = state.format.columns.length;

  const gridClass =
    colCount <= 2
      ? "grid-cols-1 sm:grid-cols-2"
      : colCount === 3
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        : colCount === 4
          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

  return (
    <ToolPageWrapper
      toolId="retro"
      title={`Retro Board — ${state.format.name}`}
      description={state.format.description}
      category="Ceremonies"
    >
      {onClearExample && hasExampleItems(state.cards) && <ExampleNotice onClear={onClearExample} />}
      <div className="space-y-5">
        {/* ── Board Header ─────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <PhaseIndicator
              current={state.phase}
              onAdvance={handleAdvancePhase}
              onBack={handleBackPhase}
            />
            <div className="flex items-center gap-3 text-xs text-sub">
              <span>{totalCards} cards</span>
              {state.phase === "vote" && (
                <span className="text-accent font-semibold">
                  {activeVoter
                    ? `${MAX_VOTES - votesUsed} votes remaining for ${activeVoter}`
                    : `${MAX_VOTES - state.userVotes} votes remaining`}
                </span>
              )}
              {state.phase === "actions" && actionCount > 0 && (
                <span className="text-accent-green font-semibold">
                  {actionCount} action item{actionCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TimerWidget
              seconds={state.timerSeconds}
              running={state.timerRunning}
              onToggle={() => onUpdate((prev) => ({ ...prev, timerRunning: !prev.timerRunning }))}
              onReset={() =>
                onUpdate((prev) => ({
                  ...prev,
                  timerSeconds: 300,
                  timerRunning: false,
                }))
              }
              onChange={(s) =>
                onUpdate((prev) => ({
                  ...prev,
                  timerSeconds: s,
                  timerRunning: false,
                }))
              }
            />
          </div>
        </div>

        {/* ── Phase hint ───────────────────────────────────── */}
        <div className="text-xs text-sub px-1">
          {PHASES.find((p) => p.key === state.phase)?.description}
          {state.phase === "discuss" && (
            <span className="ml-2 text-accent">
              Cards sorted by votes — click a card to mark it as discussing.
            </span>
          )}
          {state.phase === "write" && hasVotes && (
            <span className="ml-2 text-accent">Votes cast so far are kept.</span>
          )}
        </div>

        {/* ── Voting as (facilitator mode, Vote phase) ─────── */}
        {state.phase === "vote" && (
          <VoterPicker
            names={voters}
            votesBy={state.votesBy}
            voter={activeVoter}
            onVoterChange={setVoter}
            showAddVoter={teamNames.length === 0}
            onAddVoter={handleAddVoter}
          />
        )}

        {/* ── Auto-detected themes (k-means clustering) ────── */}
        {clusters && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-text">Auto-detected themes</span>
              <span className="text-sub">
                {clusters.k} cluster{clusters.k !== 1 ? "s" : ""} across {state.cards.length} cards
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {clusters.counts.map((count, i) => {
                const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded-md border"
                    style={{
                      color: themed(color),
                      borderColor: tint(color, 40),
                      background: tint(color, 8),
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: themed(color) }} />
                    Theme {i + 1}: {count} card{count !== 1 ? "s" : ""}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Last retro's actions (Write phase) ───────────── */}
        {state.phase === "write" && (
          <LastRetroActions
            previousRetroId={state.previousRetroId}
            cards={state.cards}
            onCarryOver={handleCarryOver}
          />
        )}

        {/* ── Columns ──────────────────────────────────────── */}
        <div className={`grid ${gridClass} gap-4`}>
          {state.format.columns.map((col) => {
            const colCards = state.cards.filter((c) => c.columnKey === col.key);
            return (
              <RetroColumnPanel
                key={col.key}
                column={col}
                cards={colCards}
                allCards={state.cards}
                phase={state.phase}
                votesUsed={votesUsed}
                clusterByCardId={clusters?.byCardId}
                onAdd={handleAddCard}
                onVote={handleVote}
                onDelete={handleDelete}
                onGroup={handleGroup}
                onToggleAction={handleToggleAction}
                onAssigneeChange={handleAssigneeChange}
                onToggleDiscussing={handleToggleDiscussing}
                onLinksChange={handleLinksChange}
                assigneeListId={teamNames.length > 0 ? assigneeListId : undefined}
              />
            );
          })}
        </div>

        {state.phase === "actions" && teamNames.length > 0 && (
          <datalist id={assigneeListId}>
            {teamNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}

        {/* ── Footer actions ───────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <AiPromptGenerator config={promptConfig} />
          {/* The user's LOCAL date in the filename: `toISOString()` is UTC and
              stamps "tomorrow" for users west of UTC in their evening. */}
          <ExportButton
            filename={`retro-${state.format.id}-${todayLocalISO()}`}
            markdown={markdown}
            shareState={{ format: state.format, cards: state.cards }}
            jsonData={exportJson}
          />
          <Button
            onClick={requestNewRetro}
            variant="ghost"
            className="text-sub hover:text-status-red hover:bg-status-red/10"
          >
            <RotateCcw className="w-4 h-4 mr-2" /> New Retro
          </Button>
          <Button onClick={requestClearBoard} variant="ghost" className="text-sub hover:text-sub">
            <Eraser className="w-4 h-4 mr-2" /> Clear Board
          </Button>
          <span className="ml-auto text-xs text-sub">{state.format.name} · Local session</span>
        </div>
      </div>

      <ConfirmDialog
        open={confirmNewOpen}
        onOpenChange={setConfirmNewOpen}
        title="Start a new retro?"
        description={`This ${state.format.name} board and its ${ownCardsLabel} move to Past retros, below the format picker, and you start a new board.`}
        confirmLabel="Start new retro"
        onConfirm={onReset}
      />
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear all cards?"
        description={`All ${cardsLabel} and their votes will be removed and the board goes back to the Write phase.`}
        confirmLabel="Clear board"
        onConfirm={confirmClearBoard}
      />
    </ToolPageWrapper>
  );
}
