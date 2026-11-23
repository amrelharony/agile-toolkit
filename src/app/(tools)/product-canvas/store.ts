"use client";

/**
 * Product Canvas's own settings, kept per browser: only how the page is
 * viewed (the format the list is filtered to). Every canvas is a workspace
 * record (`productCanvases`), so Amr and the other tools read what the page
 * shows. Read through `readLastFormat`: a synced or hand-edited value can
 * hold anything. The page rehydrates it on mount.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { BUILT_FORMATS } from "@/lib/product-canvas/formats";
import type { ProductCanvasFormat } from "@/lib/stores/workspace-types";

export interface ProductCanvasPrefs {
  /** The format the list shows, or "" for every format. */
  lastFormat: string;
}

export const useProductCanvasPrefs = createPersistedStore<ProductCanvasPrefs>("product-canvas", {
  lastFormat: "",
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
