/**
 * HTML sanitizer for user-authored rich text on the canvas.
 *
 * We use a restrictive DOMPurify allowlist that matches the Tiptap
 * StarterKit output surface: bold/italic/underline/strikethrough,
 * paragraphs, line breaks, headings (h1-h3), bullet/ordered lists,
 * blockquote, code blocks, inline code, and HTTPS links.
 *
 * Everything else — scripts, iframes, event handlers, data URLs,
 * javascript: URLs, foreign elements, style attributes — is stripped.
 *
 * Sanitization runs on:
 *   - Editor commit (before writing to the store)
 *   - Render path (before `dangerouslySetInnerHTML`)
 *
 * Doubling up is intentional: data may arrive from realtime peers
 * without ever passing through the local editor, so the render-side
 * check is the load-bearing barrier.
 */

import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p", "br",
  "strong", "b", "em", "i", "u", "s", "strike", "del",
  "h1", "h2", "h3",
  "ul", "ol", "li",
  "blockquote",
  "code", "pre",
  "a",
] as const;

const ALLOWED_ATTRS = [
  "href",
  "target",
  "rel",
] as const;

/**
 * Sanitize a rich-text HTML string for safe rendering or storage.
 *
 * Empty / non-string input returns "". Whitespace-only HTML
 * (DOMPurify-stripped to nothing) also returns "" so the renderer
 * can skip empty <div dangerouslySetInnerHTML> nodes and fall back
 * to placeholder text.
 *
 * URL hardening:
 *   - `href` is constrained to `https://`, `http://`, or `mailto:`
 *   - `javascript:` / `data:` / `vbscript:` URLs get stripped
 *   - All `<a>` tags get `rel="noopener noreferrer"` and `target="_blank"`
 *     added automatically by the AFTER_SANITIZE_ATTRIBUTES hook.
 */
export function sanitizeRichHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  // DOMPurify is browser-only (uses jsdom in Node, but we don't need
  // SSR sanitization — every render path is "use client"). Guard
  // for safety in case this gets called server-side anyway.
  if (typeof window === "undefined") return "";

  // Force https/mailto on every <a> href; force rel/target hardening.
  // We hook into AFTER_SANITIZE_ATTRIBUTES so DOMPurify has already
  // stripped malformed attrs by the time we run.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    const a = node as HTMLAnchorElement;
    const href = a.getAttribute("href") ?? "";
    const ok =
      href.startsWith("https://") ||
      href.startsWith("http://") ||
      href.startsWith("mailto:");
    if (!ok) a.removeAttribute("href");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("target", "_blank");
  });

  try {
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTRS],
      // Disallow user-controlled style / class so a hostile peer can't
      // inject `style="background:url(javascript:...)"` or similar.
      FORBID_ATTR: ["style", "class"],
      // DO NOT set KEEP_CONTENT: false — DOMPurify v3 only adds
      // `#text` to ALLOWED_TAGS when KEEP_CONTENT is true (its
      // default). Setting it false strips every text node, including
      // those inside allowed tags like <p>, so `<p>Hello</p>` becomes
      // `<p></p>`. The "drop content of dangerous tags like <script>"
      // behaviour we want is already covered by DOMPurify's built-in
      // FORBID_CONTENTS list — leaving KEEP_CONTENT as the default
      // (true) keeps user text while still neutralising <script>.
    });
    return clean.trim();
  } finally {
    // Always remove our hook so a follow-up sanitize call from
    // unrelated code (a hypothetical second consumer of DOMPurify)
    // doesn't inherit our href policy.
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

/**
 * Check whether a rich-text HTML string is effectively empty
 * (contains only whitespace + empty tags). Used by the renderer to
 * decide whether to show placeholder text.
 */
export function isRichHtmlEmpty(html: string): boolean {
  if (typeof html !== "string") return true;
  const clean = sanitizeRichHtml(html);
  if (!clean) return true;
  // Strip tags + nbsp; if anything visible is left, it's not empty.
  const visible = clean.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
  return visible.length === 0;
}
