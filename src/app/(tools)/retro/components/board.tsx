"use client";

/**
 * The live retro board. Owns the per-action history logging + sonification,
 * the countdown timer interval, the sprint the board looks back on and the
 * facts read for it, the common words across its cards, and the export
 * path. All mutations flow through the parent-supplied `onUpdate`
 * functional updater so the synced workspace doc stays the single source of
 * truth.
 *
 * Facilitator mode: in the Vote phase "Voting as" picks who the next vote
 * belongs to, each person with their own budget (`votesBy`); "Me" keeps
 * the single `userVotes` budget. "Votes each" (Write and Vote) sets that
 * budget for everyone: 3, 5 or 8, saved on the board. The facilitator can
 * step back a phase (votes are kept) and add a card in any phase.
 *
 * Taking a vote back: the board remembers, in memory for this visit, which
 * cards each voter ("Me" or a person) voted on, and "Take my vote back" on
 * such a card returns one vote to that voter. The saved board keeps counts
 * only, so after a reload the votes cast before it can't be taken back.
 *
 * Visitor live room: with NEXT_PUBLIC_VISITOR_ROOMS=1, a visitor (never the
 * owner) can pick "Everyone on their own device" over "One screen" in the
 * header, which opens a live room. Participants' cards and votes arrive
 * through `onUpdate` like any other edit; ending the room keeps the board.
 * The board's sprint, its facts and where cards came from stay host-side:
 * the room's snapshot carries only what participants need. While the room
 * hides cards (Write, "Hide cards while writing" on), this screen hides the
 * participants' cards too: each column shows the host's own and how many
 * others it holds, and Common words and the AI prompts read only what shows.
 * The room's check is asked while drawing, so a card that just arrived is
 * hidden from the first render it is in.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { RotateCcw, Eraser } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { InkMoment } from "@/components/ink/ink-moment";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportButton } from "@/components/shared/export-button";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ExampleNotice, hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { generateRetroPrompts } from "@/lib/ai-prompts/retro";
import { enoughData } from "@/lib/analytics/min-sample";
import { retroColumnFor } from "@/lib/handoffs/targets/retro-board";
import { retroVotes, type RetroVotes } from "@/lib/retro/board";
import { emit as sonify } from "@/lib/sonification/emit";
import { todayLocalISO } from "@/lib/utils/formatters";
import { type HistoryLogger } from "@/lib/history/use-history-logger";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { RetroBoard, RetroCard as StoredRetroCard } from "@/lib/stores/workspace-types";
import type { HandoffLink } from "@/lib/handoffs/types";
import { type BoardState, type RetroCard, PHASES, phaseDescription } from "../types";
import { carriedOverCard, RETRO_ARCHIVE_LIMIT } from "../archive";
import {
  makeId,
  columnGridClass,
  buildExportJson,
  formatTimer,
  removeCardWithGroup,
  restoreRemovedCards,
  retroFileStem,
  shortText,
  voterKey,
  voterNames,
  votesCastBy,
  withoutCards,
  withoutVotesBy,
} from "../helpers";
import { factLines } from "../facts-text";
import { kudosCards, kudosOnBoard, type SprintKudos } from "../kudos";
import { THEME_MIN_CARDS, keywordThemes, themeCardCount, themesForPrompt } from "../themes";
import { useBoardFacts } from "../use-board-facts";
import { retroVerdict } from "../verdict";
import { PhaseIndicator } from "./phase-indicator";
import { TimerWidget } from "./timer-widget";
import { RetroColumnPanel } from "./retro-column-panel";
import { LastRetroActions } from "./last-retro-actions";
import { SINGLE_VOTER, VoterPicker } from "./voter-picker";
import { VotesEach } from "./votes-each";
import { RetroSprintPicker } from "./retro-sprint-picker";
import { RetroFactsPanel } from "./retro-facts";
import { CommonWords } from "./common-words";
import { KudosSeed } from "./kudos-seed";
import { toMarkdown } from "../markdown";
import { RetroGoLive, type LiveRoomHandle } from "../room/host-live-room";
import { hideCards } from "../room/hidden";

/** A fresh card in `columnKey`. */
function newCard(columnKey: string, text: string): RetroCard {
  return {
    id: makeId(),
    columnKey,
    text,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  };
}

/** Which cards each voter voted on this visit: voter ("" for Me) → card id → votes. */
type VoteRecord = Record<string, Record<string, number>>;

/** The record's key for a voter: "" for Me, else the name as it matches (any case). */
function recordKey(voter: string): string {
  return voter.trim().toLowerCase();
}

const owns = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** `voter`'s votes per card in `record`. */
function votesIn(record: VoteRecord, voter: string): Record<string, number> {
  const key = recordKey(voter);
  return owns(record, key) ? record[key] : {};
}

/** `record` with `voter`'s votes on `cardId` moved by `step`. */
function stepVoteRecord(
  record: VoteRecord,
  voter: string,
  cardId: string,
  step: 1 | -1
): VoteRecord {
  const before = votesIn(record, voter);
  const n = (owns(before, cardId) ? before[cardId] : 0) + step;
  // Built from entries, so any card id is an own key.
  const entries = Object.entries(before).filter(([id]) => id !== cardId);
  if (n > 0) entries.push([cardId, n]);
  return { ...record, [recordKey(voter)]: Object.fromEntries(entries) };
}

/** "Sat 4 Oct" for the retro that drops off Past retros. */
function retroDay(iso: string | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
    : "undated";
}

export function Board({
  state,
  onUpdate,
  onReset,
  onClearExample,
  logger,
  dropsOff = [],
}: {
  state: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  onReset: () => void;
  /** Removes the example cards; the notice shows while any are on the board. */
  onClearExample?: () => void;
  logger: HistoryLogger;
  /** Past retros that "New Retro" drops to stay within RETRO_ARCHIVE_LIMIT. */
  dropsOff?: readonly RetroBoard[];
}) {
  const { log } = logger;
  const [confirmNewOpen, setConfirmNewOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const announce = useAnnounce();
  // Set while a visitor live room runs, so "New Retro" can end it first.
  const liveRoomRef = useRef<LiveRoomHandle | null>(null);
  // A live room's check for the participants' cards this screen hides (null: none).
  const [roomHides, setRoomHides] = useState<((cardId: string) => boolean) | null>(null);
  // Wrapped: a function handed to a state setter would be called as an updater.
  const onRoomHidden = useCallback(
    (hides: ((cardId: string) => boolean) | null) => setRoomHides(() => hides),
    []
  );
  // Asked in this render, so a card that arrives with this render is already hidden.
  const roomHidden = useMemo((): ReadonlySet<string> | null => {
    if (!roomHides || state.phase !== "write") return null;
    const ids = new Set<string>();
    for (const c of state.cards) if (roomHides(c.id)) ids.add(c.id);
    return ids;
  }, [roomHides, state.phase, state.cards]);
  const hiddenView = useMemo(() => hideCards(state.cards, roomHidden), [state.cards, roomHidden]);
  const shownCards = hiddenView.shown;

  // Team names for "Voting as" (Vote phase).
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
  // Votes each person has: the board's "Votes each", else 3.
  const budget = retroVotes(state);
  // Which cards each voter voted on this visit, so a vote can be taken back.
  const [voteRecord, setVoteRecord] = useState<VoteRecord>({});
  const myVotes = votesIn(voteRecord, activeVoter);

  // ── The sprint, and what the toolkit knows about it ────────────────
  const { sprints, sprint, sprintGone, facts, example, previousRetroId, impedimentsRecorded } =
    useBoardFacts(state);
  const lines = useMemo(
    () => (facts ? factLines(facts, { links: !example, impedimentsRecorded }) : []),
    [facts, example, impedimentsRecorded]
  );

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

  // Say when the timebox runs out: the room is talking, not watching the clock.
  const wasRunning = useRef(state.timerRunning);
  useEffect(() => {
    if (wasRunning.current && !state.timerRunning && state.timerSeconds === 0) {
      announce("Time's up.", "assertive");
    }
    wasRunning.current = state.timerRunning;
  }, [state.timerRunning, state.timerSeconds, announce]);

  const handleAdvancePhase = useCallback(() => {
    // BUG-T7-retro-1: compute the transition BEFORE dispatch so we
    // never depend on an updater closure variable that React 18 may
    // re-invoke (StrictMode) or invoke at unspecified timing.
    const idx = PHASES.findIndex((p) => p.key === state.phase);
    const next = PHASES[idx + 1];
    if (!next) return;
    // A stable id for this retro, so the XP ledger pays a finished retro
    // once however often it reaches Actions (reloads, stepping back): the
    // sprint it looks back on, else its first card (a new retro's cards,
    // carried-over actions included, get fresh ids).
    const firstCardId = state.cards[0]?.id;
    const retroId = state.sprintId
      ? `sprint:${state.sprintId}`
      : firstCardId
        ? `card:${firstCardId}`
        : undefined;
    const transition = { from: state.phase, to: next.key, ...(retroId ? { retroId } : {}) };
    sonify("retro", "phase-advance");
    onUpdate((prev) => {
      // Re-check inside the updater to handle a concurrent advance.
      const i = PHASES.findIndex((p) => p.key === prev.phase);
      const nx = PHASES[i + 1];
      if (!nx) return prev;
      return { ...prev, phase: nx.key };
    });
    log(RETRO_ACTIONS.PHASE_ADVANCED, transition);
    announce(`${next.label} phase. ${phaseDescription(next.key, budget)}.`);
  }, [onUpdate, log, announce, state.phase, state.sprintId, state.cards, budget]);

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

  // Which sprint the retro looks back on. Set here only when someone picks
  // it (never on open), so an old board isn't silently moved to a sprint.
  const handleSprintChange = useCallback(
    (sprintId: string | undefined) => {
      const picked = sprintId ? sprints.find((s) => s.id === sprintId) : undefined;
      onUpdate((prev) => {
        const next = { ...prev };
        if (sprintId) next.sprintId = sprintId;
        else delete next.sprintId;
        return next;
      });
      log(RETRO_ACTIONS.SPRINT_SET, {
        sprintId: sprintId ?? null,
        ...(picked ? { sprintName: picked.name } : {}),
      });
      announce(
        picked
          ? `This retro looks back on ${picked.name}.`
          : "This retro isn't linked to a sprint any more."
      );
    },
    [onUpdate, log, announce, sprints]
  );

  const handleAddCard = useCallback(
    (columnKey: string, text: string) => {
      sonify("retro", "card-add");
      const card = newCard(columnKey, text);
      onUpdate((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      log(RETRO_ACTIONS.CARD_ADDED, { cardId: card.id, columnKey, text });
    },
    [onUpdate, log]
  );

  // A multi-line paste: one card per line, in one update and one sound.
  const handleAddCards = useCallback(
    (columnKey: string, texts: string[]) => {
      if (texts.length === 0) return;
      sonify("retro", "card-add");
      const added = texts.map((text) => newCard(columnKey, text));
      onUpdate((prev) => ({ ...prev, cards: [...prev.cards, ...added] }));
      for (const card of added) {
        log(RETRO_ACTIONS.CARD_ADDED, { cardId: card.id, columnKey, text: card.text });
      }
      const column = state.format.columns.find((c) => c.key === columnKey)?.label ?? "the column";
      announce(`Added ${added.length} cards to ${column}.`);
    },
    [onUpdate, log, announce, state.format.columns]
  );

  // Fix a card's text after adding it.
  const handleEditCard = useCallback(
    (id: string, text: string) => {
      onUpdate((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, text } : c)),
      }));
      log(RETRO_ACTIONS.CARD_EDITED, { cardId: id, text });
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
      if (used >= budget) return;
      const card = state.cards.find((c) => c.id === id);
      const nextVoteCount = (card?.votes ?? 0) + 1;
      sonify("retro", "vote");
      onUpdate((prev) => {
        if (prev.phase !== "vote") return prev;
        const limit = retroVotes(prev);
        const cards = prev.cards.map((c) => (c.id === id ? { ...c, votes: c.votes + 1 } : c));
        if (!who) {
          if (prev.userVotes >= limit) return prev;
          return { ...prev, userVotes: prev.userVotes + 1, cards };
        }
        const cast = votesCastBy(prev.votesBy, who);
        if (cast >= limit) return prev;
        return {
          ...prev,
          cards,
          votesBy: { ...prev.votesBy, [voterKey(prev.votesBy, who)]: cast + 1 },
        };
      });
      setVoteRecord((prev) => stepVoteRecord(prev, who, id, 1));
      log(RETRO_ACTIONS.CARD_VOTED, { cardId: id, voteCount: nextVoteCount });
      if (used + 1 >= budget) {
        announce(
          who ? `${who} has used all ${budget} votes.` : `You have used all ${budget} votes.`
        );
      }
    },
    [
      onUpdate,
      log,
      announce,
      activeVoter,
      budget,
      state.phase,
      state.userVotes,
      state.votesBy,
      state.cards,
    ]
  );

  // "Take my vote back": one of the current voter's votes off a card they voted on.
  const handleUnvote = useCallback(
    (id: string) => {
      if (state.phase !== "vote") return;
      const who = activeVoter;
      const record = votesIn(voteRecord, who);
      const mine = owns(record, id) ? record[id] : 0;
      const used = who ? votesCastBy(state.votesBy, who) : state.userVotes;
      const card = state.cards.find((c) => c.id === id);
      if (mine <= 0 || used <= 0 || !card || card.votes <= 0) return;
      onUpdate((prev) => {
        if (prev.phase !== "vote") return prev;
        const target = prev.cards.find((c) => c.id === id);
        if (!target || target.votes <= 0) return prev;
        const cards = prev.cards.map((c) => (c.id === id ? { ...c, votes: c.votes - 1 } : c));
        if (!who) {
          return prev.userVotes > 0 ? { ...prev, userVotes: prev.userVotes - 1, cards } : prev;
        }
        const cast = votesCastBy(prev.votesBy, who);
        if (cast <= 0) return prev;
        return {
          ...prev,
          cards,
          votesBy: { ...prev.votesBy, [voterKey(prev.votesBy, who)]: cast - 1 },
        };
      });
      setVoteRecord((prev) => stepVoteRecord(prev, who, id, -1));
      log(RETRO_ACTIONS.CARD_UNVOTED, { cardId: id, voteCount: card.votes - 1 });
      const left = Math.max(0, budget - (used - 1));
      const votes = `${left} ${left === 1 ? "vote" : "votes"} left`;
      announce(who ? `Took back a vote for ${who}. ${votes}.` : `Took your vote back. ${votes}.`);
    },
    [
      onUpdate,
      log,
      announce,
      activeVoter,
      budget,
      voteRecord,
      state.phase,
      state.userVotes,
      state.votesBy,
      state.cards,
    ]
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

  // "Votes each": everyone's budget, saved on the board. Votes already cast
  // stay on their cards; a person past a lower budget just has none left.
  const handleVotesChange = useCallback(
    (votes: RetroVotes) => {
      if (votes === budget) return;
      onUpdate((prev) => ({ ...prev, votesPerPerson: votes }));
      announce(
        `Everyone now has ${votes} votes.${hasVotes ? " Votes already cast stay on their cards." : ""}`
      );
    },
    [onUpdate, announce, budget, hasVotes]
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
        label: `Deleted “${shortText(card.text)}”`,
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

  // The owner field saves once, when it's left or on Enter (OwnerField).
  const handleAssigneeChange = useCallback(
    (id: string, val: string) => {
      onUpdate((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, assignee: val } : c)),
      }));
      log(RETRO_ACTIONS.ACTION_ASSIGNED, { cardId: id, assignee: val });
      announce(val ? `Owner set to ${val}.` : "Owner cleared.");
    },
    [onUpdate, log, announce]
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
        label: `Carried over “${shortText(action.text)}”`,
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
          onUpdate((prev) => ({ ...prev, cards: withoutCards(prev.cards, new Set([card.id])) })),
      });
    },
    [onUpdate, log, state.format.columns]
  );

  // ── Kudos as appreciation cards ─────────────────────────────────────
  const kudosColumn = useMemo(() => {
    const key = retroColumnFor(state.format, "appreciation");
    return state.format.columns.find((c) => c.key === key) ?? state.format.columns[0];
  }, [state.format]);

  // One click adds every kudos not on the board yet; one Undo takes them all
  // back. A kudos already on the board (by its sourceRef) is skipped, also
  // inside the updater, so a send from Kudos in the meantime isn't doubled.
  const handleAddKudos = useCallback(
    (kudos: SprintKudos[]) => {
      if (!kudosColumn) return;
      const added = kudosCards(kudos, state.cards, kudosColumn.key);
      if (added.length === 0) return;
      const ids = new Set(added.map((c) => c.id));
      undoable({
        label: `Added ${added.length} kudos as ${added.length === 1 ? "a card" : "cards"}`,
        description: `In ${kudosColumn.label}.`,
        apply: () => {
          onUpdate((prev) => {
            const there = kudosOnBoard(prev.cards);
            const fresh = added.filter((c) => !there.has(c.sourceRef?.id ?? ""));
            return fresh.length === 0 ? prev : { ...prev, cards: [...prev.cards, ...fresh] };
          });
          // The example's kudos aren't the team's work, so they go unlogged.
          if (added.some((c) => !isExampleId(c.id))) {
            log(RETRO_ACTIONS.KUDOS_ADDED, {
              count: added.length,
              columnKey: kudosColumn.key,
              cardIds: added.map((c) => c.id),
            });
          }
        },
        // A card grouped under a kudos card since then stays, on its own.
        revert: () => onUpdate((prev) => ({ ...prev, cards: withoutCards(prev.cards, ids) })),
      });
      announce(`Added ${added.length} kudos to ${kudosColumn.label}.`);
    },
    [onUpdate, log, announce, state.cards, kudosColumn]
  );

  // ── Common words across the cards (keyword grouping) ───────────────
  // Only from THEME_MIN_CARDS cards (a group counts once): on a small board
  // every shared word is a coincidence. Hidden cards' words stay hidden too.
  const themeCards = useMemo(() => themeCardCount(shownCards), [shownCards]);
  const themes = useMemo(
    () => (enoughData(themeCards, THEME_MIN_CARDS) ? keywordThemes(shownCards) : []),
    [shownCards, themeCards]
  );
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlighted = themes.find((t) => t.keyword === highlight) ?? null;
  const highlightIds = useMemo(
    () => (highlighted ? new Set(highlighted.cardIds) : undefined),
    [highlighted]
  );
  const toggleHighlight = (keyword: string) => {
    const on = highlight !== keyword;
    setHighlight(on ? keyword : null);
    const theme = themes.find((t) => t.keyword === keyword);
    announce(
      on && theme
        ? `Ringed ${theme.cardIds.length} cards with “${keyword}”.`
        : "Cleared the highlight."
    );
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "Retrospective Board",
      prompts: generateRetroPrompts({
        formatName: state.format.name,
        columns: state.format.columns,
        cards: shownCards,
        themes: themesForPrompt(themes, shownCards),
      }),
    }),
    [state.format, shownCards, themes]
  );

  // Exports read only the format, cards, sprint and facts, so the timer's
  // per-second ticks don't rebuild them.
  const markdown = useMemo(
    () =>
      toMarkdown({ format: state.format, cards: state.cards }, new Date(), {
        ...(facts ? { sprintName: facts.sprintName, facts: lines } : {}),
        themes,
      }),
    [state.format, state.cards, facts, lines, themes]
  );
  const exportJson = useMemo(
    () => buildExportJson({ format: state.format, cards: state.cards, votesPerPerson: budget }),
    [state.format, state.cards, budget]
  );
  // A share link carries Votes each too, so the copy someone imports keeps it.
  const shareState = useMemo(
    () => ({ format: state.format, cards: state.cards, votesPerPerson: budget }),
    [state.format, state.cards, budget]
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
  // A new retro closes a live room first: the board it shares is going away.
  const startNewRetro = () => {
    liveRoomRef.current?.end();
    onReset();
  };
  const requestNewRetro = () => {
    if (ownCount === 0) startNewRetro();
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

  // "New Retro" past the archive limit drops the oldest past retro: say which.
  const dropNote =
    dropsOff.length === 0
      ? ""
      : ` Past retros keep the latest ${RETRO_ARCHIVE_LIMIT}, so the ${dropsOff
          .map((b) => `${retroDay(b.archivedAt)} ${b.format?.name ?? "retro"}`)
          .join(
            ", "
          )} retro${dropsOff.length === 1 ? "" : "s"} will drop off (Undo brings ${dropsOff.length === 1 ? "it" : "them"} back).`;

  const totalCards = state.cards.filter((c) => c.groupedWith === null).length;
  const actionCount = state.cards.filter((c) => c.isActionItem).length;
  const gridClass = columnGridClass(state.format.columns.length);
  const verdict = retroVerdict(state, facts);

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
          <div className="min-w-0 space-y-2">
            <PhaseIndicator
              current={state.phase}
              onAdvance={handleAdvancePhase}
              onBack={handleBackPhase}
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-sub">
              <span>{totalCards} cards</span>
              {state.phase === "vote" && (
                <span className="text-accent font-semibold">
                  {activeVoter
                    ? `${Math.max(0, budget - votesUsed)} votes remaining for ${activeVoter}`
                    : `${Math.max(0, budget - state.userVotes)} votes remaining`}
                </span>
              )}
              {(state.phase === "write" || state.phase === "vote") && (
                <VotesEach value={budget} onChange={handleVotesChange} />
              )}
              {state.phase === "actions" && actionCount > 0 && (
                <span className="inline-flex flex-col items-start">
                  <span className="text-accent-green font-semibold">
                    {actionCount} action item{actionCount !== 1 ? "s" : ""}
                  </span>
                  {/* An ink moment: the retro reached its actions. */}
                  <InkMoment mark="flourish" />
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RetroGoLive
              board={state}
              onUpdate={onUpdate}
              handleRef={liveRoomRef}
              onHiddenChange={onRoomHidden}
            />
            <TimerWidget
              seconds={state.timerSeconds}
              running={state.timerRunning}
              onToggle={() => {
                onUpdate((prev) => ({ ...prev, timerRunning: !prev.timerRunning }));
                announce(
                  state.timerRunning
                    ? "Timer paused."
                    : `Timer started: ${formatTimer(state.timerSeconds)}.`
                );
              }}
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

        {/* ── The sprint it looks back on ──────────────────── */}
        {/* The example looks back on its own sprint: linking it to a real one
            would bring that sprint's facts and kudos onto the example. */}
        {example ? (
          <p className="px-1 text-xs text-sub">
            The example looks back on its own {facts?.sprintName ?? "sprint"}. Clear the example to
            link this retro to one of your sprints.
          </p>
        ) : (
          <RetroSprintPicker
            sprints={sprints}
            sprintId={state.sprintId}
            sprintGone={sprintGone}
            onChange={handleSprintChange}
          />
        )}

        {/* ── Verdict and phase hint ───────────────────────── */}
        <div className="space-y-1 px-1">
          <p className="text-sm font-medium text-text">{verdict}</p>
          <p className="text-xs text-sub">
            {phaseDescription(state.phase, budget)}
            {state.phase === "discuss" && (
              <span className="ml-2 text-accent">
                Cards sorted by votes — click a card to mark it as discussing.
              </span>
            )}
            {state.phase === "write" && hasVotes && (
              <span className="ml-2 text-accent">Votes cast so far are kept.</span>
            )}
            {roomHidden && (
              <span className="ml-2 text-accent">
                Everyone&apos;s cards stay hidden until you move to Vote, on this screen too.
              </span>
            )}
          </p>
        </div>

        {/* ── Voting as (facilitator mode, Vote phase) ─────── */}
        {state.phase === "vote" && (
          <VoterPicker
            names={voters}
            votesBy={state.votesBy}
            votesPerPerson={budget}
            voter={activeVoter}
            onVoterChange={setVoter}
            showAddVoter={teamNames.length === 0}
            onAddVoter={handleAddVoter}
          />
        )}

        {/* ── Facts from the sprint (open while writing) ───── */}
        {facts && (
          <RetroFactsPanel
            key={state.phase === "write" ? "write" : "later"}
            sprintName={facts.sprintName}
            lines={lines}
            example={example}
            defaultOpen={state.phase === "write"}
          />
        )}

        {/* ── Common words across the cards ────────────────── */}
        {/* Below the bar, say how many more cards it takes (from the first card). */}
        {enoughData(themeCards, THEME_MIN_CARDS) ? (
          <CommonWords themes={themes} highlighted={highlight} onToggle={toggleHighlight} />
        ) : (
          themeCards > 0 && (
            <NotEnoughData
              have={themeCards}
              need={THEME_MIN_CARDS}
              unit={["card", "cards"]}
              what="the words they share"
            />
          )
        )}

        {/* ── Last retro's actions and the sprint's kudos (Write phase) ── */}
        {state.phase === "write" && (
          <LastRetroActions
            retroId={previousRetroId}
            cards={state.cards}
            onCarryOver={handleCarryOver}
          />
        )}
        {state.phase === "write" && facts && kudosColumn && (
          <KudosSeed
            sprintName={facts.sprintName}
            kudos={facts.kudos}
            cards={state.cards}
            columnLabel={kudosColumn.label}
            onAdd={handleAddKudos}
          />
        )}

        {/* ── Columns ──────────────────────────────────────── */}
        <div className={`grid ${gridClass} gap-4`}>
          {state.format.columns.map((col) => {
            const colCards = shownCards.filter((c) => c.columnKey === col.key);
            const hidden = hiddenView.hiddenCounts;
            return (
              <RetroColumnPanel
                key={col.key}
                column={col}
                cards={colCards}
                allCards={shownCards}
                phase={state.phase}
                hiddenCount={
                  hidden && Object.prototype.hasOwnProperty.call(hidden, col.key)
                    ? hidden[col.key]
                    : 0
                }
                votesUsed={votesUsed}
                maxVotes={budget}
                highlightIds={highlightIds}
                highlightWord={highlighted?.keyword}
                onAdd={handleAddCard}
                onAddMany={handleAddCards}
                onEdit={handleEditCard}
                onVote={handleVote}
                myVotes={myVotes}
                onUnvote={handleUnvote}
                unvoteLabel={activeVoter ? `Take ${activeVoter}'s vote back` : "Take my vote back"}
                onDelete={handleDelete}
                onGroup={handleGroup}
                onToggleAction={handleToggleAction}
                onAssigneeChange={handleAssigneeChange}
                onToggleDiscussing={handleToggleDiscussing}
                onLinksChange={handleLinksChange}
              />
            );
          })}
        </div>

        {/* ── Footer actions ───────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <AiPromptGenerator config={promptConfig} />
          {/* The user's LOCAL date in the filename: `toISOString()` is UTC and
              stamps "tomorrow" for users west of UTC in their evening. */}
          <ExportButton
            filename={`${retroFileStem(state.format)}-${todayLocalISO()}`}
            markdown={markdown}
            shareState={shareState}
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
          <span className="ml-auto text-xs text-sub">
            {state.format.name}
            {sprint ? ` · ${sprint.name}` : ""} · Saved in your workspace
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={confirmNewOpen}
        onOpenChange={setConfirmNewOpen}
        title="Start a new retro?"
        description={`This ${state.format.name} board and its ${ownCardsLabel} move to Past retros, below the format picker, and you start a new board.${dropNote}`}
        confirmLabel="Start new retro"
        onConfirm={startNewRetro}
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
