// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_MAX_CHARS,
  SnapshotError,
  decodeSnapshot,
  encodeSnapshot,
} from "@/lib/share/snapshot";

type Board = { cards: string[] };
const isBoard = (d: unknown): d is Board =>
  !!d && typeof d === "object" && Array.isArray((d as Board).cards);

describe("snapshot links", () => {
  it("round-trips a tool's state through a URL-safe fragment", async () => {
    const payload = await encodeSnapshot({
      tool: "retro",
      schema: 1,
      title: "Sprint 42",
      data: { cards: ["Pair on tricky stories", "Late standups", "Ünïcödé ✓"] },
    });
    expect(payload).toMatch(/^s1\.[A-Za-z0-9_-]+$/);
    const decoded = await decodeSnapshot<Board>(`#${payload}`, isBoard);
    expect(decoded.tool).toBe("retro");
    expect(decoded.title).toBe("Sprint 42");
    expect(decoded.data.cards).toContain("Ünïcödé ✓");
  });

  it("compresses repetitive boards well below the warning size", async () => {
    const cards = Array.from({ length: 200 }, (_, i) => `Card ${i} about standups`);
    const payload = await encodeSnapshot({ tool: "retro", schema: 1, data: { cards } });
    expect(payload.length).toBeLessThan(4000);
  });

  it("rejects tampered, foreign and invalid payloads", async () => {
    await expect(decodeSnapshot("#x1.abc", isBoard)).rejects.toBeInstanceOf(SnapshotError);
    await expect(decodeSnapshot("#s1.!!!", isBoard)).rejects.toBeInstanceOf(SnapshotError);
    await expect(decodeSnapshot("#s1.AAAA", isBoard)).rejects.toBeInstanceOf(SnapshotError);
    const wrongShape = await encodeSnapshot({ tool: "retro", schema: 1, data: { nope: 1 } });
    await expect(decodeSnapshot(wrongShape, isBoard)).rejects.toThrow(/valid board/);
  });

  it("refuses links over the size cap", async () => {
    await expect(decodeSnapshot(`s1.${"A".repeat(SNAPSHOT_MAX_CHARS)}`, isBoard)).rejects.toThrow(
      /too long/
    );
  });

  it("stops decompression bombs", async () => {
    // ~2 MB of one character compresses to a few KB.
    const payload = await encodeSnapshot({
      tool: "retro",
      schema: 1,
      data: { cards: ["x".repeat(2 * 1024 * 1024)] },
    });
    await expect(decodeSnapshot(payload, isBoard)).rejects.toThrow(/too large/);
  });

  it("drops prototype-polluting keys", async () => {
    const payload = await encodeSnapshot({
      tool: "retro",
      schema: 1,
      data: JSON.parse('{"cards":[],"__proto__":{"polluted":true}}'),
    });
    await decodeSnapshot(payload, isBoard);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
