/**
 * buildEpicFromSource: the epic the "epic" hand-off route puts on the Epic
 * Roadmap: next quarter, at add_epic's caps, in the first colour no epic uses
 * yet, keeping where it came from, and never with a horizon.
 */

import { describe, expect, it } from "vitest";
import {
  EPIC_DESCRIPTION_MAX,
  EPIC_OWNER_MAX,
  EPIC_ROADMAP_ID,
  EPIC_TITLE_MAX,
  buildEpicFromSource,
} from "@/lib/roadmap/epic-source";
import { EPIC_COLORS, nextColor } from "@/lib/roadmap/palette";
import type { HandoffSource } from "@/lib/handoffs/types";

const src = (over: Partial<HandoffSource> = {}): HandoffSource => ({
  title: "  Refund button on a payment ",
  description: " Shops refund without calling. ",
  owner: " Ana ",
  sourceRef: { tool: "impact-map", id: "d1", doc: "strategyMap_1" },
  ...over,
});

describe("buildEpicFromSource", () => {
  it("is the roadmap's one document id", () => {
    expect(EPIC_ROADMAP_ID).toBe("epicRoadmap:current");
  });

  it("puts the epic in the quarter after now's, at no progress, keeping its source", () => {
    const epic = buildEpicFromSource(src(), [], "e1", new Date("2026-11-22T12:00:00Z"));
    expect(epic).toEqual({
      id: "e1",
      title: "Refund button on a payment",
      description: "Shops refund without calling.",
      startQuarter: "2027 Q1",
      endQuarter: "2027 Q1",
      progress: 0,
      owner: "Ana",
      color: nextColor([]),
      sourceRef: { tool: "impact-map", id: "d1", doc: "strategyMap_1" },
    });
    expect(epic).not.toHaveProperty("horizon");
    expect(
      buildEpicFromSource(src(), [], "e2", new Date("2026-05-01T12:00:00Z")).startQuarter
    ).toBe("2026 Q3");
  });

  it("takes the first colour no epic uses yet", () => {
    const used = [{ color: EPIC_COLORS[0].key }];
    expect(buildEpicFromSource(src(), used, "e1").color).toBe(EPIC_COLORS[1].key);
  });

  it("caps the title, description and owner, and leaves blank ones out", () => {
    const epic = buildEpicFromSource(
      src({
        title: "t".repeat(EPIC_TITLE_MAX + 5),
        description: "d".repeat(EPIC_DESCRIPTION_MAX + 5),
        owner: "o".repeat(EPIC_OWNER_MAX + 5),
      }),
      [],
      "e1"
    );
    expect(epic.title).toHaveLength(EPIC_TITLE_MAX);
    expect(epic.description).toHaveLength(EPIC_DESCRIPTION_MAX);
    expect(epic.owner).toHaveLength(EPIC_OWNER_MAX);
    const bare = buildEpicFromSource(src({ description: " ", owner: undefined }), [], "e2");
    expect(bare).not.toHaveProperty("description");
    expect(bare).not.toHaveProperty("owner");
  });

  it("mints a fresh id when none is given", () => {
    expect(buildEpicFromSource(src(), []).id).not.toBe(buildEpicFromSource(src(), []).id);
  });
});
