"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  LayoutTemplate,
  FileInput,
  Download,
  FileImage,
  FileCode,
  FileJson,
  FileText,
  FileSpreadsheet,
  Share2,
  Activity,
  Presentation,
  Sparkles,
  Maximize2,
} from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { generateCanvasPrompts } from "@/lib/ai-prompts/canvas";
import { boardInsights, boardInsightsCross } from "@/lib/analytics/board-insights";
import { clusterObjects } from "@/lib/whiteboard/cluster-bridge";
import { fitToRects } from "@/lib/whiteboard/canvas-transform";
import {
  exportPng,
  exportSvg,
  exportJson,
  exportJpg,
  exportPdf,
  exportCsv,
  exportPptx,
} from "@/lib/whiteboard/export";
import { resolveShareToken } from "@/lib/whiteboard/share-link";
import { wbId } from "@/lib/whiteboard/clipboard";
import { emitSignal, subscribeSignals } from "@/lib/signals/signal-bus";
import type { WhiteboardCard, WhiteboardObject } from "@/lib/stores/workspace-types";
import { useCanvasStore } from "./use-canvas-store";
import { WhiteboardCanvas } from "./components/whiteboard-canvas";
import { ToolbarLeft } from "./components/toolbar-left";
import { ToolbarTop } from "./components/toolbar-top";
import { ZoomControls } from "./components/zoom-controls";
import { TemplateGallery } from "./components/template-gallery";
import { ImportModal } from "./components/import-modal";
import { FindBar } from "./components/find-bar";
import { ShareModal } from "./components/share-modal";
import { ActivityStream } from "./components/activity-stream";
import { TagFilterRow } from "./components/tag-filter-row";
import { VoiceInputButton } from "./components/voice-input-button";

/** Per-board access mode. Resolved from the URL with `?share=<token>`
 * winning over `?view=<role>` — the token's role is the source of
 * truth (it's signed-into-localStorage and validated). The `?view=`
 * param is consulted only when no token is present (preserves
 * permalink shares that pre-date the token system AND lets developers
 * test viewer/commenter modes without minting a token).
 *
 * Without this token check, a user handed a `?view=readonly&share=…`
 * link could simply delete `&view=readonly` from the address bar to
 * escape into editor mode — the share-link's role was never
 * consulted.
 *
 * Tiers:
 *   - `editor`    (default): full read + write
 *   - `commenter`: read-only objects, can drop new comment threads
 *   - `viewer`   : pure read-only
 */
type CanvasMode = "editor" | "commenter" | "viewer";

/**
 * Resolve the canvas mode from the URL synchronously, WITHOUT calling
 * the (now async) `resolveShareToken`. This is the initial state used
 * before the async token validation lands — it ignores `?share=` so a
 * malicious crafted URL can't grant editor before the server confirms
 * the role. The async effect below upgrades the mode once the token
 * is validated.
 *
 *   * If `?share=` is present, default to VIEWER. Editor / commenter
 *     can only be granted after the async lookup succeeds.
 *   * Otherwise honour `?view=readonly|commenter` literally.
 */
function getInitialCanvasMode(): CanvasMode {
  if (typeof window === "undefined") return "editor";
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share")) {
      // Demote to viewer until the async lookup elevates us. Principle
      // of least privilege during the validation window — a forged
      // `?share=…` shouldn't grant editor on first paint.
      return "viewer";
    }
    const v = params.get("view");
    if (v === "readonly") return "viewer";
    if (v === "commenter") return "commenter";
    return "editor";
  } catch {
    return "editor";
  }
}

/**
 * Async mode resolver — calls `resolveShareToken` against Supabase
 * (with localStorage fallback for legacy tokens) and returns the
 * appropriate mode. Used by an effect on mount + popstate.
 */
async function resolveCanvasMode(): Promise<CanvasMode> {
  if (typeof window === "undefined") return "editor";
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("share");
    if (token) {
      const hit = await resolveShareToken(token);
      if (hit) {
        if (hit.role === "viewer") return "viewer";
        if (hit.role === "commenter") return "commenter";
        return "editor";
      }
      // Token present but invalid — stay at viewer (no escalation).
      return "viewer";
    }
    const v = params.get("view");
    if (v === "readonly") return "viewer";
    if (v === "commenter") return "commenter";
    return "editor";
  } catch {
    return "editor";
  }
}

export function CanvasClient() {
  // Initial mode is the URL-driven mode WITHOUT the share-token lookup
  // (synchronous). The async effect below validates the token against
  // Supabase + localStorage and upgrades the mode when it resolves.
  // We deliberately START as viewer when `?share=` is present so a
  // brief render window can't grant editor on a forged URL.
  const [mode, setMode] = useState<CanvasMode>(() => getInitialCanvasMode());
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void resolveCanvasMode().then((next) => {
        if (!cancelled) setMode(next);
      });
    };
    refresh();
    const onPop = () => refresh();
    window.addEventListener("popstate", onPop);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  const readOnly = mode !== "editor";
  const canComment = mode !== "viewer";
  // Subscribe to AI panel visibility so we only run the expensive
  // TF-IDF clusterObjects call when the user actually has the panel
  // open. Solo edit sessions with the panel closed pay nothing.
  const showAIPanel = useCanvasStore((s) => s.showAIPanel);
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
    typeof window === "undefined" ? false : useWorkspaceStore.persist.hasHydrated()
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
      .then(() => {
        if (!cancelled) setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true); /* still unblock UI */
      });
    return () => {
      cancelled = true;
      off();
    };
  }, [hydrated]);

  // Ensure at least one board exists, and one is active. Lazy-create on
  // mount — but only AFTER rehydration so we don't double-create.
  //
  // R5: a per-tab ref latches the lazy-create so two tabs of the same
  // browser don't BOTH hit `boards.length === 0` and both create a
  // distinct "My first board" entry. Also re-check via getState()
  // before upserting in case a peer broadcast just landed.
  const lazyCreatedRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (boards.length === 0) {
      if (lazyCreatedRef.current) return;
      // Final guard: re-read the workspace store synchronously. If
      // a parallel tab raced ahead and seeded a board between our
      // boards-selector re-render and this effect, skip lazy-create.
      const liveBoards = useWorkspaceStore.getState().whiteboards ?? [];
      if (liveBoards.length > 0) {
        setActiveBoard(liveBoards[0].id);
        return;
      }
      lazyCreatedRef.current = true;
      const now = new Date().toISOString();
      const id = wbId("wb_board");
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

  // R9: memoise activeBoard so unrelated workspace mutations don't
  // produce a new reference and cascade into `promptConfig`'s deps.
  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId),
    [boards, activeBoardId]
  );

  // R10: drop the `o.type === "card"` filter — `importFromStories` in
  // cross-tool-import.ts emits STICKIES (not cards) with
  // `sourceRef.tool: "story"`. The previous filter missed sticky
  // updates when a backlog story was renamed, so the canvas kept
  // showing the stale title. Both types are now refreshed.
  // ─── Card ↔ Story bidirectional sync (Phase 26) ──────────────────────
  // When a Story changes in another tool (status / title / points),
  // sync the change down to any Card on the canvas whose sourceRef
  // points at that Story. We subscribe to the cross-tool signal bus
  // for the events declared in tools.ts.crossToolSubscriptions — the
  // subscription was previously declared but never wired.
  const upsertWhiteboardObjects = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  useEffect(() => {
    if (!hydrated) return;
    const unsub = subscribeSignals(
      // R10: extended kinds — risk.closed AND the four DACI/RAPID/
      // weighted/cynefin/stacey/polarity flavours; previously, closing
      // a risk or making a decision via any of those tools left the
      // canvas card showing the old title/status indefinitely.
      [
        "story.statusChanged",
        "risk.opened",
        "risk.closed",
        "okr.kr.updated",
        "decision.recorded",
        "decision.daciCreated",
        "decision.rapidCreated",
        "decision.weightedScored",
        "decision.cynefinClassified",
        "decision.staceyClassified",
        "decision.polarityMapped",
      ],
      (signal) => {
        try {
          // Each signal kind carries its id under a different field
          // name (storyId, riskId, krId, decisionId — set by
          // signal-bridge.ts when it diffs the workspace store).
          // A single generic ?? chain silently dropped sync for every
          // kind except stories, because the others don't pass
          // `storyId` / `id` / `entityId`. Resolve per-kind below.
          //
          // Runtime-validate the payload shape before reading it. A
          // hostile or buggy emitter could send wrong types; doing
          // typeof checks here means a malformed signal degrades to
          // a no-op rather than throwing inside the try/catch (which
          // would still surface in the console under NODE_ENV=dev).
          const raw: unknown = signal.payload;
          if (!raw || typeof raw !== "object") return;
          const p = raw as Record<string, unknown>;
          const pickStr = (k: string): string | undefined =>
            typeof p[k] === "string" ? (p[k] as string) : undefined;
          const payload = {
            storyId: pickStr("storyId"),
            riskId: pickStr("riskId"),
            okrId: pickStr("okrId"),
            krId: pickStr("krId"),
            decisionId: pickStr("decisionId"),
            entityId: pickStr("entityId"),
            id: pickStr("id"),
          };
          const state = useWorkspaceStore.getState();
          const now = new Date().toISOString();
          const updates: WhiteboardObject[] = [];

          // Helper — filter cards whose sourceRef points at a given
          // entity. Inline to avoid closing over stale state.
          //
          // R10: importFromStories/Risks/Okrs/Decisions all emit
          // STICKIES with `sourceRef`, NOT cards. The previous
          // `o.type === "card"` gate meant updates to imported
          // stickies never propagated. We still narrow to `card`
          // here because the card-specific spreads below assume
          // card fields (title/points/status). For stickies we
          // add a parallel updater.
          const cardsFor = (entityId: string): WhiteboardCard[] =>
            (state.whiteboardObjects ?? []).filter(
              (o): o is WhiteboardCard => o.type === "card" && o.sourceRef?.entityId === entityId
            );
          // R10: sticky updater — content lives in `content` on
          // WhiteboardSticky. Syncs the displayed text only (stickies
          // have no points/status fields).
          const updateStickyContent = (entityId: string, newContent: string) => {
            for (const s of state.whiteboardObjects ?? []) {
              if (s.type !== "sticky" || s.sourceRef?.entityId !== entityId) continue;
              updates.push({
                ...s,
                content: newContent,
                version: s.version + 1,
                updatedAt: now,
              });
            }
          };

          if (signal.kind === "story.statusChanged") {
            const id = payload.storyId ?? payload.entityId ?? payload.id;
            if (!id) return;
            const story = state.stories.find((s) => s.id === id);
            if (!story) return;
            for (const card of cardsFor(id)) {
              updates.push({
                ...card,
                title: story.title,
                points: story.points,
                status: story.status,
                version: card.version + 1,
                updatedAt: now,
              });
            }
            // R10: also refresh stickies (imported via importFromStories
            // with tool="story"). Display the same title + optional pts.
            const stickyText =
              story.points != null ? `${story.title} · ${story.points}pt` : story.title;
            updateStickyContent(id, stickyText);
          } else if (signal.kind === "risk.opened" || signal.kind === "risk.closed") {
            const id = payload.riskId ?? payload.entityId ?? payload.id;
            if (!id) return;
            const risk = state.risks.find((r) => r.id === id);
            if (!risk) return;
            for (const card of cardsFor(id)) {
              updates.push({
                ...card,
                title: risk.title,
                version: card.version + 1,
                updatedAt: now,
              });
            }
            updateStickyContent(id, risk.title);
          } else if (signal.kind === "okr.kr.updated") {
            // Cards link to KRs by KR id (not the parent OKR id),
            // so match `krId` first, not `okrId`.
            const krId = payload.krId ?? payload.entityId ?? payload.id;
            if (!krId) return;
            const okr = state.okrs.find((o) => o.keyResults.some((k) => k.id === krId));
            const kr = okr?.keyResults.find((k) => k.id === krId);
            if (!kr) return;
            for (const card of cardsFor(krId)) {
              updates.push({
                ...card,
                title: kr.title,
                version: card.version + 1,
                updatedAt: now,
              });
            }
          } else if (signal.kind === "decision.recorded") {
            const id = payload.decisionId ?? payload.entityId ?? payload.id;
            if (!id) return;
            const decision = state.decisions.find((d) => d.id === id);
            if (!decision) return;
            for (const card of cardsFor(id)) {
              updates.push({
                ...card,
                title: decision.title,
                version: card.version + 1,
                updatedAt: now,
              });
            }
          }
          if (updates.length > 0) upsertWhiteboardObjects(updates);
        } catch (err) {
          // Belt-and-braces: signal-bus already wraps dispatch in a
          // try/catch so a throw here won't break the bus, but log
          // in dev so the failure is visible during local testing.
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[canvas] card sync handler failed:", err);
          }
        }
      }
    );
    return unsub;
  }, [hydrated, upsertWhiteboardObjects]);

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
    [allObjects, activeBoardId]
  );
  const comments = useMemo(
    () => (allComments ?? []).filter((c) => c.boardId === activeBoardId),
    [allComments, activeBoardId]
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
      })
    )
  );

  // Merge baseline anti-patterns with cross-tool rules (card-disconnected,
  // tag-mismatch). Cross-tool rules need the workspace state — pass
  // through the same snapshot the AI prompts use so both surfaces stay
  // in sync.
  const insights = useMemo(
    () => [...boardInsights(objects), ...boardInsightsCross(objects, workspace)],
    [objects, workspace]
  );
  // Use content-aware (TF-IDF bag-of-words) clustering by default —
  // semantic clusters tend to be more useful than positional clusters
  // on brainstorm boards where users rarely arrange by topic from the
  // start. clusterObjects falls back to spatial mode when there's not
  // enough text to compute meaningful TF-IDF.
  //
  // Gate on `showAIPanel` so we don't run TF-IDF on every object-array
  // mutation (which is, during a drag, every single pointer-move) when
  // the AI panel isn't even open. The WhiteboardCanvas computes its own
  // gated clusters for the overlay; this copy feeds the AI prompt
  // generator and is only meaningful while the user is looking at it.
  const clusters = useMemo(
    () => (showAIPanel ? clusterObjects(objects, { mode: "content" }) : []),
    [showAIPanel, objects]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Canvas",
      prompts: activeBoard
        ? generateCanvasPrompts(
            { board: activeBoard, objects, comments, insights, clusters },
            workspace
          )
        : [],
    }),
    [activeBoard, objects, comments, insights, clusters, workspace]
  );

  const onFit = () => {
    if (objects.length === 0 || viewportSize.w === 0) return;
    const rects = objects.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
    const camera = fitToRects(rects, viewportSize.w, viewportSize.h, 0.1);
    if (camera) setCamera(camera);
  };

  // World-space centre of the current viewport — passed into the voice
  // input button so dictated stickies land where the user is looking
  // when they tapped the mic. Memoised so the prop identity stays
  // stable across renders that don't change viewport size (otherwise
  // VoiceInputButton's `start` callback re-creates on every render,
  // invalidating refs the recognizer's lifetime handlers rely on).
  const voiceWorldCenter = useCallback(() => {
    const camera = useCanvasStore.getState().camera;
    return {
      x: viewportSize.w > 0 ? camera.x + viewportSize.w / 2 / camera.zoom : camera.x + 400,
      y: viewportSize.h > 0 ? camera.y + viewportSize.h / 2 / camera.zoom : camera.y + 300,
    };
  }, [viewportSize.w, viewportSize.h]);

  // ─── Template / Import / Export wiring ───────────────────────────────
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showFindBar, setShowFindBar] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);

  // Selection setter pulled from canvas store so the find-bar can
  // select an object after panning to it.
  const setSelection = useCanvasStore((s) => s.setSelection);

  // Cmd+F / Ctrl+F opens the find bar. Captured at the window level
  // so it works regardless of focus inside the canvas. We deliberately
  // intercept before the browser's native find shortcut would scroll
  // the page — for an infinite canvas the native browser find is
  // useless anyway since most text lives in SVGs and absolutely-
  // positioned divs outside the document flow.
  //
  // INPUT/TEXTAREA/contentEditable guard: while a user is editing a
  // sticky / card title / comment textarea, Cmd+F is text-input
  // territory (some browsers offer in-field find, and we shouldn't
  // hijack typed input). Without this, hitting Cmd+F while editing a
  // sticky would yank focus away from the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F"))) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setShowFindBar(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // R5: sanitize the board name when used as a filename. A name like
  // "Goals / Q1" produces "Goals / Q1.png" which Chrome interprets as
  // a path component on Windows, dropping the file in a different
  // directory or failing entirely. Strip the Windows-illegal set plus
  // trim whitespace; fall back to "canvas" for blank/whitespace names.
  const exportFilename = (ext: string) => {
    const raw = (activeBoard?.name ?? "").trim();
    // eslint-disable-next-line no-control-regex
    const safe = (raw || "canvas").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100);
    return `${safe}.${ext}`;
  };
  /**
   * Fit the camera to the BOARD bounding box, await two animation frames
   * so the CSS transform applied by WhiteboardCanvas actually paints,
   * invoke the rasterise step, then restore the camera. We need the
   * temporary camera change because html-to-image captures the DOM as-
   * is — without fit-to-content the PNG/JPG/PDF would only contain
   * whatever happened to be visible in the viewport at click time.
   *
   * Restore is wrapped in a try/finally so an export error doesn't leave
   * the user looking at a zoomed-out blank canvas.
   *
   * Fit-margin is 10% (matches `onFit`), with a 40px world-space floor
   * baked into `fitToRects` so a tight cluster doesn't crop at the very
   * edge.
   */
  const exportFullBoard = async (
    rasterise: (node: HTMLElement) => Promise<void>
  ): Promise<void> => {
    const node = canvasViewportRef.current;
    if (!node || !activeBoard) return;
    if (objects.length === 0) {
      // Nothing to capture — fall back to a plain viewport snapshot so
      // the user at least gets the empty board's background.
      await rasterise(node);
      return;
    }
    const savedCamera = useCanvasStore.getState().camera;
    try {
      const rects = objects.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
      const fitted = fitToRects(rects, viewportSize.w, viewportSize.h, 0.1);
      if (fitted) {
        setCamera(fitted);
        // Two rAFs: first lands React's state→DOM transform, second
        // gives the browser a paint tick so html-to-image reads the
        // post-transform layout. One rAF was occasionally insufficient
        // on Chromium when DevTools was open (paint debounced).
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r()))
        );
      }
      await rasterise(node);
    } finally {
      setCamera(savedCamera);
    }
  };

  const doExportPng = async () => {
    if (!canvasViewportRef.current || !activeBoard) return;
    try {
      await exportFullBoard((node) => exportPng(node, exportFilename("png")));
    } catch (err) {
      // html-to-image can fail when remote images haven't CORS-loaded.
      // Surface to the user via console only — the toast layer isn't
      // wired here yet.
      console.warn("[canvas] PNG export failed:", err);
    }
  };
  const doExportSvg = () => {
    if (!activeBoard) return;
    exportSvg(activeBoard, objects, exportFilename("svg"));
  };
  const doExportJson = () => {
    if (!activeBoard) return;
    exportJson(activeBoard, objects, comments, exportFilename("json"));
  };
  const doExportJpg = async () => {
    if (!canvasViewportRef.current || !activeBoard) return;
    try {
      await exportFullBoard((node) => exportJpg(node, exportFilename("jpg")));
    } catch (err) {
      console.warn("[canvas] JPG export failed:", err);
    }
  };
  const doExportPdf = async () => {
    if (!canvasViewportRef.current || !activeBoard) return;
    try {
      await exportFullBoard((node) => exportPdf(node, exportFilename("pdf")));
    } catch (err) {
      console.warn("[canvas] PDF export failed:", err);
    }
  };
  const doExportCsv = () => {
    if (!activeBoard) return;
    exportCsv(objects, exportFilename("csv"));
  };
  const doExportPptx = () => {
    if (!activeBoard) return;
    exportPptx(activeBoard, objects, exportFilename("html"));
  };

  return (
    <ToolPageWrapper
      toolId="canvas"
      title="Canvas"
      description="Infinite collaborative whiteboard with smart connectors, AI clusters, and cross-tool import."
    >
      {/* Action bar — grouped into three clusters with subtle dividers so
          the eye can read it as
            [content actions] | [share/observe] | [view utility]
          instead of a single long row where Fit-to-content drifted to the
          far right edge disconnected from everything else. Left-aligned
          (was justify-end) so the leftmost cluster sits where the user's
          eye lands first.

          Responsive behaviour: button labels hide on <sm screens (icons
          only) so the action bar fits in a single row on narrow viewports.
          The tooltip + aria-label preserve the affordance for keyboard
          and screen-reader users. */}
      <div className="flex items-center gap-1.5 sm:gap-2 mb-3 flex-wrap">
        {/* Cluster 1 — content actions (create / fill the board) */}
        <AiPromptGenerator config={promptConfig} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTemplates(true)}
          className="gap-1.5"
          title="Browse templates"
          aria-label="Browse templates"
        >
          <LayoutTemplate className="w-4 h-4" />
          <span className="hidden sm:inline">Templates</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowImport(true)}
          className="gap-1.5"
          title="Import from another tool"
          aria-label="Import from another tool"
        >
          <FileInput className="w-4 h-4" />
          <span className="hidden sm:inline">Import</span>
        </Button>
        <div className="relative inline-flex">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExportMenu((v) => !v)}
            className="gap-1.5"
            title="Export the board"
            aria-label="Export the board"
            aria-expanded={showExportMenu}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          {showExportMenu && (
            <div
              className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg z-30 py-1 min-w-[160px]"
              onMouseLeave={() => setShowExportMenu(false)}
            >
              <button
                type="button"
                onClick={() => {
                  void doExportPng();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileImage className="w-4 h-4 text-sub" />
                PNG image
              </button>
              <button
                type="button"
                onClick={() => {
                  doExportSvg();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileCode className="w-4 h-4 text-sub" />
                SVG vector
              </button>
              <button
                type="button"
                onClick={() => {
                  void doExportJpg();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileImage className="w-4 h-4 text-sub" />
                JPG image
              </button>
              <button
                type="button"
                onClick={() => {
                  void doExportPdf();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileText className="w-4 h-4 text-sub" />
                PDF (print)
              </button>
              <button
                type="button"
                onClick={() => {
                  doExportCsv();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileSpreadsheet className="w-4 h-4 text-sub" />
                CSV (text rows)
              </button>
              <button
                type="button"
                onClick={() => {
                  doExportPptx();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
                title="Saves an .html file. Open with PowerPoint (Right-click → Open with) to embed as a slide."
              >
                <Presentation className="w-4 h-4 text-sub" />
                PowerPoint slide
              </button>
              <button
                type="button"
                onClick={() => {
                  doExportJson();
                  setShowExportMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-deep flex items-center gap-2 text-text"
              >
                <FileJson className="w-4 h-4 text-sub" />
                JSON data
              </button>
            </div>
          )}
        </div>
        {/* Cluster 2 — share + observe (less-frequent ops) */}
        <div className="w-px h-5 bg-border mx-1 hidden sm:block" aria-hidden="true" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowShare(true)}
          disabled={!activeBoardId}
          className="gap-1.5"
          title="Share this board"
          aria-label="Share this board"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowActivity((v) => !v)}
          disabled={!activeBoardId}
          className="gap-1.5"
          title="Show activity stream"
          aria-label="Show activity stream"
        >
          <Activity className="w-4 h-4" />
          <span className="hidden sm:inline">Activity</span>
        </Button>
        {/* Cluster 3 — view utility, pushed right (auto-spaced from the
            cluster above by `ml-auto` so it sits on the opposite edge of
            the action bar — natural home for view-control actions). */}
        <Button
          variant="outline"
          size="sm"
          onClick={onFit}
          disabled={objects.length === 0}
          className="ml-auto gap-1.5"
          title="Pan and zoom so every object fits the viewport"
          aria-label="Fit to content"
        >
          <Maximize2 className="w-4 h-4" />
          <span className="hidden sm:inline">Fit to content</span>
        </Button>
      </div>

      <div
        ref={canvasViewportRef}
        // Responsive viewport height:
        //   - 100dvh (dynamic viewport height): on mobile browsers,
        //     adjusts to the *currently-visible* viewport — so when the
        //     address bar collapses on scroll, the canvas reclaims that
        //     space without us having to listen for resize events.
        //     Plain `100vh` is the *largest* possible viewport on iOS
        //     Safari, which means the canvas extends BELOW the address
        //     bar and the user can't reach the bottom toolbar/hint.
        //   - 220px reserved chrome: app header + page title + action
        //     bar + a comfortable bottom gutter. On <sm screens the
        //     action bar wraps to 2 rows so we add a tighter floor
        //     via min-h.
        //   - min-h falls from 520px (desktop) to 440px (small) so the
        //     board stays usable on a 667px-tall portrait phone where
        //     220px of chrome leaves only 447px for the canvas.
        className="relative h-[calc(100dvh-220px)] min-h-[440px] sm:min-h-[520px] w-full rounded-lg border border-border overflow-hidden bg-bg"
      >
        {activeBoardId ? (
          <WhiteboardCanvas
            boardId={activeBoardId}
            onViewportSize={setViewportSize}
            readOnly={readOnly}
            canComment={canComment}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sub text-sm">
            Pick or create a board to start.
          </div>
        )}
        {!readOnly && <ToolbarLeft />}
        {!readOnly && <ToolbarTop />}
        {!readOnly && <TagFilterRow objects={objects} />}
        {/* Voice input button — pinned to top-right next to ZoomControls
            so it stays one click away during retros / standups.
            Phase 33. */}
        {!readOnly && activeBoardId && (
          <div
            className="absolute top-3 right-3 z-20 bg-surface/95 border border-border rounded-lg p-0.5 shadow-md backdrop-blur-sm"
            data-canvas-export-ignore="true"
          >
            <VoiceInputButton boardId={activeBoardId} worldCenter={voiceWorldCenter} />
          </div>
        )}
        <ZoomControls onFit={onFit} viewportSize={viewportSize} />
        {readOnly && (
          <div
            data-canvas-export-ignore="true"
            className={`absolute top-3 left-3 z-20 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded ${
              mode === "commenter"
                ? "bg-cyan-700/40 text-cyan-100"
                : "bg-amber-700/40 text-amber-100"
            }`}
          >
            {mode === "commenter" ? "Commenter view — drop comments only" : "Read-only view"}
          </div>
        )}
        {showFindBar && (
          <FindBar
            objects={objects}
            viewportSize={viewportSize}
            onPanToRect={setCamera}
            onSelect={setSelection}
            onClose={() => setShowFindBar(false)}
          />
        )}
        {/* Empty-state — only on an editor's first encounter with an
            empty board. The board grid + toolbars by themselves give no
            indication of what to do next, which is a high-friction
            opening moment for a creative tool. Routes the user to the
            two highest-value entry points (Templates + Import); the
            keyboard-shortcut hint sits inline next to a sticky icon so
            the user can still see "I can also just press N". Hidden in
            read-only and commenter modes since those viewers can't
            create objects anyway. */}
        {!readOnly && activeBoardId && objects.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
            <div
              className="pointer-events-auto text-center w-[min(360px,calc(100%-2rem))] px-5 py-5 rounded-xl bg-surface/90 border border-border backdrop-blur-md shadow-xl"
              data-canvas-export-ignore="true"
            >
              <Sparkles
                className="w-7 h-7 text-accent mx-auto mb-2 opacity-70"
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold text-text mb-1">Start your board</h3>
              <p className="text-xs text-sub mb-3">
                Pick a template or import — or press{" "}
                <kbd className="font-mono text-[10px] bg-surface-deep border border-border rounded px-1 py-0.5">
                  N
                </kbd>{" "}
                for a sticky.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setShowTemplates(true)}
                  className="gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold"
                >
                  <LayoutTemplate className="w-3.5 h-3.5" />
                  Templates
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImport(true)}
                  className="gap-1.5"
                >
                  <FileInput className="w-3.5 h-3.5" />
                  Import
                </Button>
              </div>
            </div>
          </div>
        )}
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
                  i.severity === "critical"
                    ? "bg-red-700/50 text-red-100"
                    : i.severity === "warn"
                      ? "bg-amber-700/50 text-amber-100"
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
      {showShare && activeBoardId && activeBoard && (
        <ShareModal
          boardId={activeBoardId}
          boardName={activeBoard.name}
          onClose={() => setShowShare(false)}
        />
      )}
      {showActivity && activeBoardId && (
        <ActivityStream boardId={activeBoardId} onClose={() => setShowActivity(false)} />
      )}
    </ToolPageWrapper>
  );
}
