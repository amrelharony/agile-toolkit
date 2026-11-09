/**
 * Fake scroll metrics for a scroll strip (jsdom has no layout). Shared by
 * the tool-rail and board-toolbar suites. NOT a test file.
 */
type ScrollMetric =
  | "scrollTop"
  | "scrollLeft"
  | "clientHeight"
  | "clientWidth"
  | "scrollHeight"
  | "scrollWidth";

export function setScroll(el: HTMLElement, metrics: Partial<Record<ScrollMetric, number>>) {
  for (const [k, v] of Object.entries(metrics)) {
    Object.defineProperty(el, k, { configurable: true, writable: true, value: v });
  }
}
