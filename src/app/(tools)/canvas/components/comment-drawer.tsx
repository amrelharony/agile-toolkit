"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Send, CheckCircle2 } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardCommentThread } from "@/lib/stores/workspace-types";
import { emitSignal } from "@/lib/signals/signal-bus";
import { wbId } from "@/lib/whiteboard/clipboard";

/**
 * @mention character class. Uses Unicode property escapes (`\p{L}` =
 * any letter, `\p{N}` = any number) so non-ASCII first names — Müller,
 * 张, José, Ülkü — match the autocomplete and the parser. The previous
 * `[A-Za-z0-9_-]` class silently excluded every international team
 * member whose name didn't transliterate to ASCII.
 *
 * We construct via `new RegExp(..., "u")` rather than a literal `/.../u`
 * because the project's `tsc` target is the implicit default (ES3),
 * which rejects the literal `u` flag (TS1501). The runtime is modern
 * (Next.js / browsers), so the regex still evaluates correctly.
 */
const MENTION_TOKEN_RE = new RegExp("@([\\p{L}\\p{N}_-]{1,40})", "gu");
// {1,40} not {0,40} — a bare `@` with no characters after it would
// otherwise match an empty group and flood the suggestion dropdown
// with every workspace member every time the user types `@`. Requiring
// at least one character makes the suggestions narrow as the user types.
const MENTION_TRAILING_RE = new RegExp("(?:^|\\s)@([\\p{L}\\p{N}_-]{1,40})$", "u");
const MENTION_SPLIT_RE = new RegExp("(.*?)@([\\p{L}\\p{N}_-]*)$", "u");

/**
 * Resolve @mentions in a comment body against the workspace's
 * teamMembers. Returns the unique list of TeamMember ids whose
 * display name matches a `@token`. Tokens are case-insensitive and
 * match against the first word of each member's name (e.g.
 * `@alex` resolves to "Alex Smith").
 */
function resolveMentions(text: string, members: { id: string; name: string }[]): string[] {
  const tokens = Array.from(text.matchAll(MENTION_TOKEN_RE)).map((m) => m[1].toLowerCase());
  if (tokens.length === 0) return [];
  const hits = new Set<string>();
  for (const tok of tokens) {
    for (const m of members) {
      const first = (m.name || "").split(/\s+/)[0]?.toLowerCase() ?? "";
      if (first && first === tok) hits.add(m.id);
    }
  }
  return Array.from(hits);
}

interface Props {
  thread: WhiteboardCommentThread;
  onClose: () => void;
}

const STORAGE_KEY = "agile-toolkit:canvas-author";

function getAuthor(): string {
  if (typeof window === "undefined") return "Anonymous";
  // `localStorage.getItem` throws a SecurityError in private browsing
  // (Safari) and on pages where storage is blocked by a partition or
  // browser setting. Without the guard the whole comment drawer fails
  // to render on those origins. Fall back to a generic label.
  try {
    return localStorage.getItem(STORAGE_KEY) || "You";
  } catch {
    return "You";
  }
}

/** Per-thread draft cache so closing the drawer mid-type doesn't drop
 * the user's text. sessionStorage (not localStorage) so it clears with
 * the tab — drafts don't survive a full reload but DO survive switching
 * boards or closing the drawer. */
const DRAFT_KEY = (threadId: string) => `agile-toolkit:canvas-draft:${threadId}`;

export function CommentDrawer({ thread, onClose }: Props) {
  const upsert = useWorkspaceStore((s) => s.upsertWhiteboardCommentThread);
  const remove = useWorkspaceStore((s) => s.removeWhiteboardCommentThread);
  const teamMembers = useWorkspaceStore((s) => s.teamMembers);
  // Cache member id+name for the @mention resolver — the component
  // doesn't need the full TeamMember object.
  const mentionMembers = useMemo(
    () => teamMembers.map((m) => ({ id: m.id, name: m.name })),
    [teamMembers]
  );
  // Initialise from sessionStorage so reopening the drawer restores any
  // in-progress text. The initialiser runs once on mount; we save on
  // every keystroke via the change handler below.
  const [draft, setDraft] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.sessionStorage.getItem(DRAFT_KEY(thread.id)) ?? "";
    } catch {
      return "";
    }
  });
  // R11-fix: keyboard navigation for the mention autocomplete (A3 M5).
  // The previous picker was click-only — arrow keys did nothing.
  // Hoisted activeIndex here so the textarea's onKeyDown can step
  // through the same list MentionAutocomplete renders.
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
  const mentionFiltered = useMemo(() => {
    const match = draft.match(MENTION_TRAILING_RE);
    if (!match) return [] as { id: string; name: string }[];
    const prefix = match[1].toLowerCase();
    return mentionMembers
      .filter((m) => {
        const first = (m.name || "").split(/\s+/)[0]?.toLowerCase() ?? "";
        return prefix === "" || first.startsWith(prefix);
      })
      .slice(0, 6);
  }, [draft, mentionMembers]);
  // Reset active index when the filtered list changes shape.
  useEffect(() => {
    setMentionActiveIdx(0);
  }, [mentionFiltered.length]);
  // Two-step inline delete: first click arms the confirm state and
  // restyles the button red ("Confirm delete"); a second click within
  // 3 s actually removes the thread. Avoids the native `confirm()`
  // dialog, which blocks the JS thread, can be suppressed by browsers
  // after repeated use, and looks jarringly different from the rest of
  // the canvas chrome. The ref tracks the timeout so unmounting mid-arm
  // doesn't fire a stray `setConfirmDelete(false)` on a torn-down
  // component.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);
  const author = getAuthor();

  // Stable callback ref so the keydown effect doesn't re-register on
  // every parent render — the canvas typically passes an inline
  // arrow function for `onClose`, which changes identity each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc closes the drawer. Bubble phase (not capture) so that form
  // fields inside the drawer — most importantly the reply textarea —
  // get first crack at the key (IME composition, native autocomplete
  // dismissal). Capture-phase fights between stacked modals were
  // closing whichever modal mounted last regardless of focus.
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
      // Stop propagation only after we've decided to act so a parent
      // modal doesn't also close on the same keystroke.
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus restore — when the drawer unmounts, return focus to whatever
  // element was focused before it opened.
  useEffect(() => {
    const prev =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    return () => {
      prev?.focus?.();
    };
  }, []);

  const sendReply = () => {
    const text = draft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const mentions = resolveMentions(text, mentionMembers);
    // R5: read the LIVE thread from the workspace store inside the
    // handler. Previously the captured `thread` prop was used as the
    // base of the upsert — if a peer had added a reply since this
    // drawer mounted, the captured `thread.comments` was stale and
    // the upsert OVERWROTE the entire array, silently dropping the
    // peer's reply (whole-object LWW). Reading live + appending
    // narrows the loss window to the patch-broadcast RTT.
    const live =
      useWorkspaceStore.getState().whiteboardCommentThreads?.find((t) => t.id === thread.id) ??
      thread;
    upsert({
      ...live,
      comments: [
        ...live.comments,
        {
          id: wbId("c"),
          author,
          text,
          at: now,
          ...(mentions.length > 0 ? { mentions } : {}),
        },
      ],
    });
    // Cross-tool signal — declared in SignalKind since Phase 22 but had
    // no emit site. Comments on a board are a meaningful event for
    // analytics / activity feeds, so wire it here. Fires per-reply, not
    // per-thread-creation; downstream consumers can distinguish via
    // payload.commentCount.
    emitSignal({
      kind: "whiteboard.commentAdded",
      at: now,
      toolId: "canvas",
      payload: {
        boardId: thread.boardId,
        threadId: thread.id,
        objectId: thread.objectId ?? null,
        commentCount: thread.comments.length + 1,
      },
    });
    // Per-mention signal so notification consumers can fan out per
    // mentioned user. Emit only if there were mentions; consumers
    // listening to "commentAdded" alone aren't affected.
    if (mentions.length > 0) {
      emitSignal({
        kind: "whiteboard.commentMentioned",
        at: now,
        toolId: "canvas",
        payload: {
          boardId: thread.boardId,
          threadId: thread.id,
          objectId: thread.objectId ?? null,
          mentions,
          author,
          excerpt: text.slice(0, 120),
        },
      });
    }
    setDraft("");
    // Clear the persisted draft now that the message is in the thread.
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(DRAFT_KEY(thread.id));
      } catch {
        /* quota / private mode */
      }
    }
  };

  const toggleResolved = () => {
    // R5: same LWW read-live pattern as sendReply — avoid clobbering
    // peer-added comments that landed between mount and now.
    const live =
      useWorkspaceStore.getState().whiteboardCommentThreads?.find((t) => t.id === thread.id) ??
      thread;
    upsert({ ...live, resolved: !live.resolved });
  };

  const deleteThread = () => {
    // Two-step delete: first click arms the confirm state and changes
    // the button label. A second click within the 3 s window actually
    // deletes the thread. Avoids the native blocking `confirm()` and
    // keeps the canvas chrome consistent.
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    remove(thread.id);
    onClose();
  };

  return (
    <div
      // z-[60] lifts the drawer above everything: canvas objects (z up to a
      // few thousand), comment pins (z=9990), AI panel (z=30), and modals
      // (z=50). Without this, a tall sticky with z > 40 would clip over
      // the drawer text.
      //
      // `role="complementary"` is the accurate landmark — the drawer is
      // a non-modal side panel (no backdrop, no focus trap), the canvas
      // behind remains interactive. Screen readers expose it as a peer
      // region rather than a blocking dialog.
      role="complementary"
      aria-label={`Comment thread${thread.resolved ? " (resolved)" : ""}`}
      className="fixed right-3 top-20 bottom-3 w-[min(20rem,calc(100vw-1.5rem))] z-[60] bg-surface border border-border rounded-lg shadow-xl flex flex-col pr-safe pb-safe"
      data-canvas-export-ignore="true"
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">Thread</span>
          {thread.resolved && (
            <span className="text-[10px] uppercase font-bold text-success bg-success/10 px-1.5 py-0.5 rounded">
              resolved
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close thread"
          className="text-sub hover:text-text min-touch-coarse inline-flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto overscroll-contain-strict p-3 space-y-3">
        {thread.comments.length === 0 && (
          <p className="text-xs text-sub italic">No replies yet. Be the first.</p>
        )}
        {thread.comments.map((c) => (
          <div key={c.id} className="text-sm">
            <div className="flex items-baseline justify-between mb-0.5">
              <span className="font-semibold text-text text-xs">{c.author}</span>
              <span className="text-[10px] text-sub font-mono">{c.at.slice(11, 16)}</span>
            </div>
            <p className="text-text whitespace-pre-wrap break-words text-xs">{c.text}</p>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border space-y-2 relative">
        {/* @mention autocomplete dropdown. Triggered when the user's
            caret is right after `@<letters>` AND the prefix matches
            at least one team member. */}
        <MentionAutocomplete
          filtered={mentionFiltered}
          activeIndex={mentionActiveIdx}
          onPick={(name) => {
            // Replace the trailing @prefix with @firstName + space.
            const m = draft.match(MENTION_SPLIT_RE);
            if (!m) return;
            const before = m[1];
            const next = `${before}@${name.split(/\s+/)[0]} `;
            setDraft(next);
            if (typeof window !== "undefined") {
              try {
                window.sessionStorage.setItem(DRAFT_KEY(thread.id), next);
              } catch {
                /* noop */
              }
            }
          }}
        />
        <textarea
          value={draft}
          // R8: IME composition guard — Android/iOS Chinese/Japanese/
          // Korean keyboards fire onChange mid-composition with the
          // half-typed character. Persisting & re-reading the value
          // mid-keystroke causes the IME to drop the candidate menu.
          onChange={(e) => {
            const native = e.nativeEvent as InputEvent;
            if (native && native.isComposing) {
              setDraft(e.target.value);
              return;
            }
            const v = e.target.value;
            setDraft(v);
            if (typeof window !== "undefined") {
              try {
                window.sessionStorage.setItem(DRAFT_KEY(thread.id), v);
              } catch {
                /* noop */
              }
            }
          }}
          onCompositionEnd={(e) => {
            const v = (e.target as HTMLTextAreaElement).value;
            setDraft(v);
            if (typeof window !== "undefined") {
              try {
                window.sessionStorage.setItem(DRAFT_KEY(thread.id), v);
              } catch {
                /* noop */
              }
            }
          }}
          onKeyDown={(e) => {
            // R8: skip Cmd-Enter send during IME composition (Enter is
            // supposed to confirm the composed candidate, not submit).
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            // R11-fix: keyboard navigation when the @mention picker
            // is open. ArrowDown/Up steps through filtered members,
            // Enter accepts the active item, Escape closes (textarea
            // keeps focus). The textarea's bare Enter still inserts
            // a newline when the picker is closed.
            if (mentionFiltered.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionActiveIdx((i) => Math.min(mentionFiltered.length - 1, i + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionActiveIdx((i) => Math.max(0, i - 1));
                return;
              }
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const picked = mentionFiltered[mentionActiveIdx];
                if (picked) {
                  const m = draft.match(MENTION_SPLIT_RE);
                  if (m) {
                    const before = m[1];
                    const next = `${before}@${picked.name.split(/\s+/)[0]} `;
                    setDraft(next);
                    if (typeof window !== "undefined") {
                      try {
                        window.sessionStorage.setItem(DRAFT_KEY(thread.id), next);
                      } catch {
                        /* noop */
                      }
                    }
                  }
                }
                return;
              }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              sendReply();
            }
          }}
          placeholder="Reply… (use @name to mention. Cmd+Enter to send)"
          className="w-full h-16 bg-surface-deep border border-border rounded p-2 text-xs text-text resize-none focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={sendReply}
            disabled={!draft.trim()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            Reply
          </button>
          <button
            type="button"
            onClick={toggleResolved}
            className="flex items-center gap-1 px-2 py-1 rounded text-success hover:bg-success/10 text-xs"
          >
            <CheckCircle2 className="w-3 h-3" />
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
          <button
            type="button"
            onClick={deleteThread}
            aria-pressed={confirmDelete}
            className={`ml-auto text-xs transition-colors ${
              confirmDelete
                ? "text-danger bg-danger/15 border border-danger/40 px-2 py-1 rounded font-semibold"
                : "text-sub hover:text-danger"
            }`}
          >
            {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tiny @mention autocomplete. Appears above the textarea when the user
 * has just typed `@<letters>` and there's a matching team member. Click
 * a row OR press Enter / arrow-keys (handled in the textarea) to insert.
 *
 * R11-fix: now controlled by parent (filtered + activeIndex passed in)
 * so keyboard navigation in the textarea stays in sync with what the
 * dropdown shows. Previously the component computed its own filtered
 * list and arrow keys did nothing.
 */
function MentionAutocomplete({
  filtered,
  activeIndex,
  onPick,
}: {
  filtered: { id: string; name: string }[];
  activeIndex: number;
  onPick: (name: string) => void;
}) {
  if (filtered.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Mention a teammate"
      className="absolute left-3 right-3 bottom-[120px] bg-surface border border-border rounded-md shadow-lg z-10 overflow-hidden"
    >
      {filtered.map((m, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onPick(m.name)}
            className={`w-full text-left px-2 py-1.5 text-xs text-text hover:bg-surface-deep flex items-center gap-2 ${
              active ? "bg-surface-deep ring-1 ring-accent/40" : ""
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-accent/30 text-accent flex items-center justify-center text-[10px] font-bold">
              {(m.name || "?").charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{m.name}</span>
            <span className="text-[9px] text-sub font-mono">
              @{m.name.split(/\s+/)[0]?.toLowerCase()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
