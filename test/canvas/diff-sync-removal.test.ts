/**
 * diff-sync removal authority: the creator must be able to delete an object
 * even after a DIFFERENT peer was the last to edit it.
 *
 * applyPatch records `createdBy` (anchored to the carrier `patch.by`, like
 * `updatedBy`) on the local copy. Without it, a received object carried
 * `updatedBy = <last editor>` and `createdBy = undefined`, so the creator's
 * removal patch was dropped by the ownership check and the object resurrected.
 *
 * The security guarantee is unchanged: a peer who is neither the recorded
 * creator nor the last writer still cannot remove an object.
 */

import { describe, it, expect } from "vitest";
import { applyPatch, type WhiteboardPatch } from "@/lib/whiteboard/diff-sync";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

const sticky = (
  id: string,
  version: number,
  extra: Partial<WhiteboardObject> = {}
): WhiteboardObject =>
  ({
    id,
    boardId: "b1",
    type: "sticky",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 1,
    version,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    content: "",
    color: "#fff",
    ...extra,
  }) as WhiteboardObject;

const patch = (over: Partial<WhiteboardPatch>): WhiteboardPatch => ({
  upserted: [],
  removed: [],
  by: "X",
  at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("applyPatch — createdBy stamping", () => {
  it("stamps createdBy from the carrier on first sight when the object lacks it", () => {
    const merged = applyPatch([], patch({ upserted: [sticky("o1", 1)], by: "A" }));
    expect(merged[0].createdBy).toBe("A");
    expect(merged[0].updatedBy).toBe("A");
  });

  it("preserves a createdBy the broadcast object already carries", () => {
    const merged = applyPatch(
      [],
      patch({ upserted: [sticky("o1", 1, { createdBy: "A" })], by: "B" })
    );
    // The drift-recovery answerer (B) is not the creator (A) — keep A.
    expect(merged[0].createdBy).toBe("A");
    expect(merged[0].updatedBy).toBe("B");
  });

  it("never lets a later writer reassign createdBy", () => {
    const local = [sticky("o1", 1, { createdBy: "A", updatedBy: "A" })];
    // C edits to v2 and (maliciously or not) claims createdBy: "C".
    const merged = applyPatch(
      local,
      patch({ upserted: [sticky("o1", 2, { createdBy: "C" })], by: "C" })
    );
    expect(merged[0].createdBy).toBe("A"); // original creator preserved
    expect(merged[0].updatedBy).toBe("C");
  });
});

describe("applyPatch — removal authority (resurrect fix)", () => {
  it("honors the creator's delete even after a different peer last edited it", () => {
    // A creates o1 → receiver records createdBy=A, updatedBy=A.
    let local = applyPatch([], patch({ upserted: [sticky("o1", 1)], by: "A" }));
    expect(local[0].createdBy).toBe("A");

    // C edits o1 (carrying the createdBy=A it learned) → updatedBy becomes C.
    local = applyPatch(local, patch({ upserted: [sticky("o1", 2, { createdBy: "A" })], by: "C" }));
    expect(local[0].updatedBy).toBe("C");
    expect(local[0].createdBy).toBe("A");

    // A deletes o1. Creator match on createdBy → removed (previously dropped).
    local = applyPatch(local, patch({ removed: ["o1"], by: "A" }));
    expect(local.find((o) => o.id === "o1")).toBeUndefined();
  });

  it("still rejects a removal from a peer who is neither creator nor last writer", () => {
    const local = [sticky("o1", 1, { createdBy: "A", updatedBy: "A" })];
    const merged = applyPatch(local, patch({ removed: ["o1"], by: "H" }));
    // The hostile peer H owns nothing here → object survives.
    expect(merged.find((o) => o.id === "o1")).toBeDefined();
  });

  it("honors the last writer's delete (updatedBy match)", () => {
    const local = [sticky("o1", 1, { createdBy: "A", updatedBy: "B" })];
    const merged = applyPatch(local, patch({ removed: ["o1"], by: "B" }));
    expect(merged.find((o) => o.id === "o1")).toBeUndefined();
  });
});
