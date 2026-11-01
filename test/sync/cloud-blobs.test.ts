/**
 * readCloudBlobs moved to lib/sync/cloud-blobs so a second one-time move
 * (the Definition of Done's) can share it; the feature-flag tracker's
 * cloud-rows module re-exports it, so the flags' move and the tests that
 * mock that module keep working.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => client.current }));

import { readCloudBlobs } from "@/lib/sync/cloud-blobs";
import * as cloudRows from "@/app/(tools)/feature-flag-tracker/cloud-rows";

beforeEach(() => {
  client.current = null;
});

describe("readCloudBlobs", () => {
  it("is what the feature-flag move still imports", () => {
    expect(cloudRows.readCloudBlobs).toBe(readCloudBlobs);
  });

  it("returns null without a client", async () => {
    expect(await readCloudBlobs("u1", ["k"])).toBeNull();
  });

  it("maps the rows found by store key", async () => {
    const calls: unknown[][] = [];
    const builder = {
      select: (...a: unknown[]) => (calls.push(["select", ...a]), builder),
      eq: (...a: unknown[]) => (calls.push(["eq", ...a]), builder),
      in: async (...a: unknown[]) => {
        calls.push(["in", ...a]);
        return { data: [{ store_key: "a", payload: { items: [1] } }], error: null };
      },
    };
    client.current = { from: () => builder };
    const rows = await readCloudBlobs("u1", ["a", "b"]);
    expect(rows).toEqual(new Map([["a", { items: [1] }]]));
    expect(calls).toContainEqual(["eq", "user_id", "u1"]);
    expect(calls).toContainEqual(["in", "store_key", ["a", "b"]]);
  });

  it("returns null on an error", async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: async () => ({ data: null, error: { message: "nope" } }),
    };
    client.current = { from: () => builder };
    expect(await readCloudBlobs("u1", ["a"])).toBeNull();
  });
});
