"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { type RetroFormat } from "@/lib/constants/retro-formats";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { undoable } from "@/lib/utils/undoable";
import type { RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import {
  RETRO_CURRENT_ID,
  blankRetroBoard,
  newestArchivedRetro,
  retroSprintFor,
} from "@/lib/retro/board";
import { sprintsNewestFirst, todayIso } from "@/lib/sprints/series";
import { readSprintParam } from "@/lib/sprints/use-selected-sprint";
import type { BoardState } from "./types";
import { FormatSelector } from "./components/format-selector";
import { Board } from "./components/board";
import {
  archivedRetroCopy,
  boardBeforeNewRetro,
  hasRetroContent,
  pastRetros,
  retroArchivesToPrune,
} from "./archive";
import { buildExample, withoutExampleCards } from "./example";

// ── Root Client ──────────────────────────────────────────────

// The retro board is a singleton document in the synced workspace store (one
// row under a fixed id) — previously it was ephemeral useState that reset on
// reload. Now it persists and syncs, and MCP-written cards round-trip in.
// The id is lib/retro/board's, which the agent actions and hand-offs use too.
const RB_ID = RETRO_CURRENT_ID;

const NO_SPRINTS: Sprint[] = [];

export function RetroClient() {
  const board = useWorkspaceStore(
    useShallow((s) => (s.retroBoards ?? []).find((b) => b.id === RB_ID))
  );
  const retroBoards = useWorkspaceStore((s) => s.retroBoards);
  const past = useMemo(() => pastRetros(retroBoards ?? []), [retroBoards]);
  const upsertRetroBoard = useWorkspaceStore((s) => s.upsertRetroBoard);
  const removeRetroBoard = useWorkspaceStore((s) => s.removeRetroBoard);
  // RetroBoard is structurally BoardState + id, so it reads as BoardState here.
  const boardState: BoardState | null = board ?? null;
  const logger = useHistoryLogger("retro");

  // ── The sprint a new board looks back on ──
  const allSprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const sprints = useMemo(() => sprintsNewestFirst(allSprints), [allSprints]);
  // A ?sprint= link (the cockpit's "Hold the retro") names it; read after
  // mount, so the server render and the first client render agree.
  const [linkedSprint, setLinkedSprint] = useState<string | null>(null);
  useEffect(() => setLinkedSprint(readSprintParam(window.location.search)), []);
  // undefined: the default below; null: "Not linked" was picked; else the pick.
  const [sprintChoice, setSprintChoice] = useState<string | null | undefined>(undefined);
  const defaultSprintId = useMemo(() => {
    if (linkedSprint && allSprints.some((s) => s.id === linkedSprint)) return linkedSprint;
    return retroSprintFor(todayIso(), allSprints)?.id;
  }, [linkedSprint, allSprints]);
  const newBoardSprintId =
    sprintChoice === undefined ? defaultSprintId : (sprintChoice ?? undefined);

  const handleSelectFormat = useCallback(
    (format: RetroFormat) => {
      // The picker only shows when there is no board, so nothing is lost here.
      // The new retro follows the newest archived one, whose actions it
      // offers to carry over, and looks back on the sprint shown above.
      const previous = newestArchivedRetro(useWorkspaceStore.getState().retroBoards ?? []);
      upsertRetroBoard(
        blankRetroBoard(format, {
          ...(previous ? { previousRetroId: previous.id } : {}),
          ...(newBoardSprintId ? { sprintId: newBoardSprintId } : {}),
        })
      );
      setSprintChoice(undefined);
      logger.log(RETRO_ACTIONS.FORMAT_CHANGED, {
        format: format.name,
        ...(newBoardSprintId ? { sprintId: newBoardSprintId } : {}),
      });
    },
    [logger, upsertRetroBoard, newBoardSprintId]
  );

  // "New Retro" keeps the finished board under Past retros (with its action
  // items) before clearing the current one. Example cards aren't the team's
  // retro, so they aren't kept. Past retros keep the latest
  // RETRO_ARCHIVE_LIMIT; the confirmation names the one that drops off.
  // Undo puts the board back, the dropped retro too.
  const handleReset = useCallback(() => {
    const boards = useWorkspaceStore.getState().retroBoards ?? [];
    const cur = boards.find((b) => b.id === RB_ID);
    if (!cur) return;
    if (cur.cards.length === 0) {
      // An empty board has nothing to keep or to undo.
      removeRetroBoard(RB_ID);
      logger.log(RETRO_ACTIONS.RETRO_RESET, {});
      return;
    }
    const own = { ...cur, cards: withoutExampleCards(cur.cards) };
    const keep = hasRetroContent(own);
    const pruneIds = keep ? new Set(retroArchivesToPrune(boards)) : new Set<string>();
    const pruned = boards.filter((b) => pruneIds.has(b.id));
    const archive = keep ? archivedRetroCopy(own) : null;
    undoable({
      label: keep ? "Started a new retro" : "Cleared the example board",
      description: keep
        ? `The last one is under Past retros${pruned.length > 0 ? `; ${pruned.length === 1 ? "the oldest past retro" : `${pruned.length} old retros`} dropped off` : ""}.`
        : undefined,
      apply: () => {
        for (const b of pruned) removeRetroBoard(b.id);
        if (archive) upsertRetroBoard(archive);
        removeRetroBoard(RB_ID);
        logger.log(RETRO_ACTIONS.RETRO_RESET, {});
      },
      revert: () => {
        const now = useWorkspaceStore.getState().retroBoards ?? [];
        const copy = archive ? now.find((b) => b.id === archive.id) : undefined;
        const started = now.find((b) => b.id === RB_ID);
        if (archive) removeRetroBoard(archive.id);
        for (const b of pruned) upsertRetroBoard(b);
        upsertRetroBoard({ ...boardBeforeNewRetro(cur, copy, started), id: RB_ID });
      },
    });
  }, [logger, removeRetroBoard, upsertRetroBoard]);

  // What "New Retro" will drop from Past retros, for its confirmation.
  const dropsOff = useMemo(() => {
    const ids = new Set(retroArchivesToPrune(retroBoards ?? []));
    return past.filter((b) => ids.has(b.id));
  }, [retroBoards, past]);

  // Offered only from the format picker, so there is no board to overwrite.
  // Not logged: loading the example isn't the team's work.
  const handleLoadExample = useCallback(() => {
    if ((useWorkspaceStore.getState().retroBoards ?? []).some((b) => b.id === RB_ID)) return;
    upsertRetroBoard({ id: RB_ID, ...buildExample() });
  }, [upsertRetroBoard]);

  // Removes only the example cards. A board left with none of the user's own
  // cards existed just for the example, so it goes back to the format picker.
  const handleClearExample = useCallback(() => {
    const cur = (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === RB_ID);
    if (!cur) return;
    const cards = withoutExampleCards(cur.cards);
    if (cards.length === 0) removeRetroBoard(RB_ID);
    else upsertRetroBoard({ ...cur, cards });
  }, [removeRetroBoard, upsertRetroBoard]);

  const handleDeletePast = useCallback(
    (retro: RetroBoard) => {
      undoable({
        label: "Deleted a past retro",
        apply: () => removeRetroBoard(retro.id),
        revert: () => upsertRetroBoard(retro),
      });
    },
    [removeRetroBoard, upsertRetroBoard]
  );

  const handleUpdate = useCallback(
    (updater: (prev: BoardState) => BoardState) => {
      // Read the freshest doc so rapid sequential updates don't clobber. Keep
      // the fixed id whatever the updater returns.
      const cur = (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === RB_ID);
      if (cur) upsertRetroBoard({ ...updater(cur), id: RB_ID });
    },
    [upsertRetroBoard]
  );

  if (!boardState) {
    return (
      <FormatSelector
        onSelect={handleSelectFormat}
        onLoadExample={handleLoadExample}
        past={past}
        onDeletePast={handleDeletePast}
        sprints={sprints}
        sprintId={newBoardSprintId}
        onSprintChange={(id) => setSprintChoice(id ?? null)}
      />
    );
  }

  return (
    <Board
      state={boardState}
      onUpdate={handleUpdate}
      onReset={handleReset}
      onClearExample={handleClearExample}
      logger={logger}
      dropsOff={dropsOff}
    />
  );
}
