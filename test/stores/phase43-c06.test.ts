/**
 * Product Canvas's records in the workspace store (chain C06; the base's
 * phase43 tests cover the collection itself). The page's own canvases, the
 * example's included, ride export and import and read back as written; the
 * store stamps nothing; and a stored row is kept as it is, never rewritten
 * by a read (P2.3b's formats are read now, through the same model).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The store registers its sync targets with the engine: capture, don't start one.
vi.mock("@/lib/sync/register", () => ({
  registerEntityCollection: () => {},
  registerBlobStore: () => {},
}));

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { buildExample } from "@/app/(tools)/product-canvas/example";
import { newCanvas, readCanvas, readCanvases, withItem } from "@/lib/product-canvas/model";
import { PRODUCT_CANVAS } from "./phase43-fixtures";

const ws = () => useWorkspaceStore.getState();
const NOW = new Date("2026-11-23T10:00:00.000Z");

beforeAll(async () => {
  await Promise.resolve(useWorkspaceStore.persist.rehydrate());
});

beforeEach(() => {
  ws().resetWorkspace();
});

describe("product canvases in the workspace store", () => {
  it("keep the example's canvases through export and import, each read back as written", () => {
    const example = buildExample(NOW);
    for (const c of example) ws().upsertProductCanvas(c);
    const json = ws().exportJSON();
    ws().resetWorkspace();
    expect(ws().productCanvases).toEqual([]);
    ws().importJSON(json);
    expect(ws().productCanvases).toEqual(example);
    for (const c of example) expect(readCanvas(c)).toEqual(c);
  });

  it("stamp nothing: a write keeps the time the model gave it", () => {
    const c = newCanvas({
      id: "pcanvas_s1",
      format: "vision-board",
      title: "Tapline",
      now: "2026-11-20T09:00:00.000Z",
    });
    ws().upsertProductCanvas(c);
    const added = withItem(c, "who", { text: "Stall holders" }, "2026-11-21T09:00:00.000Z");
    if (!added.ok) throw new Error(added.message);
    ws().upsertProductCanvas(added.canvas);
    expect(ws().productCanvases).toEqual([added.canvas]);
    expect(ws().productCanvases?.[0]).toMatchObject({
      createdAt: "2026-11-20T09:00:00.000Z",
      updatedAt: "2026-11-21T09:00:00.000Z",
    });
  });

  it("keep a row as written: reading a canvas never writes it back", () => {
    // The base's shape-up fixture holds fields a Shape Up pitch doesn't use:
    // the page's read leaves them out, and the stored row keeps them.
    ws().upsertProductCanvas(PRODUCT_CANVAS);
    ws().upsertProductCanvas(buildExample(NOW)[0]);
    expect(
      readCanvases(ws().productCanvases)
        .map((c) => c.format)
        .sort()
    ).toEqual(["shape-up", "vision-board"]);
    expect(readCanvas(PRODUCT_CANVAS)?.intake).toBeUndefined();
    const json = ws().exportJSON();
    ws().resetWorkspace();
    ws().importJSON(json);
    expect(ws().productCanvases).toContainEqual(PRODUCT_CANVAS);
  });
});
