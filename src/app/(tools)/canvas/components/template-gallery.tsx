"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Sparkles, Search } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject, WhiteboardSavedTemplate } from "@/lib/stores/workspace-types";
import { TEMPLATES } from "@/lib/whiteboard/templates";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

interface Props {
  boardId: string;
  onClose: () => void;
}

export function TemplateGallery({ boardId, onClose }: Props) {
  // Stable callback ref so the keydown effect doesn't re-register on
  // every parent render (the canvas typically passes an inline
  // `onClose={() => setShowTemplates(false)}`).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc closes the modal — standard a11y pattern. Bubble phase so the
  // search input gets first crack at Esc (browsers commonly use Esc to
  // clear the IME composition / native autocomplete dropdown). We still
  // swallow propagation so the canvas-level Esc handler doesn't ALSO
  // clear the selection at the same time. INPUT/TEXTAREA guard avoids
  // eating an in-progress search query.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const upsertMany = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  const objects = useWorkspaceStore((s) =>
    (s.whiteboardObjects ?? []).filter((o) => o.boardId === boardId),
  );
  // Saved templates from the workspace (Phase 31). These appear in a
  // "Custom" category alongside the 11 built-ins.
  const savedTemplates = useWorkspaceStore((s) => s.whiteboardSavedTemplates ?? []);
  const { log } = useHistoryLogger("canvas");
  const [confirm, setConfirm] = useState<string | null>(null);
  // Phase 31 — search + category filter for the gallery.
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "custom" | "retro" | "planning" | "strategy" | "brainstorm">("all");

  // Combine built-ins + saved templates into a single filterable list.
  const allTemplates = useMemo(() => {
    type GalleryEntry = {
      id: string;
      name: string;
      description: string;
      category?: string;
      kind: "builtin" | "saved";
      saved?: WhiteboardSavedTemplate;
    };
    const builtins: GalleryEntry[] = TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      kind: "builtin" as const,
    }));
    const saved: GalleryEntry[] = savedTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? "Saved by your team.",
      category: t.category ?? "custom",
      kind: "saved" as const,
      saved: t,
    }));
    return [...builtins, ...saved];
  }, [savedTemplates]);

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTemplates.filter((t) => {
      if (category !== "all") {
        const c = t.category ?? "builtin";
        if (category === "custom" && t.kind !== "saved") return false;
        if (category !== "custom" && c !== category) return false;
      }
      if (q.length === 0) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [allTemplates, search, category]);

  const apply = (id: string) => {
    if (objects.length > 0 && confirm !== id) {
      setConfirm(id);
      return;
    }
    // Z-baseline: templates emit z-values starting at 1. Offset every
    // template object's z by max(existing.z) + 1 so applied templates
    // land visibly on top.
    let zBase = 0;
    for (const o of objects) if (o.z > zBase) zBase = o.z;
    // Look up the template in the combined list — handles both
    // built-ins (id matches TEMPLATES) and saved workspace templates.
    let seeded: WhiteboardObject[] = [];
    const builtIn = TEMPLATES.find((x) => x.id === id);
    if (builtIn) {
      seeded = builtIn.build().map((o) => ({ ...o, boardId, z: o.z + zBase } as WhiteboardObject));
    } else {
      const saved = savedTemplates.find((x) => x.id === id);
      if (!saved) return;
      // Saved templates carry their own objects array. Assign fresh
      // ids + boardId so they don't collide with the source board.
      const remap: Record<string, string> = {};
      const freshId = () => `wb_${Math.random().toString(36).slice(2, 11)}`;
      for (const o of saved.objects) remap[o.id] = freshId();
      const now = new Date().toISOString();
      seeded = saved.objects.map((o) => {
        const next: WhiteboardObject = {
          ...o,
          id: remap[o.id],
          boardId,
          z: o.z + zBase,
          version: 1,
          createdAt: now,
          updatedAt: now,
        } as WhiteboardObject;
        // Remap connector endpoints so they continue to land on the
        // cloned objects rather than the original ids.
        if (next.type === "connector") {
          next.fromId = remap[next.fromId] ?? next.fromId;
          next.toId = remap[next.toId] ?? next.toId;
          // If an endpoint isn't in the saved set, drop the connector.
          if (!remap[(o as { fromId: string }).fromId] || !remap[(o as { toId: string }).toId]) {
            return null;
          }
        }
        return next;
      }).filter((x): x is WhiteboardObject => x !== null);
    }
    if (seeded.length > 0) {
      upsertMany(seeded);
      log(CANVAS_ACTIONS.TEMPLATE_APPLIED, { template: id, count: seeded.length });
      emitSignal({
        kind: "whiteboard.templateApplied",
        at: new Date().toISOString(),
        toolId: "canvas",
        payload: { template: id, boardId },
      });
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
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
        <p className="text-sm text-sub mb-3">
          Click a template to seed the active board. {objects.length > 0 && (
            <span className="text-amber-400"> Confirm twice if the board already has content — templates append, not replace.</span>
          )}
        </p>

        {/* Search + category filter (Phase 31). */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sub" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              aria-label="Search templates"
              className="w-full bg-surface-deep border border-border rounded pl-7 pr-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            aria-label="Filter by category"
            className="bg-surface-deep border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
          >
            <option value="all">All ({allTemplates.length})</option>
            <option value="custom">Custom ({savedTemplates.length})</option>
            <option value="retro">Retro</option>
            <option value="planning">Planning</option>
            <option value="strategy">Strategy</option>
            <option value="brainstorm">Brainstorm</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {filteredTemplates.length === 0 && (
            <div className="col-span-full text-xs text-sub italic py-4 text-center">
              No templates match your search.
            </div>
          )}
          {filteredTemplates.map((t) => {
            const armed = confirm === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => apply(t.id)}
                className={`text-left border rounded-lg p-4 transition-colors relative ${
                  armed
                    ? "border-amber-400 bg-amber-500/10"
                    : "border-border bg-surface-deep hover:border-accent/40 hover:bg-accent/5"
                }`}
              >
                {t.kind === "saved" && (
                  <span className="absolute top-2 right-2 text-[9px] uppercase font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    Custom
                  </span>
                )}
                <div className="font-semibold text-sm text-text mb-1 pr-12">{t.name}</div>
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
