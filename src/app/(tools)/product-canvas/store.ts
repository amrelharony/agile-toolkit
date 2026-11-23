"use client";

/**
 * Product Canvas's own settings, kept per browser: only how the page is
 * viewed (the format the list is filtered to, the idea inbox's status
 * filter, and whether an export of ideas names who asked). Every canvas is
 * a workspace record (`productCanvases`), so Amr and the other tools read
 * what the page shows. Read through `readLastFormat` and `readInboxFilter`:
 * a synced or hand-edited value can hold anything. The page rehydrates it
 * on mount.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { BUILT_FORMATS } from "@/lib/product-canvas/formats";
import { type InboxFilter } from "@/lib/product-canvas/intake";
import type { ProductCanvasFormat } from "@/lib/stores/workspace-types";

export { readInboxFilter } from "@/lib/product-canvas/intake";

export interface ProductCanvasPrefs {
  /** The format the list shows, or "" for every format but ideas (they have the inbox). */
  lastFormat: string;
  /** The idea inbox's status filter. */
  inboxFilter: string;
  /** "Include who asked": an export of ideas names their requesters. */
  withRequesters: boolean;
}

export const useProductCanvasPrefs = createPersistedStore<ProductCanvasPrefs>("product-canvas", {
  lastFormat: "",
  inboxFilter: "open",
  withRequesters: false,
});

/** A stored format filter: one this build offers, or "" for all. */
export function readLastFormat(raw: unknown): ProductCanvasFormat | "" {
  return typeof raw === "string" && (BUILT_FORMATS as readonly string[]).includes(raw)
    ? (raw as ProductCanvasFormat)
    : "";
}

/** Show only `format`'s canvases ("" for all). */
export function setLastFormat(format: ProductCanvasFormat | ""): void {
  useProductCanvasPrefs.setState({ lastFormat: format });
}

/** Show the inbox's ideas in `filter`. */
export function setInboxFilter(filter: InboxFilter): void {
  useProductCanvasPrefs.setState({ inboxFilter: filter });
}

/** Whether an export of ideas names who asked. */
export function setWithRequesters(on: boolean): void {
  useProductCanvasPrefs.setState({ withRequesters: on });
}
