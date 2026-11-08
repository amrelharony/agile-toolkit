import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A received kudos pays and plays once. A guest room used to emit the
 * `kudos.received` signal (which the receive bridge fans out) AND call
 * `emit("kudos","received")` itself, so the guest was paid twice.
 */

const h = vi.hoisted(() => ({
  emitted: [] as string[],
  outcomes: [] as { id: string; key?: string }[],
  moods: 0,
}));

vi.mock("@/lib/sonification/emit", () => ({
  emit: (tool: string, event: string) => h.emitted.push(`${tool}:${event}`),
}));
vi.mock("@/lib/emotion/engine", () => ({ pushMoodSignal: () => h.moods++ }));
vi.mock("@/lib/gamification/ledger", () => ({
  withProfile: (fn: () => void) => fn(),
  recordOutcome: (id: string, opts?: { key?: string }) => {
    h.outcomes.push({ id, key: opts?.key });
    return { awarded: true, xp: 10, reason: "awarded" };
  },
}));

import {
  installKudosReceiveBridge,
  onKudosReceived,
  uninstallKudosReceiveBridge,
} from "@/lib/kudos/receive-bridge";
import { __resetSignalBus, emitSignal } from "@/lib/signals/signal-bus";

const flush = () => new Promise((r) => setTimeout(r, 60));

function received(id: string) {
  emitSignal({
    kind: "kudos.received",
    toolId: "kudos",
    at: new Date().toISOString(),
    payload: { id },
  });
}

beforeEach(() => {
  h.emitted = [];
  h.outcomes = [];
  h.moods = 0;
  __resetSignalBus();
});

afterEach(() => {
  uninstallKudosReceiveBridge();
});

describe("receiving kudos", () => {
  it("pays kudos-received once per kudos id through the bridge", async () => {
    installKudosReceiveBridge();
    received("k1");
    received("k1");
    await flush();
    expect(h.outcomes).toEqual([{ id: "kudos-received", key: "kudos-in:k1" }]);
    expect(h.emitted).toEqual(["kudos:received"]);
    expect(h.moods).toBe(1);
  });

  it("pays a guest room's receive once when both the signal and the direct call run", async () => {
    installKudosReceiveBridge();
    // What use-kudos-room does for an ephemeral (guest) room.
    received("k2");
    expect(onKudosReceived("k2")).toBe(true);
    await flush();
    expect(h.outcomes).toEqual([{ id: "kudos-received", key: "kudos-in:k2" }]);
    expect(h.emitted).toEqual(["kudos:received"]);
  });

  it("still pays on a bare /guest route, where the bridge isn't installed", async () => {
    received("k3");
    onKudosReceived("k3");
    await flush();
    expect(h.outcomes).toEqual([{ id: "kudos-received", key: "kudos-in:k3" }]);
  });

  it("plays but pays nothing for a receive with no kudos id", () => {
    onKudosReceived(undefined);
    expect(h.emitted).toEqual(["kudos:received"]);
    expect(h.outcomes).toEqual([]);
  });

  it("leaves the guest room with no receive emit of its own", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(tools)/kudos/use-kudos-room.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/\bemit\(\s*"kudos"\s*,\s*"received"\s*\)/);
    expect(src).toMatch(/onKudosReceived\(env\.kudos\.id\)/);
  });
});
