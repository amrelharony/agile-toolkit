"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { X, FileInput } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  importFromRisks,
  importFromStories,
  importFromOkrs,
} from "@/lib/whiteboard/cross-tool-import";
import { parseJiraCsv, issuesToCards } from "@/lib/whiteboard/jira-import";
import { parseDiagramCsv, diagramToObjects } from "@/lib/whiteboard/smart-diagrams";
import { parseCsv, rowsToTable } from "@/lib/whiteboard/csv-to-table";
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
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
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

  /**
   * BUG-RD3-import-modal-1: read the FRESHEST z-baseline at click
   * time, not the closure-captured `allObjects` from render time.
   * Between render and the user clicking Import, a realtime peer
   * (or sibling import) could have added objects; the prior code
   * would land the new content UNDER that newer content. Always
   * pull `whiteboardObjects` from the live store inside the handler.
   */
  const freshZBaseline = (): number => {
    const live = useWorkspaceStore.getState().whiteboardObjects ?? [];
    let zBase = 0;
    for (const o of live) {
      if (o.boardId === boardId && o.z > zBase) zBase = o.z;
    }
    return zBase;
  };

  // R10-deferred: filter to THIS board's objects so the importers'
  // (tool, entityId) → existing-id reuse map only finds matches on
  // the current board (not stickies for the same Story on a sibling
  // board). This makes re-imports idempotent: re-running "Stories →
  // Swimlane" upserts the existing stickies instead of stacking a
  // second set.
  const boardObjects = useMemo(
    () => (allObjects ?? []).filter((o) => o.boardId === boardId),
    [allObjects, boardId]
  );
  const sources = useMemo(
    () => [
      {
        id: "stories" as const,
        label: "Stories → Swimlane",
        count: stories.length,
        description:
          "Drop all backlog stories onto a 5-stage swimlane (backlog · todo · in progress · review · done).",
        run: () => importFromStories(boardId, stories, boardObjects),
      },
      {
        id: "risks" as const,
        label: "Risks → P × I Matrix",
        count: risks.length,
        description: "Plot every risk on a 5×5 probability × impact grid, colored by score band.",
        run: () => importFromRisks(boardId, risks, boardObjects),
      },
      {
        id: "okrs" as const,
        label: "OKRs → Tree",
        count: okrs.length,
        description:
          "Lay out each Objective with its Key Results as a downward tree, connected by orthogonal arrows.",
        run: () => importFromOkrs(boardId, okrs, boardObjects),
      },
    ],
    [boardId, stories, risks, okrs, boardObjects]
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
    if (text.trim().length === 0) {
      setJiraPreview(null);
      return;
    }
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
  const [diagramParsed, setDiagramParsed] = useState<ReturnType<typeof parseDiagramCsv> | null>(
    null
  );
  const onDiagramCsvChange = (text: string) => {
    setDiagramCsv(text);
    if (text.trim().length === 0) {
      setDiagramParsed(null);
      return;
    }
    try {
      setDiagramParsed(parseDiagramCsv(text));
    } catch {
      setDiagramParsed({ shape: "unknown", rows: [], error: "Parse failed." });
    }
  };
  // Table-from-CSV import. Pastes a plain CSV and creates a
  // WhiteboardTable. Row 0 is treated as a header row.
  const [tableCsv, setTableCsv] = useState("");
  const [tableRows, setTableRows] = useState<string[][] | null>(null);
  const onTableCsvChange = (text: string) => {
    setTableCsv(text);
    if (text.trim().length === 0) {
      setTableRows(null);
      return;
    }
    try {
      const parsed = parseCsv(text);
      setTableRows(parsed.length > 0 ? parsed : null);
    } catch {
      setTableRows(null);
    }
  };
  const applyTable = () => {
    if (!tableRows || tableRows.length === 0) return;
    const zBase = freshZBaseline();
    // Land at world origin + 200px offset so the new table doesn't
    // overlap whatever else is at the centre.
    const table = rowsToTable(
      tableRows,
      boardId,
      { x: 200, y: 200 },
      {
        headerRow: true,
        z: zBase + 1,
      }
    );
    if (!table) return;
    upsertMany([table]);
    log(CANVAS_ACTIONS.IMPORT_PERFORMED, {
      source: "csv-table",
      rows: tableRows.length,
      cols: tableRows[0]?.length ?? 0,
    });
    emitSignal({
      kind: "whiteboard.crossToolImport",
      at: new Date().toISOString(),
      toolId: "canvas",
      payload: { source: "csv-table", boardId, count: 1 },
    });
    onClose();
  };

  const applyDiagram = () => {
    if (!diagramParsed || diagramParsed.rows.length === 0) return;
    // Land the diagram on the active board near world origin — the
    // user can pan/zoom or use Fit-to-content right after.
    const seeded = diagramToObjects(boardId, diagramParsed, { x: 200, y: 200 });
    if (seeded.length === 0) return;
    const zBase = freshZBaseline();
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
      payload: {
        source: "smart-diagram",
        shape: diagramParsed.shape,
        boardId,
        count: offset.length,
      },
    });
    onClose();
  };

  const applyJira = () => {
    const text = jiraCsv.trim();
    if (text.length === 0) return;
    const { issues } = parseJiraCsv(text);
    if (issues.length === 0) return;
    const seeded = issuesToCards(boardId, issues, boardObjects);
    const zBase = freshZBaseline();
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
    const zBase = freshZBaseline();
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

  // R10-deferred: focus-trap (WCAG 2.4.3).
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true });
  // Ids tying each paste box to its heading + help text.
  const uid = useId();

  return (
    // Backdrop: clicking outside the panel closes (Esc does the same from
    // the keyboard). The dialog role sits on the panel itself.
    <div
      role="presentation"
      className="fixed inset-0 z-modal flex items-center justify-center bg-bg/80 backdrop-blur-sm p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import from another tool"
        ref={dialogRef}
        className="relative bg-surface border border-border rounded-xl p-4 sm:p-6 w-[min(42rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain-strict"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close import dialog"
          className="absolute top-3 right-3 text-sub hover:text-text min-touch-coarse inline-flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-text flex items-center gap-2 mb-1">
          <FileInput className="w-5 h-5 text-accent" />
          Import from workspace
        </h2>
        <p className="text-sm text-sub mb-5">
          Pull existing toolkit data onto this board. Imports append — they don&apos;t clear the
          board.
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
            <label htmlFor={`${uid}-jira`} className="font-semibold text-sm text-text">
              Jira → Kanban
            </label>
            <span className="text-xs font-mono text-sub">
              {jiraPreview !== null
                ? `${jiraPreview} issue${jiraPreview === 1 ? "" : "s"} detected`
                : "paste CSV"}
            </span>
          </div>
          <div id={`${uid}-jira-hint`} className="text-xs text-sub mb-2">
            Paste the output of Jira&apos;s Issues navigator → Export CSV. Each issue becomes a card
            on a kanban frame (To Do / In Progress / Done).
          </div>
          <textarea
            id={`${uid}-jira`}
            aria-describedby={`${uid}-jira-hint`}
            value={jiraCsv}
            onChange={(e) => onJiraCsvChange(e.target.value)}
            placeholder="Issue key,Summary,Status,Assignee,Story Points,..."
            className="w-full h-24 bg-surface-deep border border-border rounded p-2 text-xs font-mono text-text resize-none focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={applyJira}
            disabled={!jiraPreview || jiraPreview === 0}
            className="mt-2 px-3 py-1.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/20 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
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
            <label htmlFor={`${uid}-diagram`} className="font-semibold text-sm text-text">
              Smart Diagram → Cards
            </label>
            <span className="text-xs font-mono text-sub">
              {diagramParsed
                ? diagramParsed.error
                  ? "parse failed"
                  : `${diagramParsed.rows.length} row${diagramParsed.rows.length === 1 ? "" : "s"} · ${diagramParsed.shape}`
                : "paste CSV"}
            </span>
          </div>
          <div id={`${uid}-diagram-hint`} className="text-xs text-sub mb-2">
            Paste a 2-column CSV. Tree shapes (<code className="text-text">name,parent</code> or{" "}
            <code className="text-text">name,reports_to</code>) auto-arrange as an org-chart. Flow
            shapes (<code className="text-text">from,to</code>) untangle via force-layout.
          </div>
          <textarea
            id={`${uid}-diagram`}
            aria-describedby={`${uid}-diagram-hint`}
            value={diagramCsv}
            onChange={(e) => onDiagramCsvChange(e.target.value)}
            placeholder={"name,parent\nCEO,\nVP Eng,CEO\nVP Sales,CEO\nDev Lead,VP Eng"}
            className="w-full h-24 bg-surface-deep border border-border rounded p-2 text-xs font-mono text-text resize-none focus:outline-none focus:border-accent"
          />
          {diagramParsed?.error && (
            <p className="text-xs text-warning mt-1">{diagramParsed.error}</p>
          )}
          <button
            type="button"
            onClick={applyDiagram}
            disabled={!diagramParsed || diagramParsed.rows.length === 0}
            className="mt-2 px-3 py-1.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/20 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import {diagramParsed?.rows.length ?? 0} row
            {diagramParsed?.rows.length === 1 ? "" : "s"} as {diagramParsed?.shape ?? "diagram"}
          </button>
        </div>

        {/* ─── CSV → Table ──────────────────────────────────────────
         * Paste any CSV; row 0 becomes the table header. Quoted
         * cells with embedded commas / quotes are handled by the
         * parser in csv-to-table.ts. */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor={`${uid}-table`} className="font-semibold text-sm text-text">
              CSV → Table
            </label>
            <span className="text-xs font-mono text-sub">
              {tableRows
                ? `${tableRows.length} row${tableRows.length === 1 ? "" : "s"} · ${tableRows[0]?.length ?? 0} col${tableRows[0]?.length === 1 ? "" : "s"}`
                : "paste CSV"}
            </span>
          </div>
          <div id={`${uid}-table-hint`} className="text-xs text-sub mb-2">
            Row 0 is treated as the header. Quoted cells (
            <code className="text-text">{'"embedded, comma"'}</code>) and CRLF endings are handled.
          </div>
          <textarea
            id={`${uid}-table`}
            aria-describedby={`${uid}-table-hint`}
            value={tableCsv}
            onChange={(e) => onTableCsvChange(e.target.value)}
            placeholder={
              'Name,Role,Status\nAlex,PM,Active\nSara,Eng,Active\n"Jordan, Lee",QA,On leave'
            }
            className="w-full h-24 bg-surface-deep border border-border rounded p-2 text-xs font-mono text-text resize-none focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={applyTable}
            disabled={!tableRows || tableRows.length === 0}
            className="mt-2 px-3 py-1.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/20 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import as table
          </button>
        </div>
      </div>
    </div>
  );
}
