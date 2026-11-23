// @vitest-environment node
/**
 * The PI board's pure model (lib/pi-planning/model): the fields ROAM, the
 * confidence vote and predictability add are cleaned when present and never
 * added when absent; garbage is dropped rather than guessed; unknown fields
 * are kept; and the page's store still re-exports the same model.
 */

import { describe, expect, it } from "vitest";
import {
  BAND_MAX,
  CONFIDENCE_MAX,
  DEFAULT_PI_STATE,
  HISTORY_MAX,
  PI_STORAGE_KEY,
  ROAM_NOTE_MAX,
  ROAM_OWNER_MAX,
  cleanBand,
  localDayOf,
  normalizePiState,
  piTeamNames,
} from "@/lib/pi-planning/model";

const base = {
  teams: [{ id: "t1", name: "Checkout" }],
  items: [{ id: "r1", title: "PCI audit", teamId: "t1", iteration: 0, kind: "risk" }],
  iterations: 3,
  objectives: [
    { id: "o1", teamId: "t1", title: "Guest checkout", committed: true, businessValue: 8 },
  ],
};

const vote = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  at: "2026-11-20T10:00:00.000Z",
  scope: "train",
  scopeName: "Whole train",
  counts: [0, 1, 3, 5, 2],
  ballots: 11,
  source: "live",
  ...over,
});

const record = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  name: "PI 2026.3",
  closedAt: "2026-09-01",
  teams: [{ teamId: "t1", name: "Checkout", plannedBv: 16, actualBv: 15 }],
  ...over,
});

describe("normalizePiState", () => {
  it("keeps the storage key and the default board", () => {
    expect(PI_STORAGE_KEY).toBe("agile-toolkit:pi-planning");
    expect(normalizePiState(undefined)).toEqual(DEFAULT_PI_STATE);
  });

  it("reads an old board back as it was saved: no new field is added", () => {
    const s = normalizePiState(base);
    expect(Object.keys(s).sort()).toEqual(["items", "iterations", "objectives", "teams"]);
    expect(s.items[0]).toEqual(base.items[0]);
    expect(s.objectives?.[0]).toEqual(base.objectives[0]);
  });

  it("keeps unknown fields on the board, items and objectives", () => {
    const s = normalizePiState({
      ...base,
      future: { x: 1 },
      items: [{ ...base.items[0], later: true }],
      objectives: [{ ...base.objectives[0], extra: "kept" }],
    });
    expect((s as unknown as { future: unknown }).future).toEqual({ x: 1 });
    expect((s.items[0] as unknown as { later: boolean }).later).toBe(true);
    expect((s.objectives?.[0] as unknown as { extra: string }).extra).toBe("kept");
  });

  it("cleans a risk's ROAM fields: the status, the owner and note capped, the links checked", () => {
    const s = normalizePiState({
      ...base,
      items: [
        {
          ...base.items[0],
          roam: "owned",
          roamOwner: `  ${"a".repeat(ROAM_OWNER_MAX + 30)}  `,
          roamNote: "n".repeat(ROAM_NOTE_MAX + 5),
          sentTo: [
            { route: "risk", targetId: "risk-1", at: "2026-11-01T00:00:00Z" },
            { route: "risk", targetId: "risk-2", at: "2026-11-02T00:00:00Z" },
            { route: "nowhere", targetId: "x", at: "2026-11-01" },
            "junk",
          ],
        },
        {
          id: "r2",
          title: "x",
          teamId: "t1",
          iteration: 0,
          kind: "risk",
          roam: "ignored",
          roamOwner: "  ",
          sentTo: [],
        },
      ],
    });
    expect(s.items[0].roam).toBe("owned");
    expect(s.items[0].roamOwner).toHaveLength(ROAM_OWNER_MAX);
    expect(s.items[0].roamNote).toHaveLength(ROAM_NOTE_MAX);
    // One link per route, the first kept.
    expect(s.items[0].sentTo).toEqual([
      { route: "risk", targetId: "risk-1", at: "2026-11-01T00:00:00Z" },
    ]);
    expect(s.items[1]).not.toHaveProperty("roam");
    expect(s.items[1]).not.toHaveProperty("roamOwner");
    expect(s.items[1]).not.toHaveProperty("sentTo");
  });

  it("keeps an actual business value on 0–10 and drops anything else", () => {
    const s = normalizePiState({
      ...base,
      objectives: [
        { ...base.objectives[0], actualBusinessValue: 0 },
        { id: "o2", teamId: "t1", title: "b", committed: false, actualBusinessValue: 7.6 },
        { id: "o3", teamId: "t1", title: "c", committed: true, actualBusinessValue: 11 },
        { id: "o4", teamId: "t1", title: "d", committed: true, actualBusinessValue: "5" },
      ],
    });
    expect(s.objectives?.map((o) => o.actualBusinessValue)).toEqual([0, 8, undefined, undefined]);
    expect(s.objectives?.[2]).not.toHaveProperty("actualBusinessValue");
  });

  it("cleans the PI's name and band", () => {
    const s = normalizePiState({
      ...base,
      name: `  ${"P".repeat(100)}  `,
      band: { low: 70, high: 110 },
    });
    expect(s.name).toHaveLength(80);
    expect(s.band).toEqual({ low: 70, high: 110 });
    const bad = normalizePiState({ ...base, name: "   ", band: { low: 90, high: 80 } });
    expect(bad).not.toHaveProperty("name");
    expect(bad).not.toHaveProperty("band");
    expect(cleanBand({ low: 0, high: BAND_MAX })).toEqual({ low: 0, high: BAND_MAX });
    expect(cleanBand({ low: -1, high: 100 })).toBeUndefined();
    expect(cleanBand({ low: 80, high: BAND_MAX + 1 })).toBeUndefined();
    expect(cleanBand("80-100")).toBeUndefined();
  });

  it("keeps readable votes, totals only, the latest 20", () => {
    const s = normalizePiState({
      ...base,
      confidence: [
        vote(),
        vote({ id: "v2", counts: [1, 2, 3] }), // not five points
        vote({ id: "v3", counts: [0, 0, 0, 0, 0] }), // nobody voted
        vote({ id: "v4", counts: [1, -1, 0, 0, 0] }),
        vote({ id: "v5", at: "not a date" }),
        vote({ id: "v6", ballots: 2, source: "weird" }), // fewer ballots than counts
        { id: "v7" },
        null,
      ],
    });
    expect(s.confidence?.map((v) => v.id)).toEqual(["v1", "v6"]);
    expect(s.confidence?.[0]).toEqual(vote());
    expect(s.confidence?.[1]).toMatchObject({ ballots: 11, source: "facilitator" });

    const many = normalizePiState({
      ...base,
      confidence: Array.from({ length: CONFIDENCE_MAX + 5 }, (_, i) => vote({ id: `v${i}` })),
    });
    expect(many.confidence).toHaveLength(CONFIDENCE_MAX);
    expect(many.confidence?.[0].id).toBe("v5");
  });

  it("keeps readable closed PIs, the latest 12", () => {
    const s = normalizePiState({
      ...base,
      history: [
        record(),
        record({ id: "h2", closedAt: "never" }),
        record({
          id: "h3",
          teams: [
            { teamId: "t1", name: "A", plannedBv: 10, actualBv: 8 },
            { teamId: "t2", name: "B", plannedBv: -3, actualBv: 2 },
            { name: "no id", plannedBv: 1, actualBv: 1 },
          ],
        }),
        "junk",
      ],
    });
    expect(s.history?.map((r) => r.id)).toEqual(["h1", "h3"]);
    expect(s.history?.[1].teams).toEqual([{ teamId: "t1", name: "A", plannedBv: 10, actualBv: 8 }]);

    const many = normalizePiState({
      ...base,
      history: Array.from({ length: HISTORY_MAX + 3 }, (_, i) => record({ id: `h${i}` })),
    });
    expect(many.history).toHaveLength(HISTORY_MAX);
    expect(many.history?.[0].id).toBe("h3");
  });

  it("drops a list that isn't one", () => {
    const s = normalizePiState({ ...base, confidence: "lots", history: { a: 1 } });
    expect(s).not.toHaveProperty("confidence");
    expect(s).not.toHaveProperty("history");
  });

  it("survives garbage in every new field", () => {
    expect(() =>
      normalizePiState({
        teams: [null, 3, { id: "t" }],
        items: [{ id: "i", teamId: "t", roam: 5, roamOwner: {}, roamNote: [], sentTo: "x" }],
        objectives: [{ id: "o", teamId: "t", actualBusinessValue: Number.NaN }],
        iterations: 2,
        name: 7,
        band: null,
        confidence: [[], 1, "x"],
        history: [[], { id: 3 }],
      })
    ).not.toThrow();
  });
});

describe("helpers", () => {
  it("reads team names for other tools' pickers", () => {
    expect(
      piTeamNames(
        normalizePiState({
          teams: [
            { id: "a", name: "A" },
            { id: "b", name: " " },
          ],
        })
      )
    ).toEqual(["A"]);
  });

  it("gives the local day of a stored time, a plain day as it is", () => {
    expect(localDayOf("2026-09-01")).toBe("2026-09-01");
    const at = new Date(2026, 10, 23, 23, 30).toISOString();
    expect(localDayOf(at)).toBe("2026-11-23");
    expect(localDayOf("soon")).toBe("soon");
  });

  it("is what the page's store re-exports", async () => {
    // A source check: the store is "use client" and can't load in a node test.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(tools)/pi-planning/store.ts", "utf8");
    expect(src).toMatch(/from "@\/lib\/pi-planning\/model"/);
    expect(src).toMatch(/normalizePiState,\n\s+piTeamNames,/);
    expect(src).not.toMatch(/function normalizePiState/);
  });
});
