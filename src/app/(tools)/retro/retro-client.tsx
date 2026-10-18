"use client";

import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { type RetroFormat } from "@/lib/constants/retro-formats";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { undoable } from "@/lib/utils/undoable";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import type { BoardState } from "./types";
import { FormatSelector } from "./components/format-selector";
import { Board } from "./components/board";
import { archivedRetroCopy, hasRetroContent, pastRetros, retroArchivesToPrune } from "./archive";
import { buildExample, withoutExampleCards } from "./example";

// ── Root Client ──────────────────────────────────────────────

// The retro board is a singleton document in the synced workspace store (one
// row under a fixed id) — previously it was ephemeral useState that reset on
// reload. Now it persists and syncs, and MCP-written cards round-trip in.
// MUST match RB_ID in src/lib/actions/tools/retro.ts.
const RB_ID = "retro:current";

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

  const handleSelectFormat = useCallback(
    (format: RetroFormat) => {
      // The picker only shows when there is no board, so nothing is lost here.
      // The new retro follows the newest archived one, whose actions it
      // offers to carry over.
      const previous = pastRetros(useWorkspaceStore.getState().retroBoards ?? [])[0];
      upsertRetroBoard({
        id: RB_ID,
        format,
        phase: "write",
        cards: [],
        userVotes: 0,
        timerSeconds: 300,
        timerRunning: false,
        discussingIndex: 0,
        ...(previous ? { previousRetroId: previous.id } : {}),
      });
      logger.log(RETRO_ACTIONS.FORMAT_CHANGED, { format: format.name });
    },
    [logger, upsertRetroBoard]
  );

  // "New Retro" keeps the finished board under Past retros (with its action
  // items) before clearing the current one. Example cards aren't the team's
  // retro, so they aren't kept.
  const handleReset = useCallback(() => {
    const boards = useWorkspaceStore.getState().retroBoards ?? [];
    const cur = boards.find((b) => b.id === RB_ID);
    const own = cur && { ...cur, cards: withoutExampleCards(cur.cards) };
    if (hasRetroContent(own)) {
      for (const id of retroArchivesToPrune(boards)) removeRetroBoard(id);
      upsertRetroBoard(archivedRetroCopy(own));
    }
    removeRetroBoard(RB_ID);
    logger.log(RETRO_ACTIONS.RETRO_RESET, {});
  }, [logger, removeRetroBoard, upsertRetroBoard]);

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
    />
  );
}
