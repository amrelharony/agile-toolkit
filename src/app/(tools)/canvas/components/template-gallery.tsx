"use client";

import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { TEMPLATES } from "@/lib/whiteboard/templates";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

interface Props {
  boardId: string;
  onClose: () => void;
}

export function TemplateGallery({ boardId, onClose }: Props) {
  // Esc closes the modal — standard a11y pattern. We swallow the event so
  // the canvas-level Esc handler doesn't ALSO clear the selection at the
  // same time (the user pressed Esc to close the gallery, not to deselect).
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
  const upsertMany = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  const objects = useWorkspaceStore((s) =>
    (s.whiteboardObjects ?? []).filter((o) => o.boardId === boardId),
  );
  const { log } = useHistoryLogger("canvas");
  const [confirm, setConfirm] = useState<string | null>(null);

  const apply = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    // Confirm overwrite if the board already has content.
    if (objects.length > 0 && confirm !== id) {
      setConfirm(id);
      return;
    }
    // Z-baseline: templates emit z-values starting at 1. If the board
    // already has objects at z=5,6,7,…, the template would render UNDER
    // them. Offset every template object's z by max(existing.z) + 1 so
    // applied templates land visibly on top.
    let zBase = 0;
    for (const o of objects) if (o.z > zBase) zBase = o.z;
    const seeded: WhiteboardObject[] = t.build().map((o) => ({
      ...o,
      boardId,
      z: o.z + zBase,
    } as WhiteboardObject));
    if (seeded.length > 0) {
      upsertMany(seeded);
      log(CANVAS_ACTIONS.TEMPLATE_APPLIED, { template: t.id, count: seeded.length });
      emitSignal({
        kind: "whiteboard.templateApplied",
        at: new Date().toISOString(),
        toolId: "canvas",
        payload: { template: t.id, boardId },
      });
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Template gallery"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-surface border border-border rounded-xl p-6 max-w-3xl w-[92vw] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close template gallery"
          className="absolute top-3 right-3 text-sub hover:text-text"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-text flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-accent" />
          Templates
        </h2>
        <p className="text-sm text-sub mb-5">
          Click a template to seed the active board. {objects.length > 0 && (
            <span className="text-amber-400"> Confirm twice if the board already has content — templates append, not replace.</span>
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {TEMPLATES.map((t) => {
            const armed = confirm === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => apply(t.id)}
                className={`text-left border rounded-lg p-4 transition-colors ${
                  armed
                    ? "border-amber-400 bg-amber-500/10"
                    : "border-border bg-surface-deep hover:border-accent/40 hover:bg-accent/5"
                }`}
              >
                <div className="font-semibold text-sm text-text mb-1">{t.name}</div>
                <div className="text-xs text-sub line-clamp-3">{t.description}</div>
                {armed && (
                  <div className="text-xs text-amber-300 mt-2">
                    Click again to confirm — will add to existing content
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
