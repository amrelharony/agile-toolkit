/**
 * Whether a product canvas still fits one synced row: the base's
 * ENTITY_ROW_MAX_BYTES (480 KB of UTF-8 JSON), measured with the shared
 * `jsonBytes`. At the page's caps a canvas stays well under it; the guard
 * is for rows an agent or an import filled past them. Every write that
 * grows a canvas checks it first, and says the CRUD's own sentence when it
 * doesn't fit.
 *
 * Pure and server-safe.
 */

import { ENTITY_ROW_MAX_BYTES } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

/** Whether `row` fits one synced row. */
export function fitsEntity(row: unknown): boolean {
  return jsonBytes(row) <= ENTITY_ROW_MAX_BYTES;
}

/** What a write that would not fit says: the workspace CRUD's own refusal, word for word. */
export const TOO_BIG_TO_SAVE =
  "This product canvas is too big to save. Shorten or remove some lines. Nothing was saved.";
