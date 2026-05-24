"use client";

import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import type { ChatMessage, ConversationMeta } from "./types";

/**
 * Supabase-backed conversation persistence. The agent route writes
 * messages too (server-side), but the browser holds the live source of
 * truth — these helpers exist for the conversation-list UI and for
 * reloading a thread on next open.
 */

export async function listConversations(): Promise<ConversationMeta[]> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("id, title, tool_id, created_at, updated_at, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[agent] listConversations failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    toolId: (row.tool_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastMessageAt: row.last_message_at as string,
  }));
}

export async function createConversation(opts: {
  title: string;
  toolId?: string | null;
}): Promise<ConversationMeta | null> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({
      title: opts.title.slice(0, 200),
      tool_id: opts.toolId ?? null,
      // user_id is filled by the RLS-protected default via auth.uid()? Not by default — Supabase
      // requires the client to supply user_id and matches it against the RLS check. We fetch
      // session.user.id here to satisfy the insert policy.
      user_id: (await supabase.auth.getUser()).data.user?.id,
    })
    .select("id, title, tool_id, created_at, updated_at, last_message_at")
    .single();
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.warn("[agent] createConversation failed", error?.message);
    return null;
  }
  return {
    id: data.id as string,
    title: data.title as string,
    toolId: (data.tool_id as string | null) ?? null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    lastMessageAt: data.last_message_at as string,
  };
}

export async function loadMessages(conversationId: string): Promise<ChatMessage[]> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("agent_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[agent] loadMessages failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    role: row.role as ChatMessage["role"],
    content: row.content as ChatMessage["content"],
    createdAt: row.created_at as string,
  }));
}

/** Schema constraint on agent_messages.content: octet_length <= 262144.
 *  We truncate inside text content blocks before insert and append a
 *  sentinel so callers can detect the truncation. (BUG-G14) */
const CONTENT_OCTET_LIMIT = 250_000; // a hair below the DB cap

function truncateContentForStorage(content: ChatMessage["content"]): ChatMessage["content"] {
  const raw = JSON.stringify(content);
  // octet_length on a UTF-8 string. JS string length is code units; convert
  // via TextEncoder for an accurate byte count.
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes <= CONTENT_OCTET_LIMIT) return content;
  // Walk top-level blocks; truncate text/tool_result text payloads until
  // we fit. Aggressive but safe: better than a hard DB rejection.
  const clone: ChatMessage["content"] = JSON.parse(raw);
  const sentinel = " …[truncated]";
  for (const block of clone) {
    if (block.type === "text") {
      block.text = block.text.slice(0, 8000) + sentinel;
    } else if (block.type === "tool_result") {
      if (typeof block.content === "string") {
        block.content = block.content.slice(0, 8000) + sentinel;
      } else {
        for (const tb of block.content) tb.text = tb.text.slice(0, 4000) + sentinel;
      }
    }
  }
  return clone;
}

export async function appendMessages(
  conversationId: string,
  messages: ChatMessage[]
): Promise<void> {
  const supabase = getAuthBrowserClient();
  if (!supabase || messages.length === 0) return;
  const rows = messages.map((m) => ({
    conversation_id: conversationId,
    role: m.role,
    content: truncateContentForStorage(m.content),
  }));
  const { error } = await supabase.from("agent_messages").insert(rows);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[agent] appendMessages failed", error.message);
    return;
  }
  // Bump last_message_at on the conversation.
  await supabase
    .from("agent_conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return;
  await supabase.from("agent_conversations").delete().eq("id", conversationId);
}
