"use client";

import { useEffect, useMemo } from "react";
import { X, FileInput } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { importFromRisks, importFromStories, importFromOkrs } from "@/lib/whiteboard/cross-tool-import";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

interface Props {
  boardId: string;
  onClose: () => void;
}

export function ImportModal({ boardId, onClose }: Props) {
  // Esc closes the modal (a11y) and is intercepted so it doesn't also
  // clear the canvas selection at the same time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const stories = useWorkspaceStore((s) => s.stories);
  const risks = useWorkspaceStore((s) => s.risks);
  const okrs = useWorkspaceStore((s) => s.okrs);
  const upsertMany = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  // Read existing objects so we can compute a z-baseline before applying
  // the import. Without this, imported objects come in at z=1+ which
  // can fall UNDER objects already on the board.
  const allObjects = useWorkspaceStore((s) => s.whiteboardObjects);
  const { log } = useHistoryLogger("canvas");

  const sources = useMemo(
    () => [
      {
        id: "stories" as const,
        label: "Stories → Swimlane",
        count: stories.length,
        description: "Drop all backlog stories onto a 5-stage swimlane (backlog · todo · in progress · review · done).",
        run: () => importFromStories(boardId, stories),
      },
      {
        id: "risks" as const,
        label: "Risks → P × I Matrix",
        count: risks.length,
        description: "Plot every risk on a 5×5 probability × impact grid, colored by score band.",
        run: () => importFromRisks(boardId, risks),
      },
      {
        id: "okrs" as const,
        label: "OKRs → Tree",
        count: okrs.length,
        description: "Lay out each Objective with its Key Results as a downward tree, connected by orthogonal arrows.",
        run: () => importFromOkrs(boardId, okrs),
      },
    ],
    [boardId, stories, risks, okrs],
  );

  const apply = (kind: "stories" | "risks" | "okrs") => {
    const src = sources.find((s) => s.id === kind);
    if (!src || src.count === 0) return;
    const seeded = src.run();
    if (seeded.length === 0) return;
    // Z-baseline so imports land visually on top of existing content.
    // Filter to objects on THIS board only — z-values from other boards
    // would over-inflate the baseline.
    let zBase = 0;
    for (const o of (allObjects ?? [])) {
      if (o.boardId === boardId && o.z > zBase) zBase = o.z;
    }
    const offset: WhiteboardObject[] = seeded.map((o) => ({ ...o, z: o.z + zBase }));
    upsertMany(offset);
    log(CANVAS_ACTIONS.IMPORT_PERFORMED, { source: kind, count: offset.length });
    emitSignal({
      kind: "whiteboard.crossToolImport",
      at: new Date().toISOString(),
      toolId: "canvas",
      payload: { source: kind, boardId, count: offset.length },
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Import from another tool"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-surface border border-border rounded-xl p-6 max-w-2xl w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close import dialog"
          className="absolute top-3 right-3 text-sub hover:text-text"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-text flex items-center gap-2 mb-1">
          <FileInput className="w-5 h-5 text-accent" />
          Import from workspace
        </h2>
        <p className="text-sm text-sub mb-5">
          Pull existing toolkit data onto this board. Imports append — they don't clear the board.
        </p>
        <div className="space-y-2">
          {sources.map((src) => (
            <button
              key={src.id}
              type="button"
              onClick={() => apply(src.id)}
              disabled={src.count === 0}
              className={`w-full text-left border rounded-lg p-3 transition-colors ${
                src.count === 0
                  ? "border-border bg-surface-deep opacity-50 cursor-not-allowed"
                  : "border-border bg-surface-deep hover:border-accent/40 hover:bg-accent/5"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-sm text-text">{src.label}</span>
                <span className="text-xs font-mono text-sub">
                  {src.count} {src.count === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="text-xs text-sub">{src.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
