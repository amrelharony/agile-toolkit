/**
 * Keeping a keyboard user's place. Closing an editor, deleting a row,
 * adding a done story to the demo or moving an item to an end unmounts or
 * disables the focused control, and focus would otherwise drop to <body>.
 * Controls carry `data-<name>` attributes, found once React has re-rendered
 * (the same approach as Walking Skeleton).
 */

/** The element whose `data-<name>` is `value`; ids go in no selector, so need no escaping. */
export function byData(name: string, value: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-${name}]`)).find(
    (el) => el.getAttribute(`data-${name}`) === value
  );
}

/** Focus what `find` returns once React has re-rendered. */
export function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/**
 * After a move, keep focus on the moved item's arrow; at the top or bottom
 * that arrow is disabled, so focus its other one.
 */
export function focusMoved(name: string, id: string, dir: "up" | "down") {
  focusSoon(() => {
    const find = (d: string) => byData(name, `${id}:${d}`) as HTMLButtonElement | undefined;
    const el = find(dir);
    return el && !el.disabled ? el : find(dir === "up" ? "down" : "up");
  });
}
