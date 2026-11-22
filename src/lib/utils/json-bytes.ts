/**
 * The size of a value as it travels or is stored: the UTF-8 length of
 * `JSON.stringify(value)`. One counter for every byte budget in the
 * toolkit, so nobody writes their own: AI input fitters against
 * `TOOL_AI_BODY_BUDGET`, a page's row check against `ENTITY_ROW_MAX_BYTES`
 * before a write that grows a row, and the server blob writer's
 * `USER_STATE_BLOB_MAX_BYTES` (`src/lib/actions/server-store.ts`).
 *
 * Plain and isomorphic (browser, Node and Edge): no React, no zod.
 *
 * - `undefined`, a function or a symbol has no JSON, so it measures 0.
 * - A character costs 1 to 4 bytes: ASCII 1, Latin and Arabic 2, the rest of
 *   the Basic Multilingual Plane (CJK) 3, an astral character (emoji) 4. A
 *   capped string counts UTF-16 units, so real text costs at most 3 bytes
 *   per counted unit.
 * - Control characters and lone surrogates are escaped (`\u0001`, `\ud800`),
 *   6 bytes each.
 * - It throws where `JSON.stringify` does (a cycle, a BigInt): the caller's
 *   value could never be sent or saved either.
 */

const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : encoder.encode(json).length;
}
