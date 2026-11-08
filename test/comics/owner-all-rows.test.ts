// @vitest-environment node
/**
 * allRows, the owner routes' paged read: every page until a short one, a row
 * met on two pages kept once, and nothing at all when a page fails.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireAuthorizedUser: async () => ({}) }));
vi.mock("@/lib/squads/server", () => ({ getSquadAdminClient: () => null }));

import { allRows } from "@/app/api/comics/_owner";

type Row = { id: number };
const rows = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i }));

describe("allRows", () => {
  it("reads page after page until a short one, keeping a row seen twice once", async () => {
    const asked: [number, number][] = [];
    const page = async (from: number, to: number) => {
      asked.push([from, to]);
      // A full first page; then the last row again (a row that moved), plus 9 new.
      return from === 0
        ? { data: rows(0, 1000), error: null }
        : { data: rows(999, 10), error: null };
    };
    const all = await allRows<Row>(page, (r) => String(r.id));
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(all).toHaveLength(1009);
    expect(new Set(all?.map((r) => r.id)).size).toBe(1009);
  });

  it("stops after one page that isn't full", async () => {
    const page = vi.fn(async () => ({ data: rows(0, 3), error: null }));
    expect(await allRows<Row>(page, (r) => String(r.id))).toHaveLength(3);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("is nothing, and says why, when a later page fails", async () => {
    const onError = vi.fn();
    const failure = { code: "57014", message: "statement timeout" };
    const page = async (from: number) =>
      from === 0 ? { data: rows(0, 1000), error: null } : { data: null, error: failure };
    expect(await allRows<Row>(page, (r) => String(r.id), onError)).toBeNull();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
