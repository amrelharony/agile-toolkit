import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { runKudosBackfillIfNeeded, __resetKudosBackfill } from "@/lib/kudos/backfill";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";

const LATCH_KEY = "agile-toolkit:kudos:backfilled";

function freshKudos(overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: `kud_${Math.random().toString(36).slice(2, 14)}`,
    theme: "thank-you",
    toName: "Alice",
    fromName: "Bob",
    message: "great review",
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

const latched = () => window.sessionStorage.getItem(LATCH_KEY) === "1";

describe("kudos/backfill — session latch", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // workspace-store lazy-imports the sync registry when it loads. These
    // tests finish in a few ms, so wait for that import here rather than
    // have it land after the environment is torn down.
    await import("@/lib/sync/register");
  });

  beforeEach(() => {
    __resetKudosBackfill();
    useWorkspaceStore.setState({ kudos: [] });
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    __resetKudosBackfill();
    useWorkspaceStore.setState({ kudos: [] });
    vi.unstubAllGlobals();
  });

  it("latches an empty batch without any request", async () => {
    await runKudosBackfillIfNeeded();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(latched()).toBe(true);
  });

  it("treats guest-authored rows as nothing to send and latches", async () => {
    useWorkspaceStore.setState({ kudos: [freshKudos({ fromProfileId: "guest-1" })] });
    await runKudosBackfillIfNeeded();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(latched()).toBe(true);
  });

  it("latches after a successful run and then skips further runs", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    useWorkspaceStore.setState({ kudos: [freshKudos(), freshKudos()] });

    await runKudosBackfillIfNeeded();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/kudos");
    expect(latched()).toBe(true);

    await runKudosBackfillIfNeeded();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("latches when at least one post succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValue({ ok: false, status: 500 });
    useWorkspaceStore.setState({ kudos: [freshKudos(), freshKudos(), freshKudos()] });

    await runKudosBackfillIfNeeded();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(latched()).toBe(true);
  });

  it.each([
    ["every post is rejected", () => ({ ok: false, status: 401 })],
    [
      "the network is down",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("does not latch when %s, so the next run retries", async (_label, respond) => {
    fetchSpy.mockImplementation(async () => respond());
    useWorkspaceStore.setState({ kudos: [freshKudos(), freshKudos()] });

    await runKudosBackfillIfNeeded();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(latched()).toBe(false);

    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    await runKudosBackfillIfNeeded();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(latched()).toBe(true);
  });
});
