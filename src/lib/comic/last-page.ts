/**
 * The comic's resume point ("Continue from p. N"), as stored per device
 * under COMIC_LAST_PAGE_KEY. The format has not changed since the first
 * reader: a JSON number. Pure, so the rule is tested without a browser.
 */

/**
 * A saved last page, or null for "none". Accepts what the first reader
 * accepted (it read the slot with `Number(JSON.parse(raw))`): an integer
 * of 1 or more, also when it was stored as a numeric string.
 */
export function validLastPage(value: unknown): number | null {
  const page =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isInteger(page) && page >= 1 ? page : null;
}

/** The page to offer as "Continue from p. N": a saved page past the cover
 * that this PDF still has. A fresh visit opens on the cover either way. */
export function resumablePage(saved: unknown, numPages: number): number | null {
  const page = validLastPage(saved);
  return page !== null && page > 1 && page <= numPages ? page : null;
}
