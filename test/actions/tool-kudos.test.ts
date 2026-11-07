/**
 * tool.kudos.* coverage (synced collection — registered for cross-device sync).
 *
 * kudos persists in the workspace store (id-keyed) + fans out over realtime.
 * Registering it as a synced collection lets the agent read the wall, post a
 * kudo (validated through the canonical parseKudos), and analyse recognition.
 *
 *   1. registration — list_state/recognition_stats read; post_kudos/remove_kudos write.
 *   2. post_kudos + list_state — append + round-trip.
 *   3. post_kudos rejects an invalid theme (parseKudos defence).
 *   4. recognition_stats — per-recipient / per-sender tallies.
 *   5. remove_kudos refuses an unknown id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/kudos";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const post = (params: Record<string, unknown>) =>
  registry.get("tool.kudos.post_kudos")!.handler(params, ctx());

describe("tool.kudos — registration", () => {
  it("read/write categories + write hardening", () => {
    for (const verb of ["list_state", "recognition_stats"]) {
      expect(registry.get(`tool.kudos.${verb}`)?.category).toBe("read");
    }
    for (const verb of ["post_kudos", "remove_kudos"]) {
      expect(registry.get(`tool.kudos.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.kudos.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.kudos.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.kudos lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ kudos: [] }));

  it("posts a kudo and reads it back", async () => {
    const p = (await post({
      toName: "Alice",
      fromName: "Bob",
      message: "Saved the release with a clutch hotfix",
      theme: "great-job",
    })) as { posted: boolean; id: string };
    expect(p.posted).toBe(true);

    const r = (await registry.get("tool.kudos.list_state")!.handler({}, ctx())) as {
      total: number;
      kudos: { id: string; toName: string; fromName: string; message: string }[];
    };
    expect(r.total).toBe(1);
    expect(r.kudos[0]).toMatchObject({ toName: "Alice", fromName: "Bob" });
  });

  it("rejects an invalid theme via parseKudos", async () => {
    const p = (await post({ toName: "Alice", message: "nice", theme: "not-a-real-theme" })) as {
      posted: boolean;
      error?: string;
    };
    expect(p.posted).toBe(false);
    expect(p.error).toBe("invalid_theme");
  });

  it("recognition_stats tallies recipients and senders", async () => {
    await post({ toName: "Alice", fromName: "Bob", message: "thanks a ton", theme: "thank-you" });
    await post({ toName: "Alice", fromName: "Carol", message: "great pairing", theme: "awesome" });
    await post({ toName: "Bob", fromName: "Alice", message: "clean refactor", theme: "well-done" });

    const s = (await registry.get("tool.kudos.recognition_stats")!.handler({}, ctx())) as {
      total: number;
      byRecipient: Record<string, number>;
      bySender: Record<string, number>;
      topRecipients: { name: string; count: number }[];
    };
    expect(s.total).toBe(3);
    expect(s.byRecipient["Alice"]).toBe(2);
    expect(s.byRecipient["Bob"]).toBe(1);
    expect(s.bySender["Bob"]).toBe(1);
    expect(s.topRecipients[0]).toEqual({ name: "Alice", count: 2 });
  });

  it("post_kudos starts on the open Thank you! card, or a book episode's own card", async () => {
    await post({ toName: "Alice", message: "thanks" });
    await post({ toName: "Bob", message: "for seeing it through", episode: 7 });
    await post({ toName: "Cy", message: "for the focus", episode: 7, theme: "focus" });
    const [plain, card, chosen] = useWorkspaceStore.getState().kudos ?? [];
    expect(plain).toMatchObject({ theme: "open-thank-you" });
    expect(plain).not.toHaveProperty("episode");
    expect(card).toMatchObject({ theme: "ownership", episode: 7 });
    expect(chosen).toMatchObject({ theme: "focus", episode: 7 });
  });

  it("remove_kudos removes by id and refuses an unknown id", async () => {
    const p = (await post({ toName: "Alice", message: "kudos!", theme: "awesome" })) as {
      posted: boolean;
      id: string;
    };
    const ok = (await registry.get("tool.kudos.remove_kudos")!.handler({ id: p.id }, ctx())) as {
      removed: boolean;
    };
    expect(ok.removed).toBe(true);

    const ghost = (await registry
      .get("tool.kudos.remove_kudos")!
      .handler({ id: "nope" }, ctx())) as { removed: boolean };
    expect(ghost.removed).toBe(false);
  });
});
