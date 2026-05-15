"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { LayoutTemplate, FileInput, Download, FileImage, FileCode, FileJson } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { generateCanvasPrompts } from "@/lib/ai-prompts/canvas";
import { boardInsights } from "@/lib/analytics/board-insights";
import { clusterObjects } from "@/lib/whiteboard/cluster-bridge";
import { fitToRects } from "@/lib/whiteboard/canvas-transform";
import { exportPng, exportSvg, exportJson } from "@/lib/whiteboard/export";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useCanvasStore } from "./use-canvas-store";
import { WhiteboardCanvas } from "./components/whiteboard-canvas";
import { ToolbarLeft } from "./components/toolbar-left";
import { ToolbarTop } from "./components/toolbar-top";
import { ZoomControls } from "./components/zoom-controls";
import { TemplateGallery } from "./components/template-gallery";
import { ImportModal } from "./components/import-modal";

export function CanvasClient() {
  const boards = useWorkspaceStore((s) => s.whiteboards ?? []);
  const upsertBoard = useWorkspaceStore((s) => s.upsertWhiteboard);
  const activeBoardId = useCanvasStore((s) => s.activeBoardId);
  const setActiveBoard = useCanvasStore((s) => s.setActiveBoard);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  // The workspace store uses skipHydration so we kick rehydration here and
  // track when it's done. Without this guard the lazy-create useEffect below
  // would fire BEFORE rehydration finishes — see an empty boards array,
  // create "My first board", and then rehydration restores the user's
  // actual boards, leaving them with a phantom extra board on every reload.
  const [hydrated, setHydrated] = useState(() =>
    typeof window === "undefined" ? false : useWorkspaceStore.persist.hasHydrated(),
  );
  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    // onFinishHydration fires when the rehydrate promise resolves —
    // including the success path where some keys were missing in storage.
    const off = useWorkspaceStore.persist.onFinishHydration(() => {
      if (!cancelled) setHydrated(true);
    });
    // Kick rehydration in case nobody else has yet (the app-shell does it,
    // but the canvas page may load before that mounts in some flows).
    void Promise.resolve(useWorkspaceStore.persist.rehydrate())
      .then(() => { if (!cancelled) setHydrated(true); })
      .catch(() => { if (!cancelled) setHydrated(true); /* still unblock UI */ });
    return () => { cancelled = true; off(); };
  }, [hydrated]);

  // Ensure at least one board exists, and one is active. Lazy-create on
  // mount — but only AFTER rehydration so we don't double-create.
  useEffect(() => {
    if (!hydrated) return;
    if (boards.length === 0) {
      const now = new Date().toISOString();
      const id = `wb_board_${Math.random().toString(36).slice(2, 11)}`;
      upsertBoard({ id, name: "My first board", createdAt: now, updatedAt: now });
      setActiveBoard(id);
      emitSignal({
        kind: "whiteboard.boardCreated",
        at: now,
        toolId: "canvas",
        payload: { boardId: id, source: "lazy-create" },
      });
      return;
    }
    if (!activeBoardId || !boards.some((b) => b.id === activeBoardId)) {
      setActiveBoard(boards[0].id);
    }
  }, [hydrated, boards, activeBoardId, upsertBoard, setActiveBoard]);

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  // Select the array reference (stable across non-whiteboard mutations), then
  // filter inside useMemo. Doing the filter inline in the Zustand selector
  // would build a fresh array on every snapshot — including snapshots
  // triggered by unrelated tools updating the store — and Zustand's default
  // Object.is would treat that as a state change, re-rendering the canvas
  // on every team-member add, story update, etc.
  const allObjects = useWorkspaceStore((s) => s.whiteboardObjects);
  const allComments = useWorkspaceStore((s) => s.whiteboardCommentThreads);
  const objects = useMemo(
    () => (allObjects ?? []).filter((o) => o.boardId === activeBoardId),
    [allObjects, activeBoardId],
  );
  const comments = useMemo(
    () => (allComments ?? []).filter((c) => c.boardId === activeBoardId),
    [allComments, activeBoardId],
  );

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      }),
    ),
  );

  const insights = useMemo(() => boardInsights(objects), [objects]);
  const clusters = useMemo(() => clusterObjects(objects), [objects]);

  const promptConfig = useMemo(() => ({
    toolName: "Canvas",
    prompts: activeBoard
      ? generateCanvasPrompts({ board: activeBoard, objects, comments, insights, clusters }, workspace)
      : [],
  }), [activeBoard, objects, comments, insights, clusters, workspace]);


  const onFit = () => {
    if (objects.length === 0 || viewportSize.w === 0) return;
    const rects = objects.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
    const camera = fitToRects(rects, viewportSize.w, viewportSize.h, 0.1);
    if (camera) setCamera(camera);
  };

  // ─── Template / Import / Export wiring ───────────────────────────────
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);

  const doExportPng = async () => {
    if (!canvasViewportRef.current || !activeBoard) return;
    try {
      await exportPng(canvasViewportRef.current, `${activeBoard.name || "canvas"}.png`);
    } catch (err) {
      // html-to-image can fail when remote images haven't CORS-loaded.
      // Surface to the user via console only — the toast layer isn't
      // wired here yet.
      console.warn("[canvas] PNG export failed:", err);
    }
  };
  const doExportSvg = () => {
    if (!activeBoard) return;
    exportSvg(activeBoard, objects, `${activeBoard.name || "canvas"}.svg`);
  };
  const doExportJson = () => {
    if (!activeBoard) return;
    exportJson(activeBoard, objects, comments, `${activeBoard.name || "canvas"}.json`);
  };

  return (
    <ToolPageWrapper
      toolId="canvas"
      title="Canvas"
      description="Infinite collaborative whiteboard — stickies, shapes, free-hand, smart connectors, AI clusters, cross-tool import. PR 22A ships the static canvas with pan/zoom and object creation."
    >
      <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
        <AiPromptGenerator config={promptConfig} />
        <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)}>
          <LayoutTemplate className="w-4 h-4 mr-1.5" />
          Templates
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
          <FileInput className="w-4 h-4 mr-1.5" />
          Import
        </Button>
        <div className="relative inline-flex">
          <Button variant="outline" size="sm" onClick={() => setShowExportMenu((v) => !v)}>
            <Download className="w-4 h-4 mr-1.5" />
            Export
          </Button>
          {showExportMenu && (
            <div
              className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg z-30 py-1 min-w-[160px]"
              onMouseLeave={() => setShowExportMenu(false)}
            >
              <button
                type="button"
                onClick={() => { void doExportPng(); setShowExportMenu(false); }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileImage className="w-4 h-4 text-sub" />
                PNG image
              </button>
              <button
                type="button"
                onClick={() => { doExportSvg(); setShowExportMenu(false); }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileCode className="w-4 h-4 text-sub" />
                SVG vector
              </button>
              <button
                type="button"
                onClick={() => { doExportJson(); setShowExportMenu(false); }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileJson className="w-4 h-4 text-sub" />
                JSON data
              </button>
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onFit} disabled={objects.length === 0}>
          Fit to content
        </Button>
      </div>

      <div
        ref={canvasViewportRef}
        className="relative h-[calc(100vh-260px)] min-h-[500px] w-full rounded-lg border border-border overflow-hidden bg-bg"
      >
        {activeBoardId ? (
          <WhiteboardCanvas boardId={activeBoardId} onViewportSize={setViewportSize} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sub text-sm">
            Pick or create a board to start.
          </div>
        )}
        <ToolbarLeft />
        <ToolbarTop />
        <ZoomControls onFit={onFit} viewportSize={viewportSize} />
      </div>

      {insights.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-sub">Board insights</div>
          {insights.map((i) => (
            <div
              key={i.id}
              className="text-xs border border-border bg-surface rounded p-2 flex items-start gap-2"
            >
              <span
                // Higher-contrast palette: light text on a darker
                // translucent base (was text-*-300 on bg-*-500/20 which
                // scored ~1.2:1 — WCAG fails). text-*-100 on bg-*-700/50
                // brings critical/warn/info badges above 4.5:1 in the
                // canvas's dark surface.
                className={`uppercase font-bold text-[10px] px-1.5 py-0.5 rounded ${
                  i.severity === "critical" ? "bg-red-700/50 text-red-100"
                  : i.severity === "warn" ? "bg-amber-700/50 text-amber-100"
                  : "bg-cyan-700/50 text-cyan-100"
                }`}
              >
                {i.severity}
              </span>
              <div>
                <div className="text-text font-medium">{i.title}</div>
                <div className="text-sub mt-0.5">{i.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showTemplates && activeBoardId && (
        <TemplateGallery boardId={activeBoardId} onClose={() => setShowTemplates(false)} />
      )}
      {showImport && activeBoardId && (
        <ImportModal boardId={activeBoardId} onClose={() => setShowImport(false)} />
      )}
    </ToolPageWrapper>
  );
}
