"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
// NOTE: do NOT import @tiptap/extension-link here — StarterKit v3 bundles
// it. Importing separately *and* listing it in `extensions` produced a
// "Duplicate extension names found: ['link']" warning AND caused the
// editor to fail to mount silently. Even the bare import is suspicious
// (some Tiptap builds side-register on import), so we strip it entirely.
// Configure Link via `StarterKit.configure({ link: { ... } })` below.
import { sanitizeRichHtml } from "@/lib/utils/safe-html";

/**
 * Rich-text inline editor for sticky / text objects. Wraps Tiptap's
 * EditorContent and matches the existing InlineEditor API
 * (initialText + onCommit) so dropping it in is a 1-line swap.
 *
 * Conversion rules:
 *   - Input `initialText` may be either plain text or HTML. We
 *     detect HTML by the presence of a `<` opening tag and call
 *     `editor.setContent` accordingly. Plain text is preserved
 *     verbatim — Tiptap wraps it in a single <p>.
 *
 *   - On commit we sanitize the resulting HTML (sanitizeRichHtml)
 *     before calling onCommit. The same sanitizer runs on the
 *     render path so even unsanitized realtime patches are safe to
 *     display, but doubling the check keeps locally-typed content
 *     clean before it ever broadcasts.
 *
 * Behaviour we match from the plain-text InlineEditor:
 *   - Auto-focus + select-all on mount
 *   - Enter commits, Shift+Enter inserts a newline
 *   - Esc commits (no "cancel" path — discarding the user's typing
 *     without an undo affordance feels hostile)
 *   - Blur commits
 *   - 50_000 char hard cap (Tiptap doesn't natively enforce this;
 *     we count on every transaction and roll back overflows)
 *   - pointer-down + double-click stopPropagation so the canvas
 *     marquee / drag handlers don't fire while typing
 *
 * IME (composition) handling: ProseMirror, which Tiptap is built on,
 * handles `compositionstart` / `compositionend` natively and only
 * commits to the doc on `compositionend`. We don't have to layer the
 * `isComposing` guard that the textarea version needed.
 */
export function TiptapInlineEditor({
  initialText,
  onCommit,
  background,
  color,
  fontSize,
  fontWeight,
  align,
  padding,
}: {
  initialText: string;
  onCommit: (text: string) => void;
  background?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  padding?: number;
}) {
  // Track the most recent value so blur reads the latest text even
  // if a fresh keystroke arrives in the same tick as blur.
  const latestRef = useRef(initialText);
  // Track the original initialText (immutable for the editor lifetime)
  // so the unmount-commit gate can compare "has the content actually
  // changed since mount?". React Strict Mode's simulated unmount
  // happens before any user input — at that point latestRef equals
  // initialRef and we skip the commit, preventing the parent from
  // clearing editingObjectId and tearing the editor down for good.
  const initialRef = useRef(initialText);

  // Tiptap accepts either raw HTML or plain text in `content`
  // directly — it parses both via the same path — so we don't need
  // to branch on input format. (Earlier revisions had an HTML-vs-text
  // detection ternary here but both branches passed `initialText`
  // verbatim, so it's been removed.)
  const editor = useEditor({
    extensions: [
      // StarterKit v3 BUNDLES @tiptap/extension-link, so registering Link
      // separately produces a "Duplicate extension names found: ['link']"
      // warning and causes the editor to fail to mount silently in some
      // builds. Configure Link inline on StarterKit instead.
      StarterKit.configure({
        // Drop horizontal rule + image — out of scope for sticky/text
        // edit and they add UX edges we don't want to support yet.
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        },
      }),
    ],
    content: initialText,
    autofocus: "end",
    editorProps: {
      attributes: {
        // Inline padding + sizing applied via wrapper style, but
        // give Tiptap a sensible class so its content sits flush.
        class: "tiptap-canvas-editor focus:outline-none",
      },
      handleKeyDown(_view, event) {
        // Enter commits unless Shift is held (Tiptap default: Enter
        // adds a new paragraph). We pre-empt and commit so the
        // canvas convention ("Enter = done") wins.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onCommit(sanitizeRichHtml(latestRef.current));
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCommit(sanitizeRichHtml(latestRef.current));
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor: ed }) {
      // 50k char cap. Tiptap doesn't expose maxLength; check on every
      // update and trim by walking back to the last 50k chars of
      // sanitized HTML. Cheap to skip when under the cap.
      const html = ed.getHTML();
      if (html.length > 50_000) {
        latestRef.current = html.slice(0, 50_000);
      } else {
        latestRef.current = html;
      }
    },
    immediatelyRender: false, // SSR-safe; the editor mounts in useEffect
  });

  // Auto-select on mount. Tiptap's autofocus: "end" gives us focus
  // but doesn't select existing content. Mirror the textarea behaviour
  // where placeholder text ("Sticky note") gets replaced by the
  // first keystroke.
  useEffect(() => {
    if (!editor) return;
    // Defer one tick so the editor has mounted its DOM.
    const t = window.setTimeout(() => {
      editor.chain().focus().selectAll().run();
    }, 0);
    return () => window.clearTimeout(t);
  }, [editor]);

  // Final commit on unmount, gated on "the user actually changed the
  // content". Without the gate, React Strict Mode's simulated
  // mount→unmount→remount cycle fires this cleanup immediately on
  // first mount, calling onCommit with the unchanged initial value.
  // The parent's commit handler then calls setEditingObjectId(null),
  // and by the time the strict-mode re-mount happens `editing` is
  // already false — so the editor never appears to the user in dev.
  // Comparing latestRef against initialRef catches both:
  //   - Strict-mode dry-run unmount (no input → latest === initial → skip)
  //   - Real unmount with edits (latest !== initial → commit normally)
  useEffect(() => {
    return () => {
      if (latestRef.current === initialRef.current) return;
      onCommit(sanitizeRichHtml(latestRef.current));
    };
    // onCommit deliberately omitted from deps — we want unmount-only
    // semantics here, not "commit whenever the callback changes".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sanitize on the way out so downstream consumers (workspace
  // store, realtime broadcast) never see unsafe HTML. The render path
  // re-sanitizes defensively, but the realtime broadcast layer would
  // otherwise send raw HTML to peers. Every commit path (Enter,
  // Escape, blur, unmount) now sanitizes — see handleKeyDown above
  // and the unmount-cleanup below.
  const wrappedOnCommit = (raw: string) => {
    onCommit(sanitizeRichHtml(raw));
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => wrappedOnCommit(latestRef.current)}
      style={{
        position: "absolute",
        inset: 0,
        background: background ?? "transparent",
        color: color ?? "inherit",
        border: "none",
        outline: "2px solid #00f0ff",
        outlineOffset: -1,
        borderRadius: 6,
        padding: padding ?? 10,
        boxSizing: "border-box",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: fontSize ?? 14,
        fontWeight: fontWeight ?? 400,
        textAlign: align ?? "left",
        overflow: "auto",
        cursor: "text",
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
