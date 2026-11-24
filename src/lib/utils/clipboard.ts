/**
 * Copy text to the clipboard. On its own, with no imports, so a Copy button
 * (ui/copy-button, the chat's Copy reply) doesn't pull export.ts's PNG and
 * file-saver code into its chunk. export.ts re-exports it for older callers.
 *
 * Resolves true when the text reached the clipboard, false when neither path
 * worked. Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Primary path: async Clipboard API. Requires secure context + activation;
  // legacy browsers + HTTP contexts fail here.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea trick
    }
  }
  // Fallback path: hidden textarea + execCommand. Deprecated but still the
  // only thing that works on Safari iOS over HTTP and in some embedded webviews.
  if (typeof document === "undefined" || !document.body) return false;
  // Selecting the textarea moves focus into it; put focus back where it was
  // (the Copy button, usually), or a keyboard user would land on <body>.
  const before = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  try {
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.tabIndex = -1;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    // iOS ignores select() on a read-only field; a range still works there.
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    if (before && before !== document.body && before.isConnected) {
      try {
        before.focus({ preventScroll: true });
      } catch {
        // an element that can't take focus any more: leave it
      }
    }
  }
}
