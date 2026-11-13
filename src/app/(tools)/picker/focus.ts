/**
 * Moving focus on purpose on the Picker page. Saving or cancelling a form,
 * deleting a row, clearing a list or switching tabs removes the control that
 * had focus, and focus would otherwise drop to the page (WCAG 2.4.3). Each
 * of those hands focus to the control a person would reach for next.
 */

/** The wheel's Spin button. */
export const SPIN_BUTTON_ID = "picker-spin";

/**
 * Focus the first of `candidates` that can take it, once React has
 * re-rendered (the control that had focus may have gone, and the one to
 * focus may only now be mounted).
 */
export function focusSoon(...candidates: (() => HTMLElement | null | undefined)[]) {
  requestAnimationFrame(() => {
    for (const find of candidates) {
      const el = find();
      if (el && el.isConnected && !(el as HTMLButtonElement).disabled) {
        el.focus();
        return;
      }
    }
  });
}

/** Like `focusSoon`, but only when focus was lost (dropped to the page). */
export function focusIfLost(...candidates: (() => HTMLElement | null | undefined)[]) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    for (const find of candidates) {
      const el = find();
      if (el && el.isConnected && !(el as HTMLButtonElement).disabled) {
        el.focus();
        return;
      }
    }
  });
}

export const byId = (id: string) => () => document.getElementById(id);

export const spinButton = byId(SPIN_BUTTON_ID);
