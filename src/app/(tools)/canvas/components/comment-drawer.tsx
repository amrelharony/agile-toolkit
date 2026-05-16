"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Send, CheckCircle2 } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardCommentThread } from "@/lib/stores/workspace-types";
import { emitSignal } from "@/lib/signals/signal-bus";

/**
 * Resolve @mentions in a comment body against the workspace's
 * teamMembers. Returns the unique list of TeamMember ids whose
 * display name matches a `@token`. Tokens are case-insensitive and
 * match against the first word of each member's name (e.g.
 * `@alex` resolves to "Alex Smith").
 */
function resolveMentions(text: string, members: { id: string; name: string }[]): string[] {
  const tokens = Array.from(text.matchAll(/@([A-Za-z0-9_-]{1,40})/g)).map((m) => m[1].toLowerCase());
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
  return localStorage.getItem(STORAGE_KEY) || "You";
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
    [teamMembers],
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
  const author = getAuthor();

  // Esc closes the drawer. Captured so the canvas Esc handler doesn't
  // also clear the selection or end an unrelated gesture.
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

  const sendReply = () => {
    const text = draft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const mentions = resolveMentions(text, mentionMembers);
    upsert({
      ...thread,
      comments: [
        ...thread.comments,
        {
          id: `c_${Math.random().toString(36).slice(2, 9)}`,
          author, text, at: now,
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
      try { window.sessionStorage.removeItem(DRAFT_KEY(thread.id)); } catch { /* quota / private mode */ }
    }
  };

  const toggleResolved = () => {
    upsert({ ...thread, resolved: !thread.resolved });
  };

  const deleteThread = () => {
    if (!confirm("Delete this comment thread? This can't be undone via Cmd+Z.")) return;
    remove(thread.id);
    onClose();
  };

  return (
    <div
      // z-[60] lifts the drawer above everything: canvas objects (z up to a
      // few thousand), comment pins (z=9990), AI panel (z=30), and modals
      // (z=50). Without this, a tall sticky with z > 40 would clip over
      // the drawer text.
      className="fixed right-3 top-20 bottom-3 w-[320px] z-[60] bg-surface border border-border rounded-lg shadow-xl flex flex-col"
      data-canvas-export-ignore="true"
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">Thread</span>
          {thread.resolved && (
            <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">resolved</span>
          )}
        </div>
        <button onClick={onClose} aria-label="Close thread" className="text-sub hover:text-text">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
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

      <div className="p-3 border-t border-border space-y-2">
        <textarea
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            // Persist draft so closing/reopening (or switching board)
            // doesn't drop in-progress typing. Wrapped in try/catch
            // because sessionStorage throws in some private modes.
            if (typeof window !== "undefined") {
              try { window.sessionStorage.setItem(DRAFT_KEY(thread.id), v); } catch { /* noop */ }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              sendReply();
            }
          }}
          placeholder="Reply… (Cmd+Enter to send)"
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
            className="flex items-center gap-1 px-2 py-1 rounded text-emerald-300 hover:bg-emerald-500/10 text-xs"
          >
            <CheckCircle2 className="w-3 h-3" />
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
          <button
            type="button"
            onClick={deleteThread}
            className="ml-auto text-xs text-sub hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
