"use client";

import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import type { ChatMessage, ConversationMeta } from "./types";
import type { RateLimitInfo } from "./store";

/**
 * Read-only usage snapshot for the rate-limit bar via the peek_chat_usage RPC
 * (migration 0021) — does NOT consume a turn, unlike check_chat_rate_limit.
 * Returns null when Supabase is unavailable or the RPC isn't migrated yet, so
 * the bar simply keeps whatever it last showed.
 */
export async function fetchChatUsage(): Promise<RateLimitInfo | null> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("peek_chat_usage");
  if (error || !data) return null;
  const d = data as {
    allowed: boolean;
    daily_used: number;
    daily_max: number;
    weekly_used: number;
    weekly_max: number;
    monthly_used: number;
    monthly_max: number;
  };
  return {
    dailyUsed: d.daily_used,
    dailyMax: d.daily_max,
    weeklyUsed: d.weekly_used,
    weeklyMax: d.weekly_max,
    monthlyUsed: d.monthly_used,
    monthlyMax: d.monthly_max,
    limited: !d.allowed,
  };
}

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
    } else if (block.type === "tool_use") {
      // tool_use.input is arbitrary caller data and can dominate the payload
      // (e.g. a bulk create). Trimming only text/tool_result left this path
      // able to return content STILL over the cap → the whole insert batch
      // (this message and its siblings) was rejected and lost.
      const inputJson = JSON.stringify(block.input ?? null);
      if (inputJson.length > 8000) {
        block.input = { _truncated: inputJson.slice(0, 8000) + sentinel };
      }
    }
  }
  // Re-measure. If still over (e.g. hundreds of trimmed blocks), hard-clamp to
  // a single notice block so the result can NEVER exceed the column cap — the
  // function's entire contract is to return storable content.
  if (new TextEncoder().encode(JSON.stringify(clone)).length > CONTENT_OCTET_LIMIT) {
    return [{ type: "text" as const, text: "[message too large to store]" + sentinel }];
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
    // Persist the append-time timestamp explicitly. These inserts are
    // fire-and-forget (`void`), so relying on the DB `now()` default lets an
    // assistant + its tool row land out of order on reload (orphan tool_result
    // → invalid wire on the next send). m.createdAt is monotonic with append
    // order, and loadMessages sorts by created_at.
    created_at: m.createdAt,
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

/** Record token spend onto the current turn's usage row (best-effort). */
export async function recordChatUsage(tokens: number, model = "openclaw"): Promise<void> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return;
  try {
    await supabase.rpc("record_chat_usage", {
      p_tokens: Math.max(0, Math.round(tokens)),
      p_model: model,
    });
  } catch {
    /* best-effort metering; never break the turn */
  }
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return;
  await supabase.from("agent_conversations").delete().eq("id", conversationId);
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  const supabase = getAuthBrowserClient();
  if (!supabase) return;
  await supabase
    .from("agent_conversations")
    .update({ title: conversationTitle(title), updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/** Derive a conversation title from the first user message (trimmed, capped). */
export function conversationTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "New conversation";
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/** Render a conversation as portable markdown for export/download. */
export function conversationToMarkdown(title: string, messages: ChatMessage[]): string {
  const out: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    if (m.role === "user") {
      out.push("**You:**", "");
      for (const c of m.content) if (c.type === "text") out.push(c.text, "");
    } else if (m.role === "assistant") {
      out.push("**ElharonyClaw:**", "");
      for (const c of m.content) {
        if (c.type === "text") out.push(c.text, "");
        else if (c.type === "tool_use")
          out.push("```", `${c.name}(${JSON.stringify(c.input)})`, "```", "");
      }
    } else if (m.role === "tool") {
      for (const c of m.content) {
        if (c.type === "tool_result") {
          const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
          out.push(`> ${body.slice(0, 800).replace(/\n/g, "\n> ")}`, "");
        }
      }
    }
  }
  return `${out.join("\n").trim()}\n`;
}

/** Filesystem-safe slug for an export filename. */
export function titleSlug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "conversation";
}
