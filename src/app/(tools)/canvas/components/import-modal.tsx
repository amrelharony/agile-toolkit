"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, FileInput } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { importFromRisks, importFromStories, importFromOkrs } from "@/lib/whiteboard/cross-tool-import";
import { parseJiraCsv, issuesToCards } from "@/lib/whiteboard/jira-import";
import { parseDiagramCsv, diagramToObjects } from "@/lib/whiteboard/smart-diagrams";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

interface Props {
  boardId: string;
  onClose: () => void;
}

export function ImportModal({ boardId, onClose }: Props) {
  // Stable callback ref so the keydown effect doesn't re-register on
  // every parent render (the canvas typically passes an inline
  // `onClose={() => setShowImport(false)}`).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc closes the modal. Bubble phase (not capture) so form fields
  // inside the modal — Jira CSV textarea, diagram CSV textarea —
  // get first crack at Esc (IME composition, native autocomplete
  // dismissal). Capture-phase would otherwise eat in-progress input.
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

  // Jira CSV paste import (Phase 30). The user pastes the export from
  // Jira's Issues navigator → CSV. We parse it client-side (no API key
  // required) and convert each issue into a Card laid out on a Kanban
  // frame. Each card carries sourceRef = { tool: "jira", entityId: key }
  // so future sync can push back updates when the Jira API client lands.
  const [jiraCsv, setJiraCsv] = useState("");
  const [jiraPreview, setJiraPreview] = useState<number | null>(null);
  const onJiraCsvChange = (text: string) => {
    setJiraCsv(text);
    if (text.trim().length === 0) { setJiraPreview(null); return; }
    try {
      const { issues } = parseJiraCsv(text);
      setJiraPreview(issues.length);
    } catch {
      setJiraPreview(0);
    }
  };
  // Smart Diagrams CSV paste import (Phase 33). Recognises two shapes:
  // tree / org-chart (name,parent) and flowchart (from,to). Reuses our
  // treeLayout / forceLayout primitives. No external CSV parser dep.
  const [diagramCsv, setDiagramCsv] = useState("");
  const [diagramParsed, setDiagramParsed] = useState<ReturnType<typeof parseDiagramCsv> | null>(null);
  const onDiagramCsvChange = (text: string) => {
    setDiagramCsv(text);
    if (text.trim().length === 0) { setDiagramParsed(null); return; }
    try {
      setDiagramParsed(parseDiagramCsv(text));
    } catch {
      setDiagramParsed({ shape: "unknown", rows: [], error: "Parse failed." });
    }
  };
  const applyDiagram = () => {
    if (!diagramParsed || diagramParsed.rows.length === 0) return;
    // Land the diagram on the active board near world origin — the
    // user can pan/zoom or use Fit-to-content right after.
    const seeded = diagramToObjects(boardId, diagramParsed, { x: 200, y: 200 });
    if (seeded.length === 0) return;
    let zBase = 0;
    for (const o of (allObjects ?? [])) {
      if (o.boardId === boardId && o.z > zBase) zBase = o.z;
    }
    const offset: WhiteboardObject[] = seeded.map((o) => ({ ...o, z: o.z + zBase }));
    upsertMany(offset);
    log(CANVAS_ACTIONS.IMPORT_PERFORMED, {
      source: "smart-diagram",
      shape: diagramParsed.shape,
      count: offset.length,
    });
    emitSignal({
      kind: "whiteboard.crossToolImport",
      at: new Date().toISOString(),
      toolId: "canvas",
      payload: { source: "smart-diagram", shape: diagramParsed.shape, boardId, count: offset.length },
    });
    onClose();
  };

  const applyJira = () => {
    const text = jiraCsv.trim();
    if (text.length === 0) return;
    const { issues } = parseJiraCsv(text);
    if (issues.length === 0) return;
    const seeded = issuesToCards(boardId, issues);
    let zBase = 0;
    for (const o of (allObjects ?? [])) {
      if (o.boardId === boardId && o.z > zBase) zBase = o.z;
    }
    const offset: WhiteboardObject[] = seeded.map((o) => ({ ...o, z: o.z + zBase }));
    upsertMany(offset);
    log(CANVAS_ACTIONS.IMPORT_PERFORMED, { source: "jira", count: offset.length });
    emitSignal({
      kind: "whiteboard.crossToolImport",
      at: new Date().toISOString(),
      toolId: "canvas",
      payload: { source: "jira", boardId, count: offset.length },
    });
    onClose();
  };

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
      aria-modal="true"
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

        {/* ─── Phase 30: Jira CSV paste import ─────────────────────── */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm text-text">Jira → Kanban</span>
            <span className="text-xs font-mono text-sub">
              {jiraPreview !== null ? `${jiraPreview} issue${jiraPreview === 1 ? "" : "s"} detected` : "paste CSV"}
            </span>
          </div>
          <div className="text-xs text-sub mb-2">
            Paste the output of Jira's Issues navigator → Export CSV. Each issue becomes a card on a kanban frame (To Do / In Progress / Done).
          </div>
          <textarea
            value={jiraCsv}
            onChange={(e) => onJiraCsvChange(e.target.value)}
            placeholder='Issue key,Summary,Status,Assignee,Story Points,...'
            className="w-full h-24 bg-surface-deep border border-border rounded p-2 text-[11px] font-mono text-text resize-none focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={applyJira}
            disabled={!jiraPreview || jiraPreview === 0}
            className="mt-2 px-3 py-1.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import {jiraPreview ?? 0} issue{jiraPreview === 1 ? "" : "s"}
          </button>
        </div>

        {/* ─── Phase 33: Smart Diagrams from CSV ─────────────────────
         * 2-column CSV becomes a tree or flowchart. Recognises common
         * headers (name,parent / from,to / source,target) plus
         * header-less data. Cycle-detect routes ambiguous shapes to
         * flowchart so we don't infinite-loop the tree layout. */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm text-text">Smart Diagram → Cards</span>
            <span className="text-xs font-mono text-sub">
              {diagramParsed
                ? diagramParsed.error
                  ? "parse failed"
                  : `${diagramParsed.rows.length} row${diagramParsed.rows.length === 1 ? "" : "s"} · ${diagramParsed.shape}`
                : "paste CSV"}
            </span>
          </div>
          <div className="text-xs text-sub mb-2">
            Paste a 2-column CSV. Tree shapes (<code className="text-text">name,parent</code> or <code className="text-text">name,reports_to</code>) auto-arrange as an org-chart. Flow shapes (<code className="text-text">from,to</code>) untangle via force-layout.
          </div>
          <textarea
            value={diagramCsv}
            onChange={(e) => onDiagramCsvChange(e.target.value)}
            placeholder={'name,parent\nCEO,\nVP Eng,CEO\nVP Sales,CEO\nDev Lead,VP Eng'}
            className="w-full h-24 bg-surface-deep border border-border rounded p-2 text-[11px] font-mono text-text resize-none focus:outline-none focus:border-accent"
          />
          {diagramParsed?.error && (
            <p className="text-[11px] text-amber-300 mt-1">{diagramParsed.error}</p>
          )}
          <button
            type="button"
            onClick={applyDiagram}
            disabled={!diagramParsed || diagramParsed.rows.length === 0}
            className="mt-2 px-3 py-1.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import {diagramParsed?.rows.length ?? 0} row{diagramParsed?.rows.length === 1 ? "" : "s"} as {diagramParsed?.shape ?? "diagram"}
          </button>
        </div>
      </div>
    </div>
  );
}
