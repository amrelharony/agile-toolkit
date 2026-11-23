"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Columns3, Plus, Radio, Save, Send, Trash2, Users } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { generateRelativeSizingPrompts } from "@/lib/ai-prompts/relative-sizing";
import { cheer } from "@/lib/celebrate/cheer";
import { queueAllForPoker } from "@/lib/estimation/queue-for-poker";
import { findLink } from "@/lib/handoffs/registry";
import { sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import { RELATIVE_SIZING_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { placementsFromRound } from "@/lib/relative-sizing/live";
import {
  BOARD_ID_PREFIX,
  ITEM_ID_PREFIX,
  RELATIVE_SIZING_PATH,
  boardCounts,
  bucketOf,
  dealItems,
  middleBucket,
  moveItem,
  planCreateBoard,
  sizesToWrite,
  skippedLine,
  unsizedItems,
  withAnchor,
  withBucketPoints,
  withItemRestored,
  withMode,
  withNewItems,
  withoutItems,
  type Lane,
} from "@/lib/relative-sizing/model";
import {
  SIZING_LIMITS,
  normalizeRelativeSizingState,
  type RelativeSizingState,
  type SizingBoard,
  type SizingItem,
  type SizingMode,
} from "@/lib/relative-sizing/state";
import {
  hydrateRelativeSizing,
  relativeSizingReady,
  relativeSizingState,
  updateRelativeSizing,
  useRelativeSizing,
} from "@/lib/relative-sizing/store";
import { withRefinedPutBack } from "@/lib/sprints/story-status";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { DockTimebox } from "../example-mapping/timebox";
import { BucketPoints } from "./bucket-points";
import { buildExample } from "./example";
import { LiveRound } from "./live-round";
import { toMarkdown } from "./markdown";
import { NewBoardForm, type BoardSource, type BoardValues } from "./new-board-form";
import { SizingBoardView } from "./sizing-board";
import { TalkAbout } from "./talk-about";

export const TOOL_ID = "relative-sizing";

const nowIso = () => new Date().toISOString();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (t: string, max = 50) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** About 30 seconds a story, between 5 and 60 minutes. */
const timeboxMinutes = (stories: number) => Math.min(60, Math.max(5, Math.ceil(stories / 2)));

const freshBoard = (id: string) => relativeSizingState().boards.find((b) => b.id === id) ?? null;
const freshStory = (id: string | undefined) =>
  id ? useWorkspaceStore.getState().stories.find((s) => s.id === id) : undefined;

/** Change one board in the store, from its clean copy; false when it is gone. */
function writeBoard(id: string, fn: (b: SizingBoard) => SizingBoard | null): boolean {
  return updateRelativeSizing((s) => {
    const board = s.boards.find((b) => b.id === id);
    const next = board ? fn(board) : null;
    return next ? { ...s, boards: s.boards.map((b) => (b.id === id ? next : b)) } : null;
  });
}

/**
 * Relative Sizing: many stories sized at once by comparing them with each
 * other. Silent sort moves cards between buckets without talking (a card
 * moved too often goes to Talk about it); buckets mode places an anchor
 * story first and deals the rest out. "Ask the room" sends the stories to
 * every phone as private scale ballots and brings back totals only; while
 * that room is live its board stays on screen (a board Amr opens waits, and
 * the host's own switch or delete asks first). The team talks only about
 * the outliers, sends the hardest to Planning Poker, and Save sizes writes
 * the buckets' points to the stories with one Undo.
 * Amr suggests questions and splits; every one has a way without AI. The
 * boards live in the tool's own store, which Amr's verbs read and write
 * too (on the server through the user's synced row).
 */
export function RelativeSizingClient() {
  const workspaceReady = useWorkspaceHydrated();
  const [storeReady, setStoreReady] = useState(relativeSizingReady);
  useEffect(() => {
    let live = true;
    void hydrateRelativeSizing().finally(() => {
      if (live) setStoreReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const rawBoards = useRelativeSizing((s) => s.boards);
  const rawActive = useRelativeSizing((s) => s.activeBoardId);
  const rawRounds = useRelativeSizing((s) => s.rounds);
  const state: RelativeSizingState = useMemo(
    () =>
      normalizeRelativeSizingState({
        boards: rawBoards,
        activeBoardId: rawActive,
        rounds: rawRounds,
      }),
    [rawBoards, rawActive, rawRounds]
  );
  const stories = useWorkspaceStore((s) => s.stories);
  const roster = useTeamRoster();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();

  const [creating, setCreating] = useState<BoardSource | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState<URLSearchParams | null>(null);
  const [names, setNames] = useState<string | null>(null);

  /**
   * "Ask the room" lives in the board shown, so whatever changes the board
   * shown would end it for every phone in it. While a room is live its
   * board is held on screen: a change of the store's active board (Amr's
   * create_board, another tab, a sync) waits, with an offer to show it,
   * and the host's own switch or delete asks first.
   */
  const [liveBoardId, setLiveBoardId] = useState<string | null>(null);
  const liveRef = useRef(liveBoardId);
  liveRef.current = liveBoardId;
  /** The board held on screen while the store's active board moved; null follows the store. */
  const [heldId, setHeldId] = useState<string | null>(null);
  /** A change that would end the live room, waiting on the host's answer. */
  const [pending, setPending] = useState<{ go: () => void; ends: RoomEnder } | null>(null);
  /** Run `go`, or, when `endsRoom` and a room is live, ask first. */
  const guard = (endsRoom: boolean, ends: RoomEnder, go: () => void) => {
    if (endsRoom && liveRef.current) setPending({ go, ends });
    else go();
  };

  const held = heldId ? (state.boards.find((b) => b.id === heldId) ?? null) : null;
  const active = state.boards.find((b) => b.id === state.activeBoardId) ?? null;
  const board = held ?? active ?? state.boards[0] ?? null;
  /** The board the store moved to while this one was held (shown once the host says so). */
  const waiting = held && active && active.id !== held.id ? active : null;
  const liveBoard = liveBoardId ? state.boards.find((b) => b.id === liveBoardId) : undefined;

  // Once no room is live, a held board the store has caught up with (or
  // that has gone) needs no holding.
  useEffect(() => {
    if (!heldId || liveBoardId) return;
    const stillThere = state.boards.some((b) => b.id === heldId);
    const elsewhere = state.boards.some((b) => b.id === state.activeBoardId);
    if (!stillThere || !elsewhere || state.activeBoardId === heldId) setHeldId(null);
  }, [heldId, liveBoardId, state.activeBoardId, state.boards]);
  const unsized = useMemo(() => unsizedItems(stories), [stories]);
  const markdown = useMemo(() => (board ? toMarkdown(board) : ""), [board]);
  const promptConfig = useMemo(
    () => ({ toolName: "Relative Sizing", prompts: generateRelativeSizingPrompts(board) }),
    [board]
  );
  const ready = workspaceReady && storeReady;

  const record = useCallback(
    (boardId: string, action: string, payload: Record<string, unknown>) => {
      if (!isExampleId(boardId)) log(action, { boardId, ...payload });
    },
    [log]
  );
  const say = (text: string) => {
    setStatus(text);
    announce(text);
  };

  const open = (id: string) =>
    guard(id !== liveRef.current, "switch", () => {
      // The live room's own board stays held; any other is the store's to show.
      setHeldId(id === liveRef.current ? id : null);
      updateRelativeSizing((s) => ({ ...s, activeBoardId: id }));
      setCreating(null);
      setStatus(null);
    });

  /* ── Query links: ?stories=unsized starts a board, ?board= opens one ── */

  const onQuery = useCallback((params: URLSearchParams) => {
    if (params.has("stories") || params.has("board")) setPendingQuery(params);
  }, []);
  useEffect(() => {
    if (!ready || !pendingQuery) return;
    setPendingQuery(null);
    if (pendingQuery.get("stories") === "unsized") {
      setCreating("unsized");
      dropSearchParam("stories");
    }
    const id = pendingQuery.get("board");
    if (id) {
      if (freshBoard(id)) open(id);
      dropSearchParam("board");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per query
  }, [ready, pendingQuery]);

  /* ── Boards ────────────────────────────────────────────────────────── */

  const createBoard = (v: BoardValues) => {
    const prefix = `${ITEM_ID_PREFIX}${nanoid(6)}_`;
    const plan = planCreateBoard(
      relativeSizingState(),
      { title: v.title, bucketSet: v.bucketSet, buckets: v.buckets, items: v.items },
      { boardId: `${BOARD_ID_PREFIX}${nanoid(8)}`, itemId: (i) => `${prefix}${i}` },
      nowIso()
    );
    if (!plan.ok) return say(plan.reason);
    updateRelativeSizing(() => plan.state);
    record(plan.board.id, RELATIVE_SIZING_ACTIONS.BOARD_CREATED, {
      stories: plan.board.items.length,
      buckets: plan.board.buckets.length,
    });
    setCreating(null);
    // A live room keeps its board on screen; the new one waits, with an offer to show it.
    const live = liveRef.current !== null;
    if (!live) setHeldId(null);
    say(
      `Started “${short(plan.board.title)}” with ${plural(plan.board.items.length, "story", "stories")}.${v.dropped > 0 ? ` ${plural(v.dropped, "line was", "lines were")} left out: a board holds ${SIZING_LIMITS.items}.` : ""}${live ? " The live room's board stays on screen until you show it." : ""}`
    );
  };

  const deleteBoard = (b: SizingBoard) => {
    let before: RelativeSizingState | null = null;
    const label = `Deleted the board “${short(b.title, 40)}”`;
    undoable({
      label,
      apply: () => {
        before = relativeSizingState();
        updateRelativeSizing((s) => ({
          ...s,
          boards: s.boards.filter((x) => x.id !== b.id),
          activeBoardId: s.activeBoardId === b.id ? null : s.activeBoardId,
          rounds: s.rounds.filter((r) => r.boardId !== b.id),
        }));
        record(b.id, RELATIVE_SIZING_ACTIONS.BOARD_REMOVED, {});
      },
      revert: () => {
        const prev = before;
        if (!prev) return;
        updateRelativeSizing((s) => ({
          ...s,
          boards: s.boards.some((x) => x.id === b.id) ? s.boards : [b, ...s.boards],
          activeBoardId: b.id,
          rounds: [...s.rounds, ...prev.rounds.filter((r) => r.boardId === b.id)],
        }));
      },
    });
    announce(label);
  };

  /* ── Moving cards ──────────────────────────────────────────────────── */

  const move = (b: SizingBoard, itemId: string, lane: Lane, focus: () => void) => {
    let result: ReturnType<typeof moveItem> | null = null;
    writeBoard(b.id, (cur) => {
      result = moveItem(cur, itemId, lane, nowIso());
      return result.moved ? result.board : null;
    });
    const r = result as ReturnType<typeof moveItem> | null;
    if (!r?.moved) return;
    const item = r.board.items.find((i) => i.id === itemId);
    const where =
      lane.kind === "bucket"
        ? (r.board.buckets.find((x) => x.id === lane.bucketId)?.label ?? "")
        : lane.kind === "talk"
          ? "Talk about it"
          : "Not placed";
    announce(
      r.toTalk
        ? `“${short(item?.title ?? "")}” moved ${item?.moves} times: it goes to Talk about it.`
        : `Moved “${short(item?.title ?? "")}” to ${where}.`
    );
    focus();
  };

  /** A card taken off the board (a mistyped title, a story split up), with Undo. */
  const removeItem = (b: SizingBoard, itemId: string) => {
    const cur = freshBoard(b.id);
    const index = cur ? cur.items.findIndex((i) => i.id === itemId) : -1;
    if (!cur || index < 0) return;
    const removed = { item: cur.items[index], index, anchor: cur.anchorItemId === itemId };
    const label = `Removed “${short(removed.item.title, 40)}” from the board`;
    undoable({
      label,
      apply: () => {
        writeBoard(b.id, (c) => withoutItems(c, [itemId], nowIso()));
      },
      revert: () => {
        writeBoard(b.id, (c) => withItemRestored(c, removed, nowIso()));
      },
    });
    announce(`${label}.`);
  };

  const setMode = (b: SizingBoard, mode: SizingMode) => {
    writeBoard(b.id, (cur) => withMode(cur, mode, nowIso()));
  };

  /** Map sizes to points: what Save sizes writes for one bucket (undefined: none). */
  const setBucketPoints = (b: SizingBoard, bucketId: string, points: number | undefined) => {
    let changed = false;
    writeBoard(b.id, (cur) => {
      const next = withBucketPoints(cur, bucketId, points, nowIso());
      changed = next !== null && next !== cur;
      return changed ? next : null;
    });
    const label = b.buckets.find((x) => x.id === bucketId)?.label ?? "";
    if (!changed) return;
    announce(
      points === undefined
        ? `${label} has no points now: Save sizes skips it.`
        : `${label} is ${plural(points, "point", "points")} now.`
    );
  };

  const setAnchor = (b: SizingBoard, itemId: string) => {
    const bucket = middleBucket(b);
    writeBoard(b.id, (cur) => withAnchor(cur, itemId || null, bucket.id, nowIso()));
    if (itemId) announce(`The anchor is in ${bucket.label}. Size the rest against it.`);
  };

  const deal = (b: SizingBoard) => {
    const people = (names ?? roster.map((m) => m.name).join(", "))
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (people.length === 0) return say("Type the names of the people placing the cards.");
    writeBoard(b.id, (cur) => dealItems(cur, people, nanoid(8), nowIso()));
    record(b.id, RELATIVE_SIZING_ACTIONS.ROUND_STARTED, {
      mode: "buckets",
      stories: b.items.length,
    });
    say(
      `Dealt ${plural(b.items.length - (b.anchorItemId ? 1 : 0), "card", "cards")} to ${plural(people.length, "person", "people")}.`
    );
  };

  /* ── The live round ────────────────────────────────────────────────── */

  const saveRound = (b: SizingBoard) => (result: VoteRoundResult) => {
    const current = freshBoard(b.id);
    if (!current) return false;
    const r = placementsFromRound(result, current, nowIso());
    if (r.placed + r.outliers === 0) {
      say(`No story had ${result.minN} placements, so nothing was saved.`);
      return false;
    }
    updateRelativeSizing((s) => ({
      ...s,
      boards: s.boards.map((x) => (x.id === b.id ? r.board : x)),
      rounds: [...s.rounds, r.saved].slice(-50),
    }));
    record(b.id, RELATIVE_SIZING_ACTIONS.ROUND_SAVED, { placed: r.placed, outliers: r.outliers });
    say(
      `The room placed ${plural(r.placed, "story", "stories")}${r.outliers > 0 ? `; ${plural(r.outliers, "story goes", "stories go")} to Talk about it` : ""}.`
    );
    return () => {
      updateRelativeSizing((s) => ({
        ...s,
        boards: s.boards.map((x) => (x.id === b.id ? current : x)),
        rounds: s.rounds.filter((x) => x.roundId !== r.saved.roundId),
      }));
    };
  };

  /* ── Talk about it ─────────────────────────────────────────────────── */

  const split = (b: SizingBoard, titles: string[]) => {
    // Added first: a full board says so inline, and no toast claims an add.
    const prefix = `${ITEM_ID_PREFIX}${nanoid(6)}_`;
    let added: string[] = [];
    writeBoard(b.id, (cur) => {
      const r = withNewItems(
        cur,
        titles.map((title) => ({ title })),
        nowIso(),
        (i) => `${prefix}${i}`
      );
      added = r.added;
      return added.length > 0 ? r.board : null;
    });
    if (added.length === 0) {
      return say(
        `A board holds ${SIZING_LIMITS.items} stories at most. Remove one to add a smaller story.`
      );
    }
    const first = freshBoard(b.id)?.items.find((i) => i.id === added[0])?.title ?? "";
    const left = titles.length - added.length;
    undoable({
      label:
        added.length === 1
          ? `Added “${short(first, 40)}”`
          : `Added ${added.length} smaller stories`,
      kind: "success",
      apply: () => {},
      revert: () => {
        writeBoard(b.id, (cur) => withoutItems(cur, added, nowIso()));
      },
    });
    announce(
      `Added ${plural(added.length, "smaller story", "smaller stories")} to Not placed.${left > 0 ? ` ${plural(left, "was", "were")} left out: a board holds ${SIZING_LIMITS.items}.` : ""}`
    );
  };

  const sendToPoker = (b: SizingBoard) => {
    const talk = b.items.filter((i) => i.contested && i.storyId && !isExampleId(i.storyId));
    const list = talk.map((i) => freshStory(i.storyId)).filter((s): s is Story => Boolean(s));
    if (list.length === 0) {
      return say(
        "Only backlog stories go to Planning Poker: add the typed ones to the backlog first."
      );
    }
    const n = queueAllForPoker(list);
    if (n === 0) return say("They are already in the Planning Poker queue.");
    record(b.id, RELATIVE_SIZING_ACTIONS.SENT_TO_POKER, { count: n });
    say(`Queued ${plural(n, "story", "stories")} for Planning Poker.`);
  };

  /** A pasted card's link store: the backlog story it becomes is the story it sizes. */
  const itemLinks = (boardId: string, itemId: string): HandoffLinkStore => ({
    getLinks: () => freshBoard(boardId)?.items.find((i) => i.id === itemId)?.sentTo,
    setLinks: (update) => {
      writeBoard(boardId, (cur) => ({
        ...cur,
        updatedAt: nowIso(),
        items: cur.items.map((i) => {
          if (i.id !== itemId) return i;
          const old = findLink(i.sentTo, "backlog-story");
          const links = update(i.sentTo);
          const link = findLink(links, "backlog-story");
          const next: SizingItem = { ...i };
          if (links.length > 0) next.sentTo = links;
          else delete next.sentTo;
          if (link) next.storyId = link.targetId;
          else if (old && i.storyId === old.targetId) delete next.storyId;
          return next;
        }),
      }));
    },
  });

  const addPastedToBacklog = (b: SizingBoard) => {
    const pasted = b.items.filter((i) => !i.storyId && !isExampleId(i.id));
    if (pasted.length === 0) return;
    const made = sendHandoffBatch(
      "backlog-story",
      pasted.map((it) => {
        const points = it.contested ? undefined : bucketOf(b, it)?.points;
        return {
          src: {
            title: it.title,
            ...(points !== undefined && points > 0 ? { points } : {}),
            sourceRef: { tool: TOOL_ID, id: it.id, doc: b.id },
          },
          links: itemLinks(b.id, it.id),
        };
      }),
      `Added ${plural(pasted.length, "story", "stories")} to the backlog`
    );
    say(
      `Added ${plural(made.length, "story", "stories")} to the backlog. Their sizes can be saved now.`
    );
  };

  /* ── Save sizes ────────────────────────────────────────────────────── */

  const saveSizes = (b: SizingBoard) => {
    const current = freshBoard(b.id);
    if (!current) return;
    const plan = sizesToWrite(current, useWorkspaceStore.getState().stories);
    if (plan.writes.length === 0) {
      return say(`No sizes to save. ${skippedLine(plan)}`.trim());
    }
    const stamps = new Map<string, string | undefined>();
    const before = new Map(plan.writes.map((w) => [w.storyId, freshStory(w.storyId)]));
    const appliedBefore = current.appliedAt;
    undoable({
      label: `Saved sizes for ${plural(plan.writes.length, "story", "stories")}`,
      kind: "success",
      apply: () => {
        const store = useWorkspaceStore.getState();
        store.bulkUpsertStories(
          plan.writes.flatMap((w) => {
            const s = freshStory(w.storyId);
            return s ? [{ ...s, points: w.points }] : [];
          })
        );
        for (const w of plan.writes) stamps.set(w.storyId, freshStory(w.storyId)?.refinedAt);
        writeBoard(b.id, (cur) => ({ ...cur, appliedAt: nowIso(), updatedAt: nowIso() }));
      },
      revert: () => {
        const store = useWorkspaceStore.getState();
        const back: Story[] = [];
        for (const w of plan.writes) {
          const cur = freshStory(w.storyId);
          const prev = before.get(w.storyId);
          if (!cur || !prev) continue;
          const restored: Story = { ...cur };
          if (prev.points === undefined) delete restored.points;
          else restored.points = prev.points;
          back.push(withRefinedPutBack(restored, stamps.get(w.storyId), prev.refinedAt));
        }
        store.bulkUpsertStories(back);
        writeBoard(b.id, (cur) => {
          const next = { ...cur, updatedAt: nowIso() };
          if (appliedBefore) next.appliedAt = appliedBefore;
          else delete next.appliedAt;
          return next;
        });
      },
    });
    record(b.id, RELATIVE_SIZING_ACTIONS.SIZES_APPLIED, { stories: plan.writes.length });
    cheer(TOOL_ID, "done");
    say(
      `Saved sizes for ${plural(plan.writes.length, "story", "stories")}. ${skippedLine(plan)}`.trim()
    );
  };

  /* ── The example ───────────────────────────────────────────────────── */

  const loadExample = () => {
    if (!liveRef.current) setHeldId(null);
    const { board: example, round } = buildExample(new Date());
    updateRelativeSizing((s) => ({
      ...s,
      boards: [example, ...s.boards.filter((x) => x.id !== example.id)],
      activeBoardId: example.id,
      rounds: [...s.rounds.filter((r) => r.boardId !== example.id), round],
    }));
  };
  // Clearing takes the example's boards, so a room live on one of them ends.
  const clearExample = () =>
    guard(isExampleId(liveRef.current ?? ""), "clear", () => {
      setHeldId((h) => (h && isExampleId(h) ? null : h));
      clearExampleBoards();
    });
  const clearExampleBoards = () => {
    let removed: RelativeSizingState | null = null;
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = relativeSizingState();
        updateRelativeSizing((s) => ({
          boards: s.boards.filter((x) => !isExampleId(x.id)),
          activeBoardId: s.activeBoardId && isExampleId(s.activeBoardId) ? null : s.activeBoardId,
          rounds: s.rounds.filter((r) => !isExampleId(r.boardId)),
        }));
      },
      revert: () => {
        const prev = removed;
        if (prev) updateRelativeSizing(() => prev);
      },
    });
  };

  /* ── Rendering ─────────────────────────────────────────────────────── */

  const wrapper = (children: ReactNode) => (
    <ToolPageWrapper
      toolId="relative-sizing"
      title="Relative Sizing"
      description="Size many stories at once: sort them into buckets in silence, on one screen or every phone, then discuss the outliers."
      category="Sprint Planning & Estimation"
    >
      {children}
    </ToolPageWrapper>
  );

  if (!ready) return wrapper(<WorkspaceLoading>Loading the boards…</WorkspaceLoading>);

  const hasExample = state.boards.some((b) => isExampleId(b.id));
  const newForm = (source: BoardSource) => (
    <SectionCard title="Start a board" icon={Columns3}>
      <NewBoardForm
        key={source}
        unsized={unsized}
        initialSource={source}
        onCreate={createBoard}
        onCancel={state.boards.length > 0 ? () => setCreating(null) : undefined}
      />
    </SectionCard>
  );

  return wrapper(
    <div className="space-y-4">
      <OnSearchParams onChange={onQuery} />
      {hasExample && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 text-xs text-sub">
            Example: twelve typed stories, so Save sizes writes nothing to the backlog.
          </p>
        </div>
      )}
      {status && (
        <p
          role="status"
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-text"
        >
          {status}
        </p>
      )}

      {state.boards.length === 0 ? (
        <>
          {newForm(creating ?? (unsized.length > 0 ? "unsized" : "paste"))}
          <EmptyState icon={Columns3} action={<LoadExampleButton onLoad={loadExample} />}>
            No boards yet. Start one from the backlog&apos;s unsized stories or pasted titles, then
            sort them into buckets without talking. About 30 seconds a story is enough.
          </EmptyState>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            {state.boards.length > 1 && (
              <Field label="Board" className="min-w-0 flex-1 sm:max-w-sm">
                {(props) => (
                  <select
                    {...props}
                    className={SELECT_CLASS}
                    value={board?.id ?? ""}
                    onChange={(e) => open(e.target.value)}
                  >
                    {state.boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!creating && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreating(unsized.length > 0 ? "unsized" : "paste")}
                >
                  <Plus aria-hidden="true" />
                  New board
                </Button>
              )}
              {board && <AiPromptGenerator config={promptConfig} />}
              {board && (
                <ExportButton
                  filename="relative-sizing"
                  markdown={markdown}
                  clipboardText={markdown}
                  jsonData={board}
                />
              )}
            </div>
          </div>
          {creating && newForm(creating)}
          {waiting && board && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-text">
              <p role="status" className="min-w-0 flex-1 break-words">
                {liveBoardId
                  ? `“${short(waiting.title)}” was opened while the room on “${short(board.title)}” is live, so this board stays on screen.`
                  : `“${short(waiting.title)}” was opened while the room on “${short(board.title)}” was live.`}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => guard(true, "switch", () => setHeldId(null))}
              >
                Show “{short(waiting.title, 30)}”
              </Button>
            </div>
          )}
          {board && (
            <BoardView
              key={board.id}
              board={board}
              stories={stories}
              names={names ?? roster.map((m) => m.name).join(", ")}
              onNames={setNames}
              actions={{
                move: (itemId, lane, focus) => move(board, itemId, lane, focus),
                remove: (itemId) => removeItem(board, itemId),
                setMode: (m) => setMode(board, m),
                setBucketPoints: (id, points) => setBucketPoints(board, id, points),
                setAnchor: (id) => setAnchor(board, id),
                deal: () => deal(board),
                saveRound: saveRound(board),
                split: (titles) => split(board, titles),
                sendToPoker: () => sendToPoker(board),
                addPastedToBacklog: () => addPastedToBacklog(board),
                saveSizes: () => saveSizes(board),
                deleteBoard: () =>
                  guard(board.id === liveRef.current, "delete", () => {
                    setHeldId(null);
                    deleteBoard(board);
                  }),
                liveChange: (live) => {
                  setLiveBoardId(live ? board.id : null);
                  if (live) setHeldId(board.id);
                },
                startTimebox: () =>
                  record(board.id, RELATIVE_SIZING_ACTIONS.ROUND_STARTED, {
                    mode: board.mode,
                    stories: board.items.length,
                  }),
                startLive: (n) =>
                  record(board.id, RELATIVE_SIZING_ACTIONS.ROUND_STARTED, {
                    mode: "live",
                    stories: n,
                  }),
              }}
            />
          )}
        </>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="End the live room?"
        description={`The room on “${short(liveBoard?.title ?? "this board")}” is still live. ${
          ENDER_TEXT[pending?.ends ?? "switch"]
        } ends it for every phone in it, and any placements not saved yet are lost.`}
        confirmLabel={ENDER_CONFIRM[pending?.ends ?? "switch"]}
        cancelLabel="Keep the room"
        onConfirm={() => {
          const go = pending?.go;
          setPending(null);
          go?.();
        }}
      />
    </div>
  );
}

/** What would end a live room: showing another board, deleting its board, clearing the example. */
type RoomEnder = "switch" | "delete" | "clear";
const ENDER_TEXT: Record<RoomEnder, string> = {
  switch: "Showing another board",
  delete: "Deleting the board",
  clear: "Clearing the example",
};
const ENDER_CONFIRM: Record<RoomEnder, string> = {
  switch: "End it and switch",
  delete: "End it and delete",
  clear: "End it and clear",
};

interface BoardActions {
  move: (itemId: string, lane: Lane, focus: () => void) => void;
  remove: (itemId: string) => void;
  setMode: (mode: SizingMode) => void;
  setBucketPoints: (bucketId: string, points: number | undefined) => void;
  setAnchor: (itemId: string) => void;
  deal: () => void;
  saveRound: (result: VoteRoundResult) => false | (() => void);
  split: (titles: string[]) => void;
  sendToPoker: () => void;
  addPastedToBacklog: () => void;
  saveSizes: () => void;
  deleteBoard: () => void;
  /** Its "Ask the room" opened (true) or ended (false). */
  liveChange: (live: boolean) => void;
  startTimebox: () => void;
  startLive: (stories: number) => void;
}

function BoardView({
  board,
  stories,
  names,
  onNames,
  actions: a,
}: {
  board: SizingBoard;
  stories: readonly Story[];
  names: string;
  onNames: (v: string) => void;
  actions: BoardActions;
}) {
  const c = boardCounts(board);
  const example = isExampleId(board.id);
  const pasted = board.items.filter((i) => !i.storyId).length;
  const toPoker = board.items.filter((i) => i.contested && i.storyId).length;
  const notesOf = (item: SizingItem) => stories.find((s) => s.id === item.storyId)?.notes;

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="board-title"
        className="space-y-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 id="board-title" className="text-lg font-semibold text-text">
              {board.title}
            </h2>
            <p className="text-xs text-sub">
              {plural(c.items, "story", "stories")} · {c.placed} placed · {c.unplaced} not placed ·{" "}
              {c.contested} to talk about · buckets {board.buckets.map((b) => b.label).join(", ")}
            </p>
          </div>
          <IconButton
            label={`Delete the board “${board.title}”`}
            icon={<Trash2 aria-hidden="true" />}
            variant="ghost"
            size="icon"
            onClick={a.deleteBoard}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ToggleGroup<SizingMode>
            label="How to sort"
            value={board.mode}
            onValueChange={a.setMode}
            options={[
              { value: "silent", label: "Silent sort" },
              { value: "buckets", label: "Anchor and deal" },
            ]}
          />
          <DockTimebox
            label={`Relative Sizing · ${board.title.slice(0, 40)}`}
            href={RELATIVE_SIZING_PATH}
            minutes={timeboxMinutes(c.items)}
            what="this board"
            onStart={a.startTimebox}
          />
        </div>
        <p className="text-sm text-sub">
          {board.mode === "silent"
            ? `Everyone moves cards without talking. A card moved ${board.moveLimit} times goes to Talk about it.`
            : "Place one known story first as the anchor, deal the rest out, let each person place theirs, then walk the buckets from the smallest."}
        </p>
        {board.mode === "buckets" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Anchor story"
              hint={`It goes in ${middleBucket(board).label}, the middle bucket.`}
            >
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={board.anchorItemId ?? ""}
                  onChange={(e) => a.setAnchor(e.target.value)}
                >
                  <option value="">No anchor</option>
                  {board.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex flex-col gap-2">
              <Field label="Deal the cards to" hint="Names, separated by commas.">
                {(props) => (
                  <Input
                    {...props}
                    value={names}
                    autoComplete="off"
                    onChange={(e) => onNames(e.target.value)}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={a.deal}
              >
                <Users aria-hidden="true" />
                Deal the cards
              </Button>
            </div>
          </div>
        )}
      </section>

      <SizingBoardView
        board={board}
        onMove={a.move}
        onRemove={a.remove}
        talk={(item) => (
          <TalkAbout board={board} item={item} notes={notesOf(item)} onSplit={a.split} />
        )}
      />

      <SectionCard title="Ask the room" icon={Radio} contentClassName="space-y-3">
        <p className="text-sm text-sub">
          Every phone places the stories privately. The room sees only how many people put each
          story in each bucket, and only once enough have answered.
        </p>
        <LiveRound
          board={board}
          onSave={a.saveRound}
          onStart={a.startLive}
          onLiveChange={a.liveChange}
        />
      </SectionCard>

      <SectionCard title="Save sizes" icon={Save} contentClassName="space-y-3">
        {example ? (
          <p className="text-sm text-sub">
            Example stories aren&apos;t in the backlog, so nothing is saved.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={a.saveSizes}>
                <Save aria-hidden="true" />
                Save sizes
              </Button>
              {toPoker > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="whitespace-normal text-left"
                  onClick={a.sendToPoker}
                >
                  <Send aria-hidden="true" />
                  Send {plural(toPoker, "story", "stories")} to Planning Poker
                </Button>
              )}
              {pasted > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="whitespace-normal text-left"
                  onClick={a.addPastedToBacklog}
                >
                  <Plus aria-hidden="true" />
                  Add {plural(pasted, "typed story", "typed stories")} to the backlog
                </Button>
              )}
            </div>
            <p className="text-xs text-sub">
              Save sizes writes each bucket&apos;s points to its backlog stories, with one Undo.
              Cards still to talk about, and buckets with no points, are skipped.
              {toPoker > 0 && " The stories still to talk about can go to Planning Poker instead."}
            </p>
            <BucketPoints board={board} onSet={a.setBucketPoints} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
