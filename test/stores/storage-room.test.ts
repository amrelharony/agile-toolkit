/**
 * Room left in the browser's storage (lib/stores/storage-room.ts): what the
 * site stores now, counted strictly (two bytes a character against 5 MB),
 * and the refusal, with what to do, for an import that would bring it near
 * the quota.
 */

import { describe, expect, it } from "vitest";
import {
  STORAGE_NEAR_SHARE,
  STORAGE_QUOTA_BYTES,
  siteStorageBytes,
  storageRoomProblem,
  storedBytes,
} from "@/lib/stores/storage-room";

/** A Storage over a plain map, as much of one as the counter reads. */
function fakeStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return {
    get length() {
      return keys.length;
    },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  };
}

describe("siteStorageBytes", () => {
  it("counts every key and value as UTF-16", () => {
    expect(storedBytes("abc")).toBe(6);
    expect(siteStorageBytes(fakeStorage({ a: "123", bb: "" }))).toBe((1 + 3 + 2) * 2);
  });

  it("counts the workspace as the store holds it, not its older stored copy", () => {
    const storage = fakeStorage({ "agile-toolkit:workspace": "old", other: "xy" });
    expect(
      siteStorageBytes(storage, { key: "agile-toolkit:workspace", value: "newer state" })
    ).toBe(storedBytes("agile-toolkit:workspace") + storedBytes("newer state") + (5 + 2) * 2);
  });

  it("counts only the workspace when storage can't be read", () => {
    const blocked = {
      get length(): number {
        throw new Error("SecurityError");
      },
      key: () => null,
      getItem: () => null,
    };
    expect(siteStorageBytes(blocked, { key: "w", value: "abcd" })).toBe(10);
    expect(siteStorageBytes(null, { key: "w", value: "abcd" })).toBe(10);
    expect(siteStorageBytes(undefined)).toBe(0);
  });
});

describe("storageRoomProblem", () => {
  const near = STORAGE_QUOTA_BYTES * STORAGE_NEAR_SHARE;

  it("lets an import through up to 90% of the quota", () => {
    expect(storageRoomProblem(0, 1000)).toBeNull();
    expect(storageRoomProblem(near - 100, 100)).toBeNull();
  });

  it("refuses one past it, saying how full storage would be and what to do", () => {
    expect(storageRoomProblem(near, 1, "These stories")).toBe(
      "These stories would fill 90% of this browser's storage, which holds about 5 MB. Past that, work stops being saved, so they can't be imported. Import fewer rows at a time, such as one sprint's issues. Or download a backup from Your data, then delete work you no longer need."
    );
    expect(storageRoomProblem(STORAGE_QUOTA_BYTES * 0.5, STORAGE_QUOTA_BYTES * 0.45)).toMatch(
      /^These items would fill 95% of this browser's storage/
    );
  });

  it("says plainly when it can't fit at all", () => {
    expect(storageRoomProblem(STORAGE_QUOTA_BYTES, 10, "These stories")).toMatch(
      /^These stories need more room than this browser's storage has, about 5 MB in all\. Past that/
    );
  });
});
