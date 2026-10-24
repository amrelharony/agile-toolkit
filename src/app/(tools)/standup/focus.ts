/**
 * Keeping keyboard and screen-reader users in place on the standup. Many
 * actions here remove the control that was pressed (Start gives way to Next
 * speaker, a person leaves the speaking order, an editor closes, a blocker
 * moves to Resolved), and focus then falls to <body>. Controls focus can
 * move to carry `data-focus-key`; these put focus on one of them once React
 * has re-rendered.
 */

/** Focus what `get` returns after the current render. */
export function focusSoon(get: () => HTMLElement | null | undefined): void {
  setTimeout(() => get()?.focus(), 0);
}

/**
 * The first control on the page whose data-focus-key is one of `keys`, in
 * the order given (later keys are fallbacks). Only one mode and one tab
 * are drawn at a time, so the keys are unique on the page.
 */
export function byFocusKey(...keys: (string | null | undefined)[]): () => HTMLElement | null {
  return () => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>("[data-focus-key]"));
    for (const key of keys) {
      const el = key ? controls.find((c) => c.dataset.focusKey === key) : undefined;
      if (el) return el;
    }
    return null;
  };
}
