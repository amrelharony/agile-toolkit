/**
 * tool.kudos.* coverage (synced collection — registered for cross-device sync).
 *
 * kudos persists in the workspace store (id-keyed) + fans out over realtime.
 * Registering it as a synced collection lets the agent read the wall, post a
 * kudo (validated through the canonical parseKudos), and analyse recognition.
 *
 *   1. registration — list_state/recognition_stats read; post_kudos/remove_kudos write.
 *   2. post_kudos + list_state — append + round-trip.
 *   3. post_kudos writes only the printed cards: an episode's card on its
 *      habit, an open card (with the episode it reminds of), or Thank you!;
 *      the original theme ids and any other theme are refused.
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

type Posted = { posted: boolean; id?: string; error?: string; message?: string };

const post = async (params: Record<string, unknown>) =>
  (await registry.get("tool.kudos.post_kudos")!.handler(params, ctx())) as Posted;

const stored = () => useWorkspaceStore.getState().kudos ?? [];

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

  it("describes the printed cards, not a Recognition chart", () => {
    const postText = registry.get("tool.kudos.post_kudos")!.description;
    for (const word of ["episode_required", "theme_episode_mismatch", "invalid_theme"]) {
      expect(postText).toContain(word);
    }
    expect(postText).not.toContain("still accepted");
    expect(registry.get("tool.kudos.recognition_stats")!.description).not.toMatch(
      /Recognition chart/
    );
  });
});

describe("tool.kudos lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ kudos: [] }));

  it("posts a kudo and reads it back", async () => {
    const p = await post({
      toName: "Alice",
      fromName: "Bob",
      message: "Saved the release with a clutch hotfix",
      theme: "open-teamwork",
    });
    expect(p.posted).toBe(true);

    const r = (await registry.get("tool.kudos.list_state")!.handler({}, ctx())) as {
      total: number;
      kudos: { id: string; toName: string; fromName: string; message: string; theme: string }[];
    };
    expect(r.total).toBe(1);
    expect(r.kudos[0]).toMatchObject({ toName: "Alice", fromName: "Bob", theme: "open-teamwork" });
  });

  it("rejects an invalid theme via parseKudos", async () => {
    const p = await post({ toName: "Alice", message: "nice", theme: "not-a-real-theme" });
    expect(p.posted).toBe(false);
    expect(p.error).toBe("invalid_theme");
  });

  it.each(["awesome", "thank-you", "great-job", "well-done"])(
    "refuses the original theme %s for a new kudos",
    async (theme) => {
      expect(await post({ toName: "Alice", message: "thanks", theme })).toEqual({
        posted: false,
        error: "invalid_theme",
      });
      expect(stored()).toEqual([]);
    }
  );

  it("recognition_stats tallies recipients and senders", async () => {
    await post({ toName: "Alice", fromName: "Bob", message: "thanks a ton" });
    await post({
      toName: "Alice",
      fromName: "Carol",
      message: "great pairing",
      theme: "open-teamwork",
    });
    await post({ toName: "Bob", fromName: "Alice", message: "clean refactor", episode: 17 });

    const s = (await registry.get("tool.kudos.recognition_stats")!.handler({}, ctx())) as {
      total: number;
      byRecipient: Record<string, number>;
      bySender: Record<string, number>;
      themeCounts: Record<string, number>;
      topRecipients: { name: string; count: number }[];
    };
    expect(s.total).toBe(3);
    expect(s.byRecipient["Alice"]).toBe(2);
    expect(s.byRecipient["Bob"]).toBe(1);
    expect(s.bySender["Bob"]).toBe(1);
    expect(s.topRecipients[0]).toEqual({ name: "Alice", count: 2 });
    expect(s.themeCounts).toEqual({ "open-thank-you": 1, "open-teamwork": 1, ownership: 1 });
  });

  it("starts on the open Thank you! card, or a book episode's own card on its habit", async () => {
    await post({ toName: "Alice", message: "thanks" });
    await post({ toName: "Bob", message: "for seeing it through", episode: 7 });
    await post({ toName: "Cy", message: "for owning it", episode: 7, theme: "ownership" });
    const [plain, card, chosen] = stored();
    expect(plain).toMatchObject({ theme: "open-thank-you" });
    expect(plain).not.toHaveProperty("episode");
    expect(card).toMatchObject({ theme: "ownership", episode: 7 });
    expect(chosen).toMatchObject({ theme: "ownership", episode: 7 });
  });

  it("keeps the episode an open card reminds the sender of", async () => {
    await post({ toName: "Dee", message: "great teamwork", theme: "open-teamwork", episode: 7 });
    await post({ toName: "Eve", message: "thank you", theme: "open-thank-you" });
    const [reminds, plain] = stored();
    expect(reminds).toMatchObject({ theme: "open-teamwork", episode: 7 });
    expect(plain).toMatchObject({ theme: "open-thank-you" });
    expect(plain).not.toHaveProperty("episode");
  });

  it("needs an episode of the habit for a habit's card, and says which", async () => {
    const none = await post({ toName: "Fay", message: "focus", theme: "focus" });
    expect(none).toMatchObject({ posted: false, error: "episode_required" });
    expect(none.message).toBe(
      "A Focus card is a book episode's card: pass an episode of Focus (1, 2, 6, 10, 16, 24 or 25), or use open-thank-you or open-teamwork."
    );

    const other = await post({ toName: "Fay", message: "focus", theme: "focus", episode: 7 });
    expect(other).toMatchObject({ posted: false, error: "theme_episode_mismatch" });
    expect(other.message).toBe(
      "Episode 7 is an Ownership card: leave theme out, or pass theme 'ownership'."
    );
    const ownership = await post({ toName: "Fay", message: "own", theme: "ownership" });
    expect(ownership.message).toMatch(/^An Ownership card is a book episode's card: .*\(5, 7, 8/);
    expect(stored()).toEqual([]);
  });

  it("refuses an episode that isn't one of the book's 26", async () => {
    for (const episode of [0, 27, 1.5]) {
      expect(await post({ toName: "Gus", message: "thanks", episode })).toMatchObject({
        posted: false,
        error: "invalid_episode",
      });
    }
    expect(stored()).toEqual([]);
  });

  it("remove_kudos removes by id and refuses an unknown id", async () => {
    const p = await post({ toName: "Alice", message: "kudos!", theme: "open-thank-you" });
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
