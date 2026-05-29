"use client";

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { type RetroFormat } from "@/lib/constants/retro-formats";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import type { BoardState } from "./types";
import { FormatSelector } from "./components/format-selector";
import { Board } from "./components/board";

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
  const upsertRetroBoard = useWorkspaceStore((s) => s.upsertRetroBoard);
  const removeRetroBoard = useWorkspaceStore((s) => s.removeRetroBoard);
  // RetroBoard is structurally BoardState + id, so it reads as BoardState here.
  const boardState: BoardState | null = board ?? null;
  const logger = useHistoryLogger("retro");

  const handleSelectFormat = useCallback(
    (format: RetroFormat) => {
      // Switching formats wipes every card — confirm first when there's work to lose.
      if (
        boardState &&
        boardState.cards.length > 0 &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Switching to "${format.name}" will clear all ${boardState.cards.length} cards on the current board. Continue?`
        )
      ) {
        return;
      }
      upsertRetroBoard({
        id: RB_ID,
        format,
        phase: "write",
        cards: [],
        userVotes: 0,
        timerSeconds: 300,
        timerRunning: false,
        discussingIndex: 0,
      });
      logger.log(RETRO_ACTIONS.FORMAT_CHANGED, { format: format.name });
    },
    [logger, boardState, upsertRetroBoard]
  );

  const handleReset = useCallback(() => {
    removeRetroBoard(RB_ID);
    logger.log(RETRO_ACTIONS.RETRO_RESET, {});
  }, [logger, removeRetroBoard]);

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
    return <FormatSelector onSelect={handleSelectFormat} />;
  }

  return <Board state={boardState} onUpdate={handleUpdate} onReset={handleReset} logger={logger} />;
}
