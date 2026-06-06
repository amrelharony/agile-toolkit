/**
 * Hybrid squad-scope ENFORCEMENT (migration 0024 + server-store + transport).
 *
 * These assert the actual Supabase query SHAPES the server-store helpers emit
 * under an active squad scope, by mocking PostgREST with a builder that records
 * the chain. (The exact SQL still needs a live-DB staging run — the egress
 * sandbox can't reach Supabase — but the filters/stamps are pinned here.)
 *
 *   READ  — scoped reads add `squad_profile_id.is.null OR …in.(scope)`.
 *   WRITE — scoped writes are own-squad only: update/delete carry
 *           `.in("squad_profile_id", scope)`, creates stamp scope[0], and a
 *           unique-violation surfaces as a not-writable error (no row capture).
 *   Owner (empty scope) — no filter, no stamp: byte-identical to pre-0024.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// PostgREST recorder, defined in a hoisted block so the vi.mock factory can
// reference it without tripping the no-out-of-scope-variable rule.
const mock = vi.hoisted(() => {
  type Call = { method: string; args: unknown[] };
  let calls: Call[] = [];
  let results: Array<{ data?: unknown; error?: unknown }> = [];
  const nextResult = () => (results.length ? results.shift()! : { data: null, error: null });
  const makeBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    const chain =
      (m: string) =>
      (...args: unknown[]) => {
        calls.push({ method: m, args });
        return b;
      };
    for (const m of [
      "select",
      "eq",
      "in",
      "or",
      "gt",
      "order",
      "limit",
      "update",
      "insert",
      "upsert",
      "delete",
    ]) {
      b[m] = chain(m);
    }
    b.maybeSingle = () => {
      calls.push({ method: "maybeSingle", args: [] });
      return Promise.resolve(nextResult());
    };
    // Thenable: awaiting the builder (a list page, an update().select(), an
    // insert(), an upsert()) resolves the next queued result.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (res: any, rej: any) => Promise.resolve(nextResult()).then(res, rej);
    return b;
  };
  const fakeClient = {
    from: (t: string) => {
      calls.push({ method: "from", args: [t] });
      return makeBuilder();
    },
  };
  return {
    fakeClient,
    get calls() {
      return calls;
    },
    setResults: (r: Array<{ data?: unknown; error?: unknown }>) => {
      results = [...r];
    },
    reset: () => {
      calls = [];
      results = [];
    },
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => mock.fakeClient }));

import { runWithScope } from "@/lib/actions/scope-context";
import {
  serverGetEntity,
  serverListEntities,
  serverUpsertEntity,
  serverDeleteEntity,
  serverVersionedUpdate,
} from "@/lib/actions/server-store";

const find = (m: string) => mock.calls.find((c) => c.method === m);
const all = (m: string) => mock.calls.filter((c) => c.method === m);

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
});
beforeEach(() => mock.reset());

describe("read visibility", () => {
  it("owner (no scope) applies no squad filter", async () => {
    mock.setResults([{ data: { payload: { id: "x" }, deleted: false }, error: null }]);
    await serverGetEntity("u", "k", "x");
    expect(find("or")).toBeUndefined();
  });

  it("scoped read filters to untagged OR own squad", async () => {
    mock.setResults([{ data: { payload: { id: "x" }, deleted: false }, error: null }]);
    await runWithScope(["A"], () => serverGetEntity("u", "k", "x"));
    const or = find("or");
    expect(or?.args[0]).toBe("squad_profile_id.is.null,squad_profile_id.in.(A)");
  });

  it("scoped list filters to untagged OR own squad (multi-profile union)", async () => {
    mock.setResults([{ data: [], error: null }]); // empty page → loop breaks
    await runWithScope(["A", "B"], () => serverListEntities("u", "k"));
    const or = find("or");
    expect(or?.args[0]).toBe("squad_profile_id.is.null,squad_profile_id.in.(A,B)");
  });
});

describe("write ownership", () => {
  it("owner upsert omits squad_profile_id (preserve/null default), no insert", async () => {
    mock.setResults([{ error: null }]);
    await serverUpsertEntity("u", "k", { id: "x" });
    const up = find("upsert");
    expect(up).toBeDefined();
    expect(up?.args[0]).not.toHaveProperty("squad_profile_id");
    expect(find("insert")).toBeUndefined();
  });

  it("scoped create: update misses → insert stamped with acting squad", async () => {
    mock.setResults([
      { data: [], error: null }, // update affected 0 own-squad rows
      { error: null }, // insert ok
    ]);
    await runWithScope(["A"], () => serverUpsertEntity("u", "k", { id: "x" }));
    expect(find("update")).toBeDefined();
    expect(find("in")?.args).toEqual(["squad_profile_id", ["A"]]);
    const ins = find("insert");
    expect((ins?.args[0] as { squad_profile_id?: string }).squad_profile_id).toBe("A");
  });

  it("scoped update of an existing own-squad row does NOT insert", async () => {
    mock.setResults([{ data: [{ entity_id: "x" }], error: null }]); // update hit
    await runWithScope(["A"], () => serverUpsertEntity("u", "k", { id: "x" }));
    expect(find("update")).toBeDefined();
    expect(find("insert")).toBeUndefined();
  });

  it("scoped create throws not-writable on a unique violation (shared/peer id)", async () => {
    mock.setResults([
      { data: [], error: null }, // update misses
      { error: { code: "23505" } }, // insert collides with a row outside scope
    ]);
    await expect(
      runWithScope(["A"], () => serverUpsertEntity("u", "k", { id: "x" }))
    ).rejects.toThrow(/not writable/i);
  });

  it("scoped delete tombstones own-squad rows via UPDATE+in, never upsert", async () => {
    mock.setResults([{ error: null }]);
    await runWithScope(["A"], () => serverDeleteEntity("u", "k", "x"));
    expect(find("upsert")).toBeUndefined();
    expect(find("update")?.args[0]).toMatchObject({ deleted: true });
    expect(find("in")?.args).toEqual(["squad_profile_id", ["A"]]);
  });

  it("owner delete uses an upsert tombstone (unchanged)", async () => {
    mock.setResults([{ error: null }]);
    await serverDeleteEntity("u", "k", "x");
    expect(find("upsert")).toBeDefined();
    expect(find("update")).toBeUndefined();
  });
});

describe("versioned update", () => {
  it("scoped versioned update reads AND writes only own-squad rows", async () => {
    mock.setResults([
      { data: { payload: { id: "x", version: 1 }, updated_at: "t0" }, error: null }, // read
      { data: [{ entity_id: "x" }], error: null }, // CAS update hit
    ]);
    const res = await runWithScope(["A"], () =>
      serverVersionedUpdate<{ id: string; version?: number; n?: number }>("u", "k", "x", (cur) => ({
        ...cur,
        n: 2,
      }))
    );
    const inFilters = all("in");
    expect(inFilters).toHaveLength(2); // one on the read, one on the CAS update
    inFilters.forEach((f) => expect(f.args).toEqual(["squad_profile_id", ["A"]]));
    expect(res).toMatchObject({ id: "x", version: 2 });
  });

  it("owner versioned update applies no squad filter", async () => {
    mock.setResults([
      { data: { payload: { id: "x", version: 3 }, updated_at: "t1" }, error: null },
      { data: [{ entity_id: "x" }], error: null },
    ]);
    await serverVersionedUpdate("u", "k", "x", (cur) => cur);
    expect(find("in")).toBeUndefined();
  });
});

describe("transport sets the ALS scope for handlers", () => {
  // A probe handler that reports the scope it observes via the server-store ALS.
  const PROBE = "__scopeenf.read_als";

  beforeEach(async () => {
    const { registry } = await import("@/lib/actions/registry");
    const { currentScopeIds } = await import("@/lib/actions/scope-context");
    registry.register({
      id: PROBE,
      toolId: "__scopeenf",
      name: "read_als",
      category: "read",
      description: "Report the squad scope visible to server-store for this call.",
      paramsSchema: z.object({}),
      handler: async () => ({ seen: [...currentScopeIds()] }),
    });
  });

  afterEach(async () => {
    const { registry } = await import("@/lib/actions/registry");
    registry.unregister(PROBE);
  });

  const callProbe = async (squad?: string[]) => {
    const { handleJsonRpc } = await import("@/lib/mcp/transport-http");
    const res = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: PROBE, arguments: {} } },
      "user-x",
      squad
    );
    const text = (res?.result as { content: [{ text: string }] }).content[0].text;
    return JSON.parse(text) as { seen: string[] };
  };

  it("propagates the PAT scope into server-store's ALS", async () => {
    expect((await callProbe(["A", "B"])).seen).toEqual(["A", "B"]);
  });

  it("defaults to an empty (unscoped/owner) scope", async () => {
    expect((await callProbe()).seen).toEqual([]);
  });
});
