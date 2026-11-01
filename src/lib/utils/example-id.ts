/**
 * Example rows: their ids start with `example-`, so a tool can show a
 * notice while any are present and remove exactly those on "Clear example".
 *
 * A plain module (no "use client"), so the pure libraries the agent
 * actions call on the server can tell example rows apart: a function
 * exported from a client module is only a reference there, and calling it
 * throws. components/tool-frame/example-data re-exports these for pages.
 */

export const EXAMPLE_ID_PREFIX = "example-";

/** An id for an example row: `exampleId("r1")` → "example-r1". */
export function exampleId(key: string | number): string {
  return `${EXAMPLE_ID_PREFIX}${key}`;
}

export function isExampleId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(EXAMPLE_ID_PREFIX);
}

/** Whether any of `items` came from the example. */
export function hasExampleItems(items: readonly { id: string }[] | null | undefined): boolean {
  return Boolean(items?.some((i) => isExampleId(i.id)));
}
