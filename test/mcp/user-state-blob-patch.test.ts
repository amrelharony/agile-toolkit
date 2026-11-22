/**
 * serverPatchUserStateBlob: Amr's MCP write verbs for a tool that keeps a
 * createPersistedStore blob in user_state. The same compare-and-set as the
 * workspace scalars (scalar-blob-cas.test.ts), behind an allow list of
 * store keys, with a size cap and a pure `mutate` that re-runs on a lost race.
 *
 * The Supabase client is stubbed with the chainable builder from
 * scalar-blob-cas.test.ts, driven by an ordered response queue, so races are
 * deterministic. It also records every `from()` and `eq()` call, and each
 * statement (a `from()` chain) with its own filters, so a test can pin which
 * row the read and the CAS update aim at.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Statement = { op: "select" | "update" | "insert" | null; filters: Array<[string, unknown]> };

const responses: Array<{ data?: unknown; error?: unknown }> = [];
const updateCalls: Array<Record<string, unknown>> = [];
const insertCalls: Array<Record<string, unknown>> = [];
const eqCalls: Array<[string, unknown]> = [];
const fromCalls: string[] = [];
const statements: Statement[] = [];

vi.mock("@supabase/supabase-js", () => {
  const next = () => Promise.resolve(responses.shift() ?? { data: null, error: null });
  const current = () => statements[statements.length - 1];
  // One shared chainable, thenable builder. Chain methods return `this`;
  // terminals (`maybeSingle`, `insert`, and awaiting the update's `.select()`)
  // each consume the next queued response. A statement's op is its first
  // verb, so the update's trailing `.select("store_key")` stays an update.
  const builder: Record<string, unknown> = {
    from: (table: string) => {
      fromCalls.push(table);
      statements.push({ op: null, filters: [] });
      return builder;
    },
    select: () => {
      const s = current();
      if (s && s.op === null) s.op = "select";
      return builder;
    },
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      current()?.filters.push([col, val]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    gt: () => builder,
    is: () => builder,
    update: (payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      const s = current();
      if (s && s.op === null) s.op = "update";
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push(payload);
      const s = current();
      if (s && s.op === null) s.op = "insert";
      return next();
    },
    maybeSingle: () => next(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve(responses.shift() ?? { data: null, error: null }),
  };
  return { createClient: () => builder };
});

import {
  SERVER_WRITABLE_BLOB_KEYS,
  USER_STATE_BLOB_MAX_BYTES,
  WORKSPACE_SCALARS_STORE_KEY,
  serverPatchUserStateBlob,
  serverPatchWorkspaceBlob,
} from "@/lib/actions/server-store";
import {
  CARD_DECKS_INITIAL,
  CARD_DECKS_STORE_KEY,
  normalizeCardDecks,
} from "@/lib/card-decks/model";
import { DOD_LEGACY_KEY, DOD_MOVED_KEY } from "@/lib/dod/model";
import { ADKAR_MOVED_KEY } from "@/lib/adkar/model";
import { jsonBytes } from "@/lib/utils/json-bytes";

const KEY = "agile-toolkit:card-decks";
const RS_KEY = "agile-toolkit:relative-sizing";

type Blob = { items: string[]; note: string };
const asBlob = (raw: unknown): Blob => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Blob>;
  return {
    items: Array.isArray(r.items) ? r.items.filter((x) => typeof x === "string") : [],
    note: typeof r.note === "string" ? r.note : "",
  };
};
/** A typical verb: normalise, apply, return the whole blob. */
const addItem = (item: string) => (raw: unknown) => {
  const cur = asBlob(raw);
  return { ...cur, items: [...cur.items, item] };
};

const row = (payload: unknown, updatedAt: string) => ({
  data: { payload, updated_at: updatedAt },
});
const CAS_HIT = { data: [{ store_key: KEY }] };
const CAS_MISS = { data: [] };

/** The read of one user's row of one store, and the CAS update of that same row. */
const readOf = (storeKey: string): Statement => ({
  op: "select",
  filters: [
    ["user_id", "u1"],
    ["store_key", storeKey],
  ],
});
const casOf = (storeKey: string, token: string): Statement => ({
  op: "update",
  filters: [
    ["user_id", "u1"],
    ["store_key", storeKey],
    ["updated_at", token],
  ],
});

beforeEach(() => {
  responses.length = 0;
  updateCalls.length = 0;
  insertCalls.length = 0;
  eqCalls.length = 0;
  fromCalls.length = 0;
  statements.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

describe("serverPatchUserStateBlob: the compare-and-set loop", () => {
  it("inserts the whole blob on first touch, handing mutate null", async () => {
    responses.push({ data: null }); // read → no row
    responses.push({ error: null }); // insert ok
    const mutate = vi.fn(addItem("a"));

    const result = await serverPatchUserStateBlob("u1", KEY, mutate);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(null);
    expect(result).toEqual({ written: true, payload: { items: ["a"], note: "" } });
    expect(insertCalls).toEqual([
      {
        user_id: "u1",
        store_key: KEY,
        payload: { items: ["a"], note: "" },
        client_id: "server-mcp",
      },
    ]);
    expect(updateCalls).toHaveLength(0);
    expect(fromCalls.every((t) => t === "user_state")).toBe(true);
    expect(eqCalls).toContainEqual(["user_id", "u1"]);
    expect(eqCalls).toContainEqual(["store_key", KEY]);
  });

  it("takes the update path when a concurrent insert wins the first touch (23505)", async () => {
    responses.push({ data: null }); // read1 → no row
    responses.push({ error: { code: "23505" } }); // insert → unique violation
    responses.push(row({ items: ["theirs"], note: "n" }, "t2")); // read2 → the winner's row
    responses.push(CAS_HIT); // update → success
    const mutate = vi.fn(addItem("mine"));

    const result = await serverPatchUserStateBlob("u1", KEY, mutate);

    expect(mutate.mock.calls.map((c) => c[0])).toEqual([null, { items: ["theirs"], note: "n" }]);
    expect(insertCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ items: ["theirs", "mine"], note: "n" });
    expect(eqCalls).toContainEqual(["updated_at", "t2"]);
    expect(statements).toEqual([
      readOf(KEY),
      { op: "insert", filters: [] },
      readOf(KEY),
      casOf(KEY, "t2"),
    ]);
    expect(result).toEqual({ written: true, payload: { items: ["theirs", "mine"], note: "n" } });
  });

  it("re-runs mutate on the fresh payload after a lost CAS, so no one's write is lost", async () => {
    responses.push(row({ items: ["a"], note: "" }, "t1")); // read1
    responses.push(CAS_MISS); // update1 → another writer advanced updated_at
    responses.push(row({ items: ["a", "b"], note: "theirs" }, "t2")); // read2: the winner's blob
    responses.push(CAS_HIT); // update2 → success
    const mutate = vi.fn(addItem("c"));

    const result = await serverPatchUserStateBlob("u1", KEY, mutate);

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][0]).toEqual({ items: ["a", "b"], note: "theirs" });
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].payload).toEqual({ items: ["a", "c"], note: "" });
    expect(updateCalls[1].payload).toEqual({ items: ["a", "b", "c"], note: "theirs" });
    // Each CAS filters on the token it read.
    expect(eqCalls.filter(([col]) => col === "updated_at")).toEqual([
      ["updated_at", "t1"],
      ["updated_at", "t2"],
    ]);
    // Both reads and both CAS updates aim at this user's row of this store,
    // never at the workspace scalars row or at every user's row with the key.
    expect(statements).toEqual([readOf(KEY), casOf(KEY, "t1"), readOf(KEY), casOf(KEY, "t2")]);
    // The answer is the payload that was really written: the last run's.
    expect(result).toEqual({ written: true, payload: { items: ["a", "b", "c"], note: "theirs" } });
  });

  it("writes nothing when mutate returns null, with or without a row", async () => {
    responses.push(row({ items: ["a"], note: "" }, "t1"));
    await expect(serverPatchUserStateBlob("u1", KEY, () => null)).resolves.toEqual({
      written: false,
      reason: "unchanged",
    });
    responses.push({ data: null });
    await expect(serverPatchUserStateBlob("u1", KEY, () => null)).resolves.toEqual({
      written: false,
      reason: "unchanged",
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("stamps client_id server-mcp on inserts and updates, so open tabs apply the row", async () => {
    responses.push({ data: null }, { error: null });
    await serverPatchUserStateBlob("u1", KEY, addItem("a"));
    responses.push(row({ items: [], note: "" }, "t1"), CAS_HIT);
    await serverPatchUserStateBlob("u1", RS_KEY, addItem("b"));
    expect(insertCalls[0].client_id).toBe("server-mcp");
    expect(updateCalls[0].client_id).toBe("server-mcp");
    expect(eqCalls).toContainEqual(["store_key", RS_KEY]);
    // The second allowed key is pinned on the update path too, not only the read.
    expect(statements).toEqual([
      readOf(KEY),
      { op: "insert", filters: [] },
      readOf(RS_KEY),
      casOf(RS_KEY, "t1"),
    ]);
    expect(insertCalls[0].store_key).toBe(KEY);
  });

  it("throws when it doesn't converge, after maxAttempts lost races (5 by default)", async () => {
    for (let i = 0; i < 5; i++) responses.push(row({ items: [], note: "" }, `t${i}`), CAS_MISS);
    await expect(serverPatchUserStateBlob("u1", KEY, addItem("a"))).rejects.toThrow(
      /did not converge after 5 attempts/
    );
    expect(updateCalls).toHaveLength(5);

    updateCalls.length = 0;
    responses.length = 0;
    for (let i = 0; i < 2; i++) responses.push(row({ items: [], note: "" }, `t${i}`), CAS_MISS);
    await expect(
      serverPatchUserStateBlob("u1", KEY, addItem("a"), { maxAttempts: 2 })
    ).rejects.toThrow(`[server-store] blob patch for ${KEY} did not converge after 2 attempts`);
    expect(updateCalls).toHaveLength(2);
  });

  it("passes database errors on: the read, an insert other than 23505, the update", async () => {
    responses.push({ error: { code: "XX000", message: "read failed" } });
    await expect(serverPatchUserStateBlob("u1", KEY, addItem("a"))).rejects.toMatchObject({
      message: "read failed",
    });

    responses.push({ data: null }, { error: { code: "23514", message: "check failed" } });
    await expect(serverPatchUserStateBlob("u1", KEY, addItem("a"))).rejects.toMatchObject({
      code: "23514",
    });

    responses.push(row({ items: [], note: "" }, "t1"), { error: { message: "update failed" } });
    await expect(serverPatchUserStateBlob("u1", KEY, addItem("a"))).rejects.toMatchObject({
      message: "update failed",
    });
  });
});

describe("serverPatchUserStateBlob: the size cap", () => {
  it("refuses an oversized blob with too_large and writes nothing", async () => {
    responses.push(row({ items: [], note: "" }, "t1"));
    const big = { items: [], note: "x".repeat(USER_STATE_BLOB_MAX_BYTES) };
    await expect(serverPatchUserStateBlob("u1", KEY, () => big)).resolves.toEqual({
      written: false,
      reason: "too_large",
    });
    responses.push({ data: null });
    await expect(serverPatchUserStateBlob("u1", KEY, () => big)).resolves.toEqual({
      written: false,
      reason: "too_large",
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("is half the database's 1 MB payload cap, measured in UTF-8 bytes of the JSON", async () => {
    expect(USER_STATE_BLOB_MAX_BYTES).toBe(512 * 1024);
    // 3-byte text: the limit counts bytes, not characters. {"t":"…"} is 8 bytes.
    const at = { t: "漢".repeat(4) }; // 8 + 12 = 20
    const over = { t: "漢".repeat(5) }; // 8 + 15 = 23
    expect(jsonBytes(at)).toBe(20);
    responses.push({ data: null }, { error: null });
    await expect(serverPatchUserStateBlob("u1", KEY, () => at, { maxBytes: 20 })).resolves.toEqual({
      written: true,
      payload: at,
    });
    responses.push({ data: null });
    await expect(
      serverPatchUserStateBlob("u1", KEY, () => over, { maxBytes: 20 })
    ).resolves.toEqual({ written: false, reason: "too_large" });
    expect(insertCalls).toHaveLength(1);
  });

  // The browser saves up to the database's 1 MB cap, so a Card Decks row at
  // its own caps (40 decks x 80 cards) can already be past ours. A verb that
  // doesn't grow such a row must save over MCP, as it does on the page.
  const KB = 1024;
  const blobOf = (noteBytes: number) => ({ items: [] as string[], note: "x".repeat(noteBytes) });

  it("writes a blob that shrinks a row the page already saved past the cap", async () => {
    const saved = blobOf(600 * KB);
    const shuffled = blobOf(590 * KB);
    expect(jsonBytes(saved)).toBeGreaterThan(USER_STATE_BLOB_MAX_BYTES);
    expect(jsonBytes(shuffled)).toBeGreaterThan(USER_STATE_BLOB_MAX_BYTES);
    responses.push(row(saved, "t1"), CAS_HIT);

    const result = await serverPatchUserStateBlob("u1", KEY, () => shuffled);

    expect(result).toEqual({ written: true, payload: shuffled });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual(shuffled);
    expect(statements).toEqual([readOf(KEY), casOf(KEY, "t1")]);
  });

  it("writes a blob the same size as the oversized row it replaces", async () => {
    const saved = blobOf(600 * KB);
    const same = { items: [] as string[], note: "y".repeat(600 * KB) };
    expect(jsonBytes(same)).toBe(jsonBytes(saved));
    responses.push(row(saved, "t1"), CAS_HIT);
    await expect(serverPatchUserStateBlob("u1", KEY, () => same)).resolves.toEqual({
      written: true,
      payload: same,
    });
    expect(updateCalls).toHaveLength(1);
  });

  it("still refuses a write that grows a row past the cap, even by a few bytes", async () => {
    const saved = blobOf(600 * KB);
    responses.push(row(saved, "t1"));
    await expect(
      serverPatchUserStateBlob("u1", KEY, (raw) => ({ ...asBlob(raw), items: ["a dealt card"] }))
    ).resolves.toEqual({ written: false, reason: "too_large" });
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("measures the row it read on every attempt, not only the first", async () => {
    const big = blobOf(590 * KB);
    responses.push(row(blobOf(600 * KB), "t1"), CAS_MISS); // shrinks the first row, loses the race
    responses.push(row(blobOf(10), "t2")); // the winner shrank it: the same blob now grows it
    const mutate = vi.fn(() => big);

    await expect(serverPatchUserStateBlob("u1", KEY, mutate)).resolves.toEqual({
      written: false,
      reason: "too_large",
    });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(updateCalls).toHaveLength(1);
  });
});

describe("serverPatchUserStateBlob: the allow list", () => {
  const OFF_LIST = [
    "agile-toolkit:workspace",
    WORKSPACE_SCALARS_STORE_KEY,
    "agile-toolkit:history",
    "agile-toolkit:llm",
    DOD_LEGACY_KEY,
    DOD_MOVED_KEY,
    ADKAR_MOVED_KEY,
    "agile-toolkit:picker",
    "agile-toolkit:card-decks:moved",
    "",
  ];

  it.each(OFF_LIST)("throws for %j before any database call", async (key) => {
    const mutate = vi.fn(addItem("a"));
    await expect(serverPatchUserStateBlob("u1", key, mutate)).rejects.toThrow(
      /not a server-writable tool store/
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("holds only agile-toolkit:<name> tool keys, never a core store or a moved store", () => {
    expect(SERVER_WRITABLE_BLOB_KEYS.length).toBeGreaterThan(0);
    expect(new Set(SERVER_WRITABLE_BLOB_KEYS).size).toBe(SERVER_WRITABLE_BLOB_KEYS.length);
    for (const key of SERVER_WRITABLE_BLOB_KEYS) {
      expect(key).toMatch(/^agile-toolkit:[a-z0-9][a-z0-9-]*$/);
      expect(key.endsWith(":moved")).toBe(false);
      // user_state's own check on store_key (0005_user_state.sql).
      expect(key).toMatch(/^[a-z0-9:_-]+$/);
      expect(key.length).toBeLessThanOrEqual(128);
    }
    for (const key of [
      "agile-toolkit:workspace",
      "agile-toolkit:workspace:scalars",
      WORKSPACE_SCALARS_STORE_KEY,
      "agile-toolkit:history",
      "agile-toolkit:llm",
      DOD_LEGACY_KEY,
    ]) {
      expect(SERVER_WRITABLE_BLOB_KEYS).not.toContain(key);
    }
  });

  it("lists Card Decks under the key its store syncs to, and Relative Sizing", () => {
    expect(CARD_DECKS_STORE_KEY).toBe(KEY);
    expect(SERVER_WRITABLE_BLOB_KEYS).toContain(CARD_DECKS_STORE_KEY);
    expect(SERVER_WRITABLE_BLOB_KEYS).toContain(RS_KEY);
  });

  it("leaves the workspace scalars writer off the list, as before", async () => {
    responses.push({ data: null }, { error: null });
    await serverPatchWorkspaceBlob("u1", { teamName: "Falcons" });
    expect(insertCalls[0]).toMatchObject({
      store_key: WORKSPACE_SCALARS_STORE_KEY,
      payload: { teamName: "Falcons" },
    });
  });

  it("keeps the workspace scalars' read and CAS update on the scalars row, after a lost race", async () => {
    responses.push(row({ teamName: "Falcons" }, "t1"), CAS_MISS);
    responses.push(row({ teamName: "Falcons", maturityLevel: 2 }, "t2"), CAS_HIT);
    await serverPatchWorkspaceBlob("u1", { teamName: "Hawks" });
    expect(statements).toEqual([
      readOf(WORKSPACE_SCALARS_STORE_KEY),
      casOf(WORKSPACE_SCALARS_STORE_KEY, "t1"),
      readOf(WORKSPACE_SCALARS_STORE_KEY),
      casOf(WORKSPACE_SCALARS_STORE_KEY, "t2"),
    ]);
    expect(updateCalls[1].payload).toEqual({ teamName: "Hawks", maturityLevel: 2 });
  });
});

describe("serverPatchUserStateBlob: the mutate contract", () => {
  it("takes a store's own normaliser, whose state type is an interface", async () => {
    responses.push({ data: null }, { error: null });
    // CardDecksState is an interface: this call must type-check as P2.0c writes it.
    const result = await serverPatchUserStateBlob("u1", CARD_DECKS_STORE_KEY, (raw) => {
      const state = normalizeCardDecks(raw);
      return normalizeCardDecks({ ...state, starredOnly: true });
    });
    expect(result.written).toBe(true);
    if (result.written) {
      expect(result.payload.starredOnly).toBe(true);
      // The whole blob: every key of the store's initial state.
      expect(Object.keys(result.payload).sort()).toEqual(Object.keys(CARD_DECKS_INITIAL).sort());
    }
    expect(insertCalls[0].payload).toEqual({ ...CARD_DECKS_INITIAL, starredOnly: true });
  });

  it("refuses a mutate that returns an array instead of the whole blob", async () => {
    responses.push(row({ items: [], note: "" }, "t1"));
    await expect(serverPatchUserStateBlob("u1", KEY, () => ["not", "a", "blob"])).rejects.toThrow(
      /whole blob as an object/
    );
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });
});
