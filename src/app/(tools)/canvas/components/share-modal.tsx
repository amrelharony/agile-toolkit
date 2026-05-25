"use client";

/**
 * Share + save-as-template modal (Phases 30, 31).
 *
 * Two side-by-side tabs:
 *   - Share: create a token-based share link in editor/viewer mode
 *   - Save: snapshot the current board as a workspace template
 *
 * The share-link tab lists existing tokens for this board (with
 * one-click revoke). The save tab takes a name + category + optional
 * description and stashes the snapshot into
 * `workspace.whiteboardSavedTemplates`. Saved templates appear in the
 * TemplateGallery under a "Custom" tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Share2,
  BookmarkPlus,
  Copy,
  Trash2,
  Check,
  Send,
  AlertTriangle,
  Users,
} from "lucide-react";
import { SessionShareContent } from "@/components/collab/session-share-modal";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  buildShareUrl,
  createShareToken,
  listShareTokens,
  revokeShareToken,
  type ShareToken,
} from "@/lib/whiteboard/share-link";
import type { WhiteboardSavedTemplate } from "@/lib/stores/workspace-types";
import { wbId } from "@/lib/whiteboard/clipboard";

interface Props {
  boardId: string;
  boardName: string;
  onClose: () => void;
}

type Tab = "share" | "save" | "post" | "squad";

export function ShareModal({ boardId, boardName, onClose }: Props) {
  // Stable callback ref so the keydown effect doesn't re-register on
  // every parent render — parents commonly pass an inline
  // `onClose={() => setShowShare(false)}` which changes identity each
  // render. Re-registering the listener every render is a latent bug
  // (briefly missed Esc presses, listener-set churn).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Non-capture so form fields get first crack at the Escape key. Also
    // guard against closing the modal when the user is editing a field —
    // many browsers fire Esc as "revert input", and we'd otherwise eat
    // their typed text along with the modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      // Form-control elements own their own Esc behaviour: INPUT reverts
      // pending edits, TEXTAREA does the same, SELECT collapses its
      // open dropdown without dismissing the surrounding modal,
      // contentEditable cancels composition. Closing the modal on top
      // of those would lose the user's in-progress edit.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      // Stop propagation only after we've decided to act, so a stacked
      // modal underneath doesn't also close on the same keystroke.
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // R11-fix: removed the standalone focus-restore effect — `useFocusTrap`
  // below now owns focus capture + restore, with the added `document.contains`
  // guard for triggers that get unmounted while the modal is open.

  const [tab, setTab] = useState<Tab>("share");
  const objects = useWorkspaceStore((s) => s.whiteboardObjects);
  const boardObjects = useMemo(
    () => (objects ?? []).filter((o) => o.boardId === boardId),
    [objects, boardId]
  );
  const upsertSavedTemplate = useWorkspaceStore((s) => s.upsertWhiteboardSavedTemplate);

  // Tokens are lifted up so ShareTab (which creates/revokes them) and
  // PostMessageTab (which composes a channel message around the latest
  // viewer link) read from the same source. Without this, the post tab's
  // useMemo would snapshot tokens at mount time and miss any link the
  // user creates before switching tabs.
  // Tokens load asynchronously now — server lookup + localStorage
  // fallback. Start empty and fill on mount.
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const refreshTokens = useCallback(() => {
    void listShareTokens(boardId).then(setTokens);
  }, [boardId]);
  // If the parent re-mounts the modal with a different boardId without
  // unmounting (rare, but possible across multi-board scenarios), the
  // useState initialiser doesn't re-run and `tokens` stays stale.
  // Re-fetch whenever boardId changes.
  useEffect(() => {
    let cancelled = false;
    void listShareTokens(boardId).then((rows) => {
      if (!cancelled) setTokens(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // R10-deferred: focus-trap so Tab cycles inside the dialog instead
  // of escaping to the underlying canvas (WCAG 2.4.3).
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share or save board"
      ref={dialogRef}
      className="fixed inset-0 z-modal flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-surface border border-border rounded-xl max-w-xl w-[92vw] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab("share")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                tab === "share"
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "text-sub hover:text-text"
              }`}
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
            <button
              type="button"
              onClick={() => setTab("save")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                tab === "save"
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "text-sub hover:text-text"
              }`}
            >
              <BookmarkPlus className="w-4 h-4" />
              Save as template
            </button>
            <button
              type="button"
              onClick={() => setTab("post")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                tab === "post"
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "text-sub hover:text-text"
              }`}
            >
              <Send className="w-4 h-4" />
              Post to Slack / Teams
            </button>
            <button
              type="button"
              onClick={() => setTab("squad")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                tab === "squad"
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "text-sub hover:text-text"
              }`}
            >
              <Users className="w-4 h-4" />
              Invite squad
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share/save dialog"
            className="text-sub hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {tab === "share" && (
          <ShareTab
            boardId={boardId}
            boardName={boardName}
            tokens={tokens}
            onTokensChanged={refreshTokens}
          />
        )}
        {tab === "save" && (
          <SaveTemplateTab
            boardId={boardId}
            boardName={boardName}
            boardObjects={boardObjects}
            onSaved={upsertSavedTemplate}
            onClose={onClose}
          />
        )}
        {tab === "post" && (
          <PostMessageTab
            boardId={boardId}
            boardName={boardName}
            objectCount={boardObjects.length}
            tokens={tokens}
          />
        )}
        {tab === "squad" && <SessionShareContent toolId="canvas" entityId={boardId} />}
      </div>
    </div>
  );
}

/** Share-link tab: create + list + revoke tokens for this board. */
function ShareTab({
  boardId,
  boardName,
  tokens,
  onTokensChanged,
}: {
  boardId: string;
  boardName: string;
  tokens: ShareToken[];
  onTokensChanged: () => void;
}) {
  const [role, setRole] = useState<"editor" | "viewer" | "commenter">("viewer");
  const [ttlDays, setTtlDays] = useState(7);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // Surface clipboard write failures (Safari permission denial, missing
  // user gesture, locked-down corp browser). Without this, a silent
  // failure looks like the button did nothing — users wonder if the
  // token was actually created.
  const [copyError, setCopyError] = useState<string | null>(null);

  const onCreate = async () => {
    try {
      const { url, token } = await createShareToken(boardId, role, ttlDays);
      onTokensChanged();
      setCopyError(null);
      // Auto-copy newly created link to clipboard.
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(url).then(
          () => {
            setCopiedToken(token);
            setTimeout(() => setCopiedToken(null), 2000);
          },
          (err: unknown) => {
            console.warn("clipboard write failed:", err);
            setCopyError("Couldn't copy to clipboard — link is in the list below.");
          }
        );
      }
    } catch (err) {
      // Surface auth-required + generic errors. The auth-required case
      // hits when a user without a Supabase session tries to issue a
      // server-persisted token. ShareTokenAuthRequiredError carries a
      // canned message; everything else falls through to its `.message`.
      const message =
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as Error).message === "string"
          ? (err as Error).message
          : "Couldn't create share link.";
      setCopyError(message);
    }
  };

  const onCopy = (token: string) => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      setCopyError("Clipboard unavailable in this browser.");
      return;
    }
    // Look up the token to figure out which view= param to add — viewer
    // tokens get `?view=readonly`, commenter tokens get `?view=commenter`,
    // editor tokens get no view= param. We delegate to buildShareUrl so
    // share-link.ts and this tab can't drift apart.
    const hit = tokens.find((t) => t.token === token);
    if (!hit) return;
    const url = buildShareUrl(boardId, token, hit.role);
    setCopyError(null);
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopiedToken(token);
        setTimeout(() => setCopiedToken(null), 2000);
      },
      (err: unknown) => {
        console.warn("clipboard write failed:", err);
        setCopyError("Couldn't copy to clipboard.");
      }
    );
  };

  const onRevoke = async (token: string) => {
    await revokeShareToken(token);
    onTokensChanged();
  };

  return (
    <div className="p-4">
      <p className="text-sm text-sub mb-3">
        Create a share link for <strong className="text-text">{boardName}</strong>. Editor links
        allow full collaboration; viewer links are read-only.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="text-xs text-sub flex flex-col gap-1">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "editor" | "viewer" | "commenter")}
            className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value="viewer">Viewer (read-only)</option>
            <option value="commenter">Commenter (can drop comments)</option>
            <option value="editor">Editor (full access)</option>
          </select>
        </label>
        <label className="text-xs text-sub flex flex-col gap-1">
          Expires in
          <select
            value={ttlDays}
            onChange={(e) => setTtlDays(Number(e.target.value))}
            className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="w-full bg-accent text-bg font-medium px-3 py-2 rounded text-sm hover:bg-accent/80 mb-4"
      >
        Create link
      </button>

      {copyError && (
        <div
          role="alert"
          className="flex items-start gap-2 mb-3 p-2.5 border border-amber-500/40 bg-amber-500/10 rounded text-xs text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{copyError}</span>
        </div>
      )}

      <div className="text-xs uppercase font-mono text-sub mb-2">
        Active links ({tokens.length})
      </div>
      {tokens.length === 0 ? (
        <div className="text-xs text-sub italic">No active links.</div>
      ) : (
        <ul className="space-y-1.5">
          {tokens.map((t) => {
            // BUG-RD3-share-modal-1: round UP so a token with 23.5h
            // left displays as "1d", not "0d". The prior `floor`
            // produced "0d left" the instant a TTL=1 link was created
            // at 23:30 local even though the link was actually valid
            // for another 23.5h. Cap at 0 only when truly expired.
            const remainingMs = t.expiresAt - Date.now();
            const remaining = remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 86400000);
            return (
              <li
                key={t.token}
                className="flex items-center gap-2 text-xs bg-surface-deep border border-border rounded px-2 py-1.5"
              >
                <span className="font-mono text-text">{t.token}</span>
                <span
                  className={`text-[10px] uppercase font-bold ${
                    t.role === "editor"
                      ? "text-amber-300"
                      : t.role === "commenter"
                        ? "text-emerald-300"
                        : "text-cyan-300"
                  }`}
                >
                  {t.role}
                </span>
                <span className="text-sub flex-1">
                  {remaining > 0 ? `${remaining}d left` : "expires today"}
                </span>
                <button
                  type="button"
                  onClick={() => onCopy(t.token)}
                  aria-label="Copy share link"
                  className="text-sub hover:text-accent"
                >
                  {copiedToken === t.token ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onRevoke(t.token)}
                  aria-label="Revoke link"
                  className="text-sub hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Save-as-template tab: snapshot the current board into the workspace
 * template library. The saved template appears in TemplateGallery's
 * "Custom" category. */
function SaveTemplateTab({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  boardId,
  boardName,
  boardObjects,
  onSaved,
  onClose,
}: {
  boardId: string;
  boardName: string;
  boardObjects: ReturnType<typeof useWorkspaceStore.getState>["whiteboardObjects"];
  onSaved: (t: WhiteboardSavedTemplate) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(boardName);
  const [category, setCategory] = useState("custom");
  const [description, setDescription] = useState("");
  const objs = boardObjects ?? [];

  const onSave = () => {
    if (!name.trim() || objs.length === 0) return;
    const id = wbId("wbt");
    const now = new Date().toISOString();
    onSaved({
      id,
      name: name.trim(),
      description: description.trim() || undefined,
      category,
      // Strip id/boardId so the apply path can reassign fresh values.
      // The TemplateGallery's apply function already handles id/board
      // assignment, but stripping here keeps the saved data clean.
      objects: objs.map((o) => ({ ...o, boardId: "" })),
      createdAt: now,
    });
    onClose();
  };

  return (
    <div className="p-4">
      <p className="text-sm text-sub mb-3">
        Snapshot <strong className="text-text">{boardName}</strong> ({objs.length} object
        {objs.length === 1 ? "" : "s"}) into the workspace template library. Future boards can apply
        it via Templates → Custom.
      </p>
      <label className="text-xs text-sub flex flex-col gap-1 mb-2">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
        />
      </label>
      <label className="text-xs text-sub flex flex-col gap-1 mb-2">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
        >
          <option value="custom">Custom</option>
          <option value="retro">Retro</option>
          <option value="planning">Planning</option>
          <option value="strategy">Strategy</option>
          <option value="brainstorm">Brainstorm</option>
        </select>
      </label>
      <label className="text-xs text-sub flex flex-col gap-1 mb-3">
        Description (optional)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          rows={3}
          className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent resize-none"
        />
      </label>
      <button
        type="button"
        onClick={onSave}
        disabled={!name.trim() || objs.length === 0}
        className="w-full bg-accent text-bg font-medium px-3 py-2 rounded text-sm hover:bg-accent/80 disabled:opacity-40"
      >
        Save template
      </button>
    </div>
  );
}

/**
 * Escape user-supplied text before it ends up in a Slack/Teams message.
 *
 * Slack treats `<`, `>`, `|`, `&` as link/mention/entity syntax — if a
 * board name happens to contain `<` (e.g. "User<>System retro"), the
 * channel renders it as a broken link or worse, swallows part of the
 * message. We also strip leading `@` from tokens to prevent unintended
 * `@channel`/`@here` pings from a stray "@everyone" in the note.
 *
 * Teams uses standard markdown which is mostly safe; we only neutralise
 * the HTML-significant characters that could render unexpectedly.
 */
function escapeForChannel(text: string, target: "slack" | "teams"): string {
  if (!text) return text;
  if (target === "slack") {
    return (
      text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\|/g, "│")
        // Strip @ at the start of any word so @channel/@here/@user never
        // resolves to a real mention from copy-pasted content.
        .replace(/(^|\s)@/g, "$1")
    );
  }
  // teams
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Post-to-Slack/Teams tab: produces a formatted markdown message the
 * user can paste into Slack or Teams along with the board URL. We don't
 * (and shouldn't) post directly from the client — that requires the
 * team's webhook, which lives in the workspace's external config.
 *
 * `createShareToken` already emits a `whiteboard.boardShared` signal on
 * link creation, which is the single source of truth — we no longer
 * emit a second signal from the copy button to avoid double-counting in
 * any subscribers. */
function PostMessageTab({
  boardId,
  boardName,
  objectCount,
  tokens,
}: {
  boardId: string;
  boardName: string;
  objectCount: number;
  tokens: ShareToken[];
}) {
  const [target, setTarget] = useState<"slack" | "teams">("slack");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  // Clipboard writes can fail silently in Safari without a user gesture,
  // in locked-down corp browsers, or when an iframe ancestor has no
  // clipboard permission. We surface a small banner so the user knows
  // the message wasn't actually copied and can fall back to manual
  // copy-paste from the textarea.
  const [copyError, setCopyError] = useState<string | null>(null);

  // Pick the best token for sharing externally. Prefer viewer (true
  // read-only), then commenter (read-only objects, can drop comments).
  // We explicitly REFUSE to fall back to an editor token here — pasting
  // a write-access URL into a public channel would let any reader edit
  // (or wipe) the board. If only editor tokens exist, the user must
  // create a viewer/commenter link before posting publicly.
  const bestToken = useMemo<ShareToken | null>(() => {
    return (
      tokens.find((t) => t.role === "viewer") ?? tokens.find((t) => t.role === "commenter") ?? null
    );
  }, [tokens]);
  // True when the user has tokens but they're ALL editor-tier. Drives a
  // distinct (red) warning that's louder than the generic "no link"
  // empty-state, because the user thinks they're ready to post.
  const editorOnlyWarning = useMemo(
    () => bestToken === null && tokens.some((t) => t.role === "editor"),
    [bestToken, tokens]
  );

  const shareUrl = useMemo(() => {
    if (!bestToken) return "";
    return buildShareUrl(boardId, bestToken.token, bestToken.role);
  }, [boardId, bestToken]);

  const message = useMemo(() => {
    const safeName = escapeForChannel(boardName, target);
    const safeNote = note.trim() ? escapeForChannel(note.trim(), target) : "";
    const noteLine = safeNote ? `\n${safeNote}\n` : "";
    if (target === "slack") {
      // Slack-flavoured markdown: *bold*, _italic_, bullets via "•".
      return (
        `*Canvas board shared:* <${shareUrl}|${safeName}>` +
        `\n• ${objectCount} object${objectCount === 1 ? "" : "s"} on the board` +
        `${noteLine}` +
        `\n_Open the canvas to leave comments and react._`
      );
    }
    // Teams accepts standard markdown. Italics in Teams use *single
    // asterisks*, not underscores — underscores render as literal text.
    return (
      `**Canvas board shared:** [${safeName}](${shareUrl})` +
      `\n- ${objectCount} object${objectCount === 1 ? "" : "s"} on the board` +
      `${noteLine}` +
      `\n*Open the canvas to leave comments and react.*`
    );
  }, [target, boardName, shareUrl, objectCount, note]);

  const canCopy = bestToken !== null;

  const onCopyMessage = () => {
    if (!canCopy) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyError(
        "Clipboard unavailable in this browser — select the preview text above and copy manually."
      );
      return;
    }
    setCopyError(null);
    void navigator.clipboard.writeText(message).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        // No emitSignal here — createShareToken is the single source of
        // truth for the boardShared signal. Emitting again on every paste
        // would double-count in any subscribers (analytics, server-side
        // webhook forwarders, etc.).
      },
      (err: unknown) => {
        console.warn("clipboard write failed:", err);
        setCopyError(
          "Couldn't copy automatically — select the preview text above and copy manually."
        );
      }
    );
  };

  return (
    <div className="p-4">
      <p className="text-sm text-sub mb-3">
        Paste this message into your team channel. We don&apos;t post directly — your team&apos;s
        webhook lives in your Slack/Teams admin, not the canvas.
      </p>
      {editorOnlyWarning ? (
        <div
          role="alert"
          className="flex items-start gap-2 mb-3 p-2.5 border border-red-500/50 bg-red-500/10 rounded text-xs text-red-200"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Only editor links exist — create a viewer link before posting publicly.</strong>{" "}
            An editor link grants write access; anyone with the URL could edit or delete board
            content. Switch to the Share tab and create a viewer or commenter link.
          </div>
        </div>
      ) : (
        !canCopy && (
          <div className="flex items-start gap-2 mb-3 p-2.5 border border-amber-500/40 bg-amber-500/10 rounded text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>No share link active.</strong> Create a viewer link in the Share tab first —
              pasting a bare board URL into a public channel will require login and exposes
              ownership.
            </div>
          </div>
        )
      )}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="text-xs text-sub flex flex-col gap-1">
          Target
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as "slack" | "teams")}
            className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value="slack">Slack</option>
            <option value="teams">Microsoft Teams</option>
          </select>
        </label>
      </div>
      <label className="text-xs text-sub flex flex-col gap-1 mb-3">
        Optional note
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="e.g. retro starts at 3pm — please add your stickies first"
          className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
        />
      </label>
      <label className="text-xs text-sub flex flex-col gap-1 mb-3">
        Message preview
        <textarea
          value={message}
          readOnly
          rows={6}
          className="bg-surface-deep border border-border rounded px-2 py-1.5 text-xs text-text font-mono focus:outline-none focus:border-accent resize-none"
        />
      </label>
      <button
        type="button"
        onClick={onCopyMessage}
        disabled={!canCopy}
        className="w-full bg-accent text-bg font-medium px-3 py-2 rounded text-sm hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied
          ? "Copied — paste into your channel"
          : `Copy ${target === "slack" ? "Slack" : "Teams"} message`}
      </button>
      {copyError && (
        <div
          role="alert"
          className="flex items-start gap-2 mt-2 p-2.5 border border-amber-500/40 bg-amber-500/10 rounded text-xs text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{copyError}</span>
        </div>
      )}
      <p className="text-[10px] text-sub mt-2 italic">
        Tip: pair with a server-side webhook subscriber on{" "}
        <code className="text-text">whiteboard.boardShared</code> to post automatically.
      </p>
    </div>
  );
}
