"use client";

/**
 * Conversation history for the agent panel: browse, switch, rename, delete past
 * threads, or start a new one. Threads are persisted in Supabase
 * (agent_conversations) and reloaded via loadMessages on switch.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, MessageSquare } from "lucide-react";
import { useAgentStore } from "@/lib/agent/store";
import {
  listConversations,
  loadMessages,
  deleteConversation,
  renameConversation,
} from "@/lib/agent/persist";
import type { ConversationMeta } from "@/lib/agent/types";

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

  const refresh = useCallback(() => {
    void listConversations().then(setItems);
  }, []);
  useEffect(() => refresh(), [refresh]);

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

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={newChat}
        className="m-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text transition-colors hover:bg-accent/10"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> New chat
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {items === null && <p className="px-2 py-4 text-xs text-sub">Loading…</p>}
        {items?.length === 0 && <p className="px-2 py-4 text-xs text-sub">No conversations yet.</p>}
        {items?.map((c) => (
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
                  <span className="ml-auto shrink-0 text-[10px] text-sub">
                    {relativeTime(c.lastMessageAt)}
                  </span>
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
