"use client";

/**
 * Conversation history for the agent panel: browse, switch, rename, delete past
 * threads, or start a new one. Threads are persisted in Supabase
 * (agent_conversations) and reloaded via loadMessages on switch.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, MessageSquare, Search, Download } from "lucide-react";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { ownerFeedChannel } from "@/lib/realtime/private-rooms";
import { useAgentStore } from "@/lib/agent/store";
import {
  listConversations,
  loadMessages,
  deleteConversation,
  renameConversation,
  conversationToMarkdown,
  titleSlug,
} from "@/lib/agent/persist";
import type { ConversationMeta } from "@/lib/agent/types";

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer the revoke — revoking synchronously after click() races the
  // download in Firefox/Safari and can cancel it outright. Matches the
  // other download sites (retro/components/board.tsx, whiteboard/export.ts).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ConversationList({ onClose }: { onClose: () => void }) {
  const activeId = useAgentStore((s) => s.activeConversationId);
  const [items, setItems] = useState<ConversationMeta[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const refresh = useCallback(() => {
    void listConversations().then(setItems);
  }, []);
  useEffect(() => refresh(), [refresh]);

  // Multi-tab/device live sync: re-fetch when agent_conversations changes
  // (insert/rename/delete from another tab), plus on tab focus as a fallback
  // where realtime isn't enabled. The refetch is RLS-filtered, so the realtime
  // event is only a "something changed" trigger.
  useEffect(() => {
    const supabase = getAuthBrowserClient();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Private with NEXT_PUBLIC_PRIVATE_ROOMS=1: the owner's session JWT on
    // this client passes the realtime policy for this topic.
    const channel = supabase
      ? ownerFeedChannel(supabase, "agent-conversations-live")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "agent_conversations" },
            () => refresh()
          )
          .subscribe()
      : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [refresh]);

  const openThread = async (meta: ConversationMeta) => {
    const msgs = await loadMessages(meta.id);
    useAgentStore.getState().setActiveConversation(meta, msgs);
    onClose();
  };

  const newChat = () => {
    useAgentStore.getState().reset();
    onClose();
  };

  const remove = async (id: string) => {
    await deleteConversation(id);
    if (useAgentStore.getState().activeConversationId === id) useAgentStore.getState().reset();
    refresh();
  };

  const commitRename = async (id: string) => {
    const title = draft.trim();
    setEditing(null);
    if (title) {
      await renameConversation(id, title);
      refresh();
    }
  };

  const exportThread = async (meta: ConversationMeta) => {
    const msgs = await loadMessages(meta.id);
    downloadText(`${titleSlug(meta.title)}.md`, conversationToMarkdown(meta.title, msgs));
  };

  const q = query.trim().toLowerCase();
  const filtered = (items ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={newChat}
        className="m-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text transition-colors hover:bg-accent/10"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> New chat
      </button>
      {(items?.length ?? 0) > 3 && (
        <div className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-border px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-sub" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-text placeholder:text-sub focus:outline-none"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {items === null && <p className="px-2 py-4 text-xs text-sub">Loading…</p>}
        {items?.length === 0 && <p className="px-2 py-4 text-xs text-sub">No conversations yet.</p>}
        {items && items.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-4 text-xs text-sub">No matches.</p>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
              c.id === activeId ? "bg-accent/15 text-text" : "text-sub hover:bg-accent/10"
            }`}
          >
            {editing === c.id ? (
              <>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(c.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-border bg-surface-deep px-1.5 py-0.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                  aria-label="Rename conversation"
                />
                <button
                  type="button"
                  onClick={() => void commitRename(c.id)}
                  aria-label="Save name"
                  className="p-1 text-sub hover:text-text"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  aria-label="Cancel rename"
                  className="p-1 text-sub hover:text-text"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void openThread(c)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={c.title}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{c.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-sub">
                    {relativeTime(c.lastMessageAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void exportThread(c)}
                  aria-label="Export conversation"
                  className="p-1 text-sub opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(c.id);
                    setDraft(c.title);
                  }}
                  aria-label="Rename conversation"
                  className="p-1 text-sub opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  aria-label="Delete conversation"
                  className="p-1 text-sub opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
