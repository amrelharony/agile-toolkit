/**
 * Keeping keyboard and screen-reader users in place. Most actions here
 * remove the control that was pressed (a banner resolves, a row goes), and
 * focus then falls to <body>. These move it somewhere stable once React
 * has re-rendered and any closing dialog has handed focus back.
 */

/** Focus what `get` returns after the current render. */
export function focusSoon(get: () => HTMLElement | null | undefined): void {
  setTimeout(() => get()?.focus(), 0);
}

/**
 * After the row at `index` is removed from `list`: the control `selector`
 * picks in the row that took its place, else in the row before it, else
 * `fallback` (the field that adds the next one).
 */
export function focusAfterRemoval(
  list: { readonly current: HTMLElement | null },
  selector: string,
  index: number,
  fallback: () => HTMLElement | null | undefined
): void {
  focusSoon(() => {
    const rows = list.current?.querySelectorAll<HTMLElement>(selector);
    if (!rows || rows.length === 0) return fallback();
    return rows[Math.min(index, rows.length - 1)];
  });
}
