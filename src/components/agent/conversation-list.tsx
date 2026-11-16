"use client";

/**
 * The owner's History in Amr's panel (design §1.2 "History"): browse, open,
 * rename, export and delete past threads, or start a new one. Threads are
 * persisted in Supabase (agent_conversations) and reloaded through
 * loadMessages on a switch. The header's way back ("Back to chat") and the
 * "Your chats" subtitle are the owner panel's (owner-agent-panel).
 *
 * Top to bottom:
 *   - while a confirm card waits in the chat behind it, a narration caption,
 *     "Amr is waiting for your OK", with Back to chat (the card takes focus
 *     as the chat comes back)
 *   - New chat
 *   - a search over the titles (ui/input). It takes focus when the owner comes
 *     in from the chat (`takeFocus`), on a fine pointer only: on a touch
 *     screen it would raise the keyboard over the list. Enter goes to the
 *     first thread; Escape with words in it clears them, and from an empty
 *     one the panel's own Escape order goes on (back to the chat). Once
 *     typing stops, what it found is said politely ("2 chats match", or
 *     "No chats match …"). With no threads there is no search, so focus in
 *     it goes on to New chat when it goes
 *   - the threads under Today, Yesterday, Last 7 days and Earlier
 *     (lib/agent/history-groups), each row its title (dir="auto"), its tool
 *     and a <time> line in words; the open thread says so (aria-current, and
 *     "Open now" on its row)
 *   - a pen scribbling while the list loads (the panel's own PanelLoading)
 *
 * When Supabase can't be reached the list says so in a narration caption with
 * Try again and keeps what it last showed; "No saved chats yet" follows only a
 * read that worked. A thread that can't be opened stays in History with the
 * same kind of caption, never opened empty (the open thread keeps its answer
 * under way and its card), and its Try again keeps the caption, and focus,
 * while it loads again. A thread on its way in is busy (a scribble on its
 * row, and on Try again), so a second tap loads nothing twice. A failure the
 * owner asked for (opening History, a thread, Try again) is said once,
 * assertively; nothing here is a live region.
 *
 * Row actions carry the thread's title in their names (Export “…”,
 * Rename “…”, Delete “…”), so rows can be told apart. Focus stays in the
 * list: a rename that ends goes back to its row's Rename, a delete to the
 * next row (the one before for the last row, New chat when none is left),
 * and a list that comes back after Try again to its first row.
 *
 * Owner only, inside the owner's chunk (test/agent/bundle-boundary.test.ts).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, Download, MessageSquare, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Narration } from "@/components/agent/comic/comic-parts";
import { InkScribble } from "@/components/ink/ink-scribble";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { ownerFeedChannel } from "@/lib/realtime/private-rooms";
import { historyGroups, threadTime } from "@/lib/agent/history-groups";
import { AMR_WAITING_FOR_OK } from "@/lib/agent/mascot/outside-narration";
import { resolvePageTool } from "@/lib/agent/page-tool";
import { useAgentStore } from "@/lib/agent/store";
import {
  listConversations,
  loadMessages,
  deleteConversation,
  renameConversation,
  conversationToMarkdown,
  conversationTitle,
  titleSlug,
} from "@/lib/agent/persist";
import type { ConversationMeta } from "@/lib/agent/types";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import { focusComposerAfterNewChat } from "./chat/chat-composer";
import { onTouchScreen } from "./chat/chat-context";
import { DOCK_END } from "./mascot/panel-context";
import { PanelLoading } from "./mascot/panel-parts";

/** How long a deleted thread can still come back with Undo. */
export const DELETE_UNDO_MS = 8000;

/** Read by screen readers in the list's place while it loads. */
export const HISTORY_LOADING = "Loading your chats";
/** The list couldn't be read (narration; said once when the owner asked for it). */
export const HISTORY_FAILED = "Amr couldn't reach your chats. Check your connection and try again.";
/** A read that worked, with nothing in it. */
export const HISTORY_EMPTY = "No saved chats yet. A chat is kept here from its first message.";
/** The search found nothing. */
export const noMatches = (query: string) => `No chats match “${query}”.`;
/** Said once typing stops in the search: how many threads it found. */
export const chatMatchCount = (n: number) => (n === 1 ? "1 chat matches" : `${n} chats match`);
/** How long typing stops before the count is said (the tool finder's wait). */
export const SEARCH_ANNOUNCE_MS = 450;
/** A thread couldn't be opened (narration, said once). */
export const openFailed = (title: string) =>
  `Amr couldn't open “${title}”. Check your connection and try again.`;
/** A thread couldn't be read for its export (an error toast). */
export const exportFailed = (title: string) =>
  `Amr couldn't export “${title}”. Check your connection and try again.`;
/** On the open thread's row; aria-current says it to screen readers. */
export const OPEN_NOW = "Open now";
/** A row action's name: the verb and the thread it acts on. */
export const rowAction = (verb: "Export" | "Rename" | "Delete", title: string) =>
  `${verb} “${title}”`;

interface PendingDelete {
  /** Deletes the thread for good once Undo is no longer offered. */
  timer: ReturnType<typeof setTimeout>;
  /** The toast offering Undo, closed the moment the delete goes out. */
  toastId?: string | number;
}

/**
 * Threads deleted in the last few seconds. Until the delete goes out the row
 * is only hidden, so Undo needs nothing rebuilt. Module-level so a list closed
 * and reopened in that window keeps the thread hidden, and the delete still
 * lands after the list has unmounted.
 */
const pendingDeletes = new Map<string, PendingDelete | "deleting">();

/** Mounted lists, told to re-read when a thread may have come back. */
const listListeners = new Set<() => void>();

async function commitDelete(id: string): Promise<void> {
  const pending = pendingDeletes.get(id);
  if (pending === undefined || pending === "deleting") return;
  clearTimeout(pending.timer);
  pendingDeletes.set(id, "deleting");
  // Undo must not outlive the delete. Sonner pauses its toast's clock while
  // the toaster is hovered or tapped and while the tab is hidden, so the toast
  // can still be up when this timer fires: close it before anything is sent.
  if (pending.toastId !== undefined) toast.dismiss(pending.toastId);
  try {
    await deleteConversation(id);
  } finally {
    // Only now: a refetch while the request is in flight still hides it.
    pendingDeletes.delete(id);
    // deleteConversation doesn't throw when Supabase refuses the delete, so
    // re-read: a thread that is still there shows again.
    listListeners.forEach((fn) => fn());
  }
}

/** Cancel a delete still inside its Undo window. False once it has gone out. */
function cancelDelete(id: string): boolean {
  const pending = pendingDeletes.get(id);
  if (pending === undefined || pending === "deleting") return false;
  clearTimeout(pending.timer);
  pendingDeletes.delete(id);
  return true;
}

// Leaving the page inside the Undo window deletes at once (best-effort), and
// closes the Undo toast with it. Phones often skip pagehide when the app is
// swiped away or the tab is killed, but fire visibilitychange first.
let flushOnHide = false;
function flushPendingOnPageHide(): void {
  if (flushOnHide || typeof window === "undefined") return;
  flushOnHide = true;
  const flush = () => pendingDeletes.forEach((_, id) => void commitDelete(id));
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/**
 * A row's Export / Rename / Delete. With a mouse they appear on hover (or when
 * the row has keyboard focus). A touch screen has no hover, and tapping the
 * row opens the thread, so there they always show, at 44 px.
 */
const ROW_ACTION =
  "min-touch-coarse inline-flex items-center justify-center p-1 text-sub opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";

/** A caption's button: 44 px on a touch screen. */
const CAPTION_BUTTON = "pointer-coarse:min-h-11";

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

/**
 * Where focus goes after a control in the list takes itself away: a row's
 * open button (`open:{id}`), its Rename (`rename:{id}`), New chat (`new`), or
 * the first row (`first`; New chat when there is none). Each target carries
 * it in data-history-focus.
 */
type FocusKey = `open:${string}` | `rename:${string}` | "new" | "first";

export interface ConversationListProps {
  /** Back to the chat: a thread opened, New chat, or Back to chat on the waiting caption. */
  onClose: () => void;
  /** The owner came in from the chat: the search takes focus (on a fine pointer only). */
  takeFocus?: boolean;
}

export function ConversationList({ onClose, takeFocus = false }: ConversationListProps) {
  const activeId = useAgentStore((s) => s.activeConversationId);
  // A card the owner can't see from here: the caption says so.
  const cardWaits = useAgentStore((s) => s.pendingToolUse !== null);
  const announce = useAnnounce();
  const [items, setItems] = useState<ConversationMeta[] | null>(null);
  // The last read failed: its caption shows, over whatever was there before.
  const [failed, setFailed] = useState(false);
  // The thread on its way in, and one that couldn't be read.
  const [opening, setOpening] = useState<string | null>(null);
  const [notOpened, setNotOpened] = useState<ConversationMeta | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const openingRef = useRef<string | null>(null);
  const handTo = useRef<FocusKey | null>(null);
  const headingId = useId();

  // `asked`: the owner asked for this read (History opening, Try again), so a
  // failure is said; a refresh in the background stays quiet.
  const refresh = useCallback(
    (asked = false) => {
      void listConversations().then(({ ok, data }) => {
        if (!ok) {
          setFailed(true);
          if (asked) announce(HISTORY_FAILED, "assertive");
          return;
        }
        // Try again worked and its caption is about to go: its button had
        // focus, so the first thread takes it.
        const retry = retryRef.current;
        if (retry && retry === retry.ownerDocument.activeElement) handTo.current = "first";
        const kept = data.filter((c) => !pendingDeletes.has(c.id));
        // An empty list takes the search away (with no words in it): focus in
        // it goes on to New chat.
        const search = searchRef.current;
        if (kept.length === 0 && search && search === search.ownerDocument.activeElement) {
          handTo.current ??= "new";
        }
        setFailed(false);
        setItems(kept);
      });
    },
    [announce]
  );
  useEffect(() => refresh(true), [refresh]);
  useEffect(() => {
    const background = () => refresh();
    listListeners.add(background);
    return () => {
      listListeners.delete(background);
    };
  }, [refresh]);

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

  // In from the chat: the search, before paint. Never on a touch screen,
  // where it would raise the keyboard over the list before anyone chose to
  // type; focus stays on the History button there.
  const searchOnMount = useRef(takeFocus);
  useLayoutEffect(() => {
    if (searchOnMount.current && !onTouchScreen(rootRef.current?.ownerDocument)) {
      searchRef.current?.focus();
    }
  }, []);

  // A control that took itself away (Save, Cancel, Delete, Try again) hands
  // focus on once it has gone. Only focus that fell to the page moves: focus
  // the owner put somewhere else stays there.
  useLayoutEffect(() => {
    const key = handTo.current;
    const root = rootRef.current;
    if (!key || !root) return;
    handTo.current = null;
    const doc = root.ownerDocument;
    if (doc.activeElement && doc.activeElement !== doc.body) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-history-focus]"));
    const named = (k: string) => targets.find((el) => el.dataset.historyFocus === k);
    const target =
      key === "first"
        ? (targets.find((el) => el.dataset.historyFocus?.startsWith("open:")) ?? named("new"))
        : named(key);
    target?.focus();
  });

  // A card that comes while the chat is out of sight is said here (the chat's
  // own announcer isn't there to say it). One already waiting when History
  // opened is in the header's title and the caption.
  const cardWaited = useRef(cardWaits);
  useEffect(() => {
    if (cardWaits && !cardWaited.current) announce(AMR_WAITING_FOR_OK);
    cardWaited.current = cardWaits;
  }, [cardWaits, announce]);

  const openThread = async (meta: ConversationMeta) => {
    // One thread on its way at a time: a second tap loads nothing twice.
    if (openingRef.current) return;
    const store = useAgentStore.getState();
    const isOpen = store.activeConversationId === meta.id;
    // The open thread with an answer under way: back to it as it is.
    // Reloading it would drop the reply still being written, not saved yet.
    if (isOpen && store.streaming) {
      store.attachConversation(meta);
      onClose();
      return;
    }
    // Another thread: its answer under way and a card waiting belong to the
    // thread being left. setActiveConversation stops the one and turns down
    // the other, and only once the new thread has loaded: a load that fails
    // leaves the open thread as it was, turn and card and all.
    openingRef.current = meta.id;
    setOpening(meta.id);
    // Try again keeps its caption (and its focus) while it loads; another
    // thread's press clears it.
    setNotOpened((n) => (n?.id === meta.id ? n : null));
    const loaded = await loadMessages(meta.id);
    openingRef.current = null;
    setOpening(null);
    if (!loaded.ok) {
      // It stays in History, its row (and focus) where they were, with a
      // way to try again.
      setNotOpened(meta);
      announce(openFailed(meta.title), "assertive");
      return;
    }
    useAgentStore.getState().setActiveConversation(meta, loaded.data);
    onClose();
  };

  // New chat: reset stops the answer under way before the chat empties, and
  // the fresh chat's message box takes focus as it comes back, even on a
  // touch screen (a tap on New chat means "let me type").
  const newChat = () => {
    useAgentStore.getState().reset();
    onClose();
    focusComposerAfterNewChat();
  };

  const q = query.trim().toLowerCase();
  const filtered = (items ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));
  const groups = historyGroups(filtered);
  /** The rows as they show, top to bottom. */
  const shown = groups.flatMap((g) => g.threads);

  // What the search found, once typing stops: one polite line through the
  // app's announcer (the list is no live region), each key press starting the
  // wait again. Never on mount, for an empty search or before the list loads.
  const words = query.trim();
  const found = filtered.length;
  const listed = items !== null && !failed && items.length > 0;
  useEffect(() => {
    if (!words || !listed) return;
    const id = setTimeout(
      () => announce(found ? chatMatchCount(found) : noMatches(words)),
      SEARCH_ANNOUNCE_MS
    );
    return () => clearTimeout(id);
  }, [words, found, listed, announce]);

  // Delete hides the row at once and offers Undo; the thread is deleted in
  // Supabase only when the Undo window closes (or the page is hidden), and the
  // Undo toast closes with it. A stray tap on a phone used to erase a thread
  // for good. Focus goes to the next row, the one before for the last, or
  // New chat when none is left.
  const remove = (meta: ConversationMeta) => {
    const store = useAgentStore.getState();
    const wasActive = store.activeConversationId === meta.id;
    // What Undo puts back if this was the open thread: its messages, and
    // where a picked-up thread left off (null when it wasn't one).
    const openMessages = wasActive ? store.messages : [];
    const openResumedAfter = wasActive ? store.resumedAfter : null;
    const index = (items ?? []).findIndex((c) => c.id === meta.id);
    const at = shown.findIndex((c) => c.id === meta.id);
    const neighbour = shown[at + 1] ?? shown[at - 1];
    handTo.current = neighbour ? `open:${neighbour.id}` : "new";
    const toastId = undoable({
      label: `Deleted “${meta.title}”`,
      durationMs: DELETE_UNDO_MS,
      apply: () => {
        pendingDeletes.set(meta.id, {
          timer: setTimeout(() => void commitDelete(meta.id), DELETE_UNDO_MS),
        });
        flushPendingOnPageHide();
        setItems((list) => list && list.filter((c) => c.id !== meta.id));
        setNotOpened((n) => (n?.id === meta.id ? null : n));
        // The open thread: reset stops its answer under way (through the
        // store) before the chat empties.
        if (wasActive) useAgentStore.getState().reset();
      },
      revert: () => {
        // Undo tapped as the delete went out: say so rather than do nothing.
        if (!cancelDelete(meta.id)) {
          toast.error("Too late to undo: the conversation was already deleted");
          return;
        }
        setItems((list) => {
          if (!list || list.some((c) => c.id === meta.id)) return list;
          const next = [...list];
          next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, meta);
          return next;
        });
        // Reopen it, unless another chat has started since.
        const s = useAgentStore.getState();
        if (wasActive && !s.activeConversationId && s.messages.length === 0) {
          s.setActiveConversation(meta, openMessages);
          // Undone, not picked up: the reopen counts as a switch, which would
          // mark it as one, so the strip gets back the captions it had.
          useAgentStore.setState({ resumedAfter: openResumedAfter });
        }
        // A list reopened since the delete re-reads to show it again.
        listListeners.forEach((fn) => fn());
      },
    });
    const pending = pendingDeletes.get(meta.id);
    if (pending && pending !== "deleting") pending.toastId = toastId;
  };

  /** The rename ends (saved or not): focus goes back to the row's Rename. */
  const endRename = (id: string) => {
    handTo.current = `rename:${id}`;
    setEditing(null);
  };

  const commitRename = async (id: string) => {
    const title = draft.trim();
    endRename(id);
    if (title) {
      await renameConversation(id, title);
      // The open thread's name in the panel header follows, as saved.
      useAgentStore.getState().retitleConversation(id, conversationTitle(title));
      refresh();
    }
  };

  const exportThread = async (meta: ConversationMeta) => {
    const { ok, data } = await loadMessages(meta.id);
    // Never a file with nothing in it.
    if (!ok) {
      toast.error(exportFailed(meta.title));
      return;
    }
    downloadText(`${titleSlug(meta.title)}.md`, conversationToMarkdown(meta.title, data));
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // An input method's Enter or Escape ends its composition, nothing else.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      // To the first thread found, as the tool finder's search does.
      e.preventDefault();
      const first = shown[0];
      if (first) {
        rootRef.current?.querySelector<HTMLElement>(`[data-thread-open="${first.id}"]`)?.focus();
      }
    } else if (e.key === "Escape" && query) {
      // Clears the words first; the panel's Escape skips a used key. Over an
      // empty list the search goes with them, and focus on to New chat.
      e.preventDefault();
      if (items?.length === 0) handTo.current = "new";
      setQuery("");
    }
  };

  const loading = items === null && !failed;
  // Nothing to search: no search, unless words are in it.
  const showSearch = !(items?.length === 0 && !failed && !query);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      {cardWaits && (
        <Narration
          className="mx-2 mt-2"
          data-history-waiting=""
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={CAPTION_BUTTON}
              // The card takes focus as the chat comes back (confirm-card).
              onClick={onClose}
            >
              Back to chat
            </Button>
          }
        >
          {AMR_WAITING_FOR_OK}
        </Narration>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={newChat}
        className="mx-2 mt-2 justify-start pointer-coarse:min-h-11"
        data-history-focus="new"
      >
        <Plus aria-hidden="true" /> New chat
      </Button>
      {showSearch && (
        <div role="search" className="relative mx-2 mt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              // Emptied over an empty list, the search goes: focus on to New chat.
              if (!e.target.value && items?.length === 0) handTo.current = "new";
              setQuery(e.target.value);
            }}
            onKeyDown={onSearchKey}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            enterKeyHint="search"
            autoComplete="off"
            className="pl-9"
          />
        </div>
      )}
      {/* It ends above Amr docked in the phone's sheet: no row scrolls under him. */}
      <div
        data-amr-scroll=""
        className={cn("mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2", DOCK_END)}
      >
        {loading && <PanelLoading label={HISTORY_LOADING} />}
        {failed && (
          <Narration
            tone="error"
            className="mb-2"
            data-history-failed=""
            actions={
              <Button
                ref={retryRef}
                type="button"
                variant="outline"
                size="sm"
                className={CAPTION_BUTTON}
                onClick={() => refresh(true)}
              >
                Try again
              </Button>
            }
          >
            {HISTORY_FAILED}
          </Narration>
        )}
        {notOpened && (
          <Narration
            tone="error"
            className="mb-2"
            data-history-not-opened=""
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={CAPTION_BUTTON}
                aria-busy={opening === notOpened.id || undefined}
                onClick={() => void openThread(notOpened)}
              >
                Try again
              </Button>
            }
          >
            {openFailed(notOpened.title)}
          </Narration>
        )}
        {items?.length === 0 && !failed && <Narration>{HISTORY_EMPTY}</Narration>}
        {items && items.length > 0 && filtered.length === 0 && (
          <Narration>{noMatches(query.trim())}</Narration>
        )}
        {groups.map((g) => (
          <div key={g.key} className="mt-3 first:mt-0" data-history-group={g.key}>
            <Eyebrow as="h3" id={`${headingId}-${g.key}`} className="px-2 pb-1">
              {g.label}
            </Eyebrow>
            <ul role="list" aria-labelledby={`${headingId}-${g.key}`} className="space-y-0.5">
              {g.threads.map((c) => {
                const active = c.id === activeId;
                const tool = resolvePageTool(c.toolId)?.name;
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-md border-l-2 px-2 text-sm",
                      active
                        ? "border-accent bg-accent/15 text-text"
                        : "border-transparent text-sub hover:bg-accent/10"
                    )}
                  >
                    {editing === c.id ? (
                      <>
                        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                        <input
                          autoFocus
                          // Marks the field for Amr's panel: Ctrl/Cmd+J leaves it alone here.
                          data-agent-rename=""
                          value={draft}
                          dir="auto"
                          enterKeyHint="done"
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            // An input method's Enter or Escape ends its composition, nothing else.
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitRename(c.id);
                            }
                            if (e.key === "Escape") {
                              // Cancels the rename only: the panel's own Escape (deny a
                              // waiting card, leave History, close) skips a used key.
                              e.preventDefault();
                              endRename(c.id);
                            }
                          }}
                          className="my-1.5 min-w-0 flex-1 rounded border border-border bg-surface-deep px-1.5 py-0.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent pointer-coarse:text-base"
                          aria-label={rowAction("Rename", c.title)}
                        />
                        <button
                          type="button"
                          onClick={() => void commitRename(c.id)}
                          aria-label="Save name"
                          className="min-touch-coarse inline-flex items-center justify-center p-1 text-sub hover:text-text"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => endRename(c.id)}
                          aria-label="Cancel rename"
                          className="min-touch-coarse inline-flex items-center justify-center p-1 text-sub hover:text-text"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void openThread(c)}
                          className="flex min-w-0 flex-1 items-start gap-2 py-1.5 text-left pointer-coarse:min-h-11"
                          title={c.title}
                          aria-current={active ? "true" : undefined}
                          aria-busy={opening === c.id || undefined}
                          data-thread-open={c.id}
                          data-history-focus={`open:${c.id}`}
                        >
                          <MessageSquare
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate" dir="auto">
                              {c.title}
                            </span>{" "}
                            <span className="text-xs text-sub">
                              {active && (
                                // aria-current says it to screen readers.
                                <span aria-hidden="true">
                                  <span className="font-medium text-text">{OPEN_NOW}</span> ·{" "}
                                </span>
                              )}
                              {tool && (
                                <>
                                  {tool} <span aria-hidden="true">·</span>{" "}
                                </>
                              )}
                              <time dateTime={c.lastMessageAt}>{threadTime(c.lastMessageAt)}</time>
                            </span>
                          </span>
                          {opening === c.id && (
                            // On its way in: the pen, as the panel's own loading draws it.
                            <InkScribble className="mt-1 h-3 w-8 shrink-0" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportThread(c)}
                          aria-label={rowAction("Export", c.title)}
                          className={`${ROW_ACTION} hover:text-text`}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(c.id);
                            setDraft(c.title);
                          }}
                          aria-label={rowAction("Rename", c.title)}
                          className={`${ROW_ACTION} hover:text-text`}
                          data-history-focus={`rename:${c.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          aria-label={rowAction("Delete", c.title)}
                          className={`${ROW_ACTION} hover:text-destructive`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
