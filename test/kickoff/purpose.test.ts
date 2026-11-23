// @vitest-environment node
/**
 * The team's purpose on its own (lib/kickoff/purpose): the charter reads it
 * without Kickoff's model, so it must answer exactly what the model's own
 * reading gives (normalizeKickoff, then answerOf), and its module must stay
 * clear of the model, the format catalog and the sectioned kit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answerOf, readKickoffs, teamPurpose as modelTeamPurpose } from "@/lib/kickoff/model";
import { teamPurpose } from "@/lib/kickoff/purpose";
import { SECTION_ITEM_ID_MAX } from "@/lib/sectioned/model";
import { KICKOFF_ITEM_MAX } from "@/lib/stores/workspace-types";
import { exampleId, isExampleId } from "@/lib/utils/example-id";

const AT = "2026-11-20T09:00:00.000Z";
const LATER = "2026-11-21T09:00:00.000Z";
const LATEST = "2026-11-22T09:00:00.000Z";

/** The purpose as the model read it before it moved: every row normalised, then sorted and answered. */
function viaModel(rows: readonly unknown[]): { kickoffId: string; text: string } | null {
  const agreed = readKickoffs(rows)
    .filter((k) => !isExampleId(k.id) && k.format === "team-canvas" && k.status === "agreed")
    .sort((a, b) => (b.agreedAt ?? b.updatedAt).localeCompare(a.agreedAt ?? a.updatedAt));
  for (const k of agreed) {
    const text = answerOf(k, "purpose");
    if (text) return { kickoffId: k.id, text };
  }
  return null;
}

const canvas = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  title: "Squad canvas",
  format: "team-canvas",
  status: "agreed",
  agreedAt: AT,
  createdAt: AT,
  updatedAt: AT,
  sections: { purpose: [{ id: `${id}-p`, text: `Purpose of ${id}` }] },
  ...over,
});

const CASES: { name: string; rows: unknown[] }[] = [
  { name: "no rows", rows: [] },
  { name: "rows that aren't kickoffs", rows: [null, 3, "x", [], {}, { id: "" }, { id: 7 }] },
  {
    name: "the newest agreed canvas, examples and drafts left out",
    rows: [
      canvas("a"),
      canvas("b", { agreedAt: LATER }),
      canvas(exampleId("c"), { agreedAt: LATEST }),
      canvas("d", { agreedAt: LATEST, status: "draft" }),
      canvas("e", { agreedAt: LATEST, status: "bogus" }),
      canvas("f", { agreedAt: LATEST, format: "inception" }),
      canvas("g", { agreedAt: LATEST, format: "nope" }),
    ],
  },
  {
    name: "a missing or unreadable agreedAt falls back to the last change",
    rows: [
      canvas("a", { agreedAt: LATER }),
      canvas("b", { agreedAt: "not a time", updatedAt: LATEST }),
      canvas("c", { agreedAt: undefined, updatedAt: LATER }),
    ],
  },
  {
    name: "ties keep Kickoff's own order: newest change, newest made, then id",
    rows: [
      canvas("b", { updatedAt: LATER }),
      canvas("a", { updatedAt: LATER }),
      canvas("c", { updatedAt: LATER, createdAt: LATER }),
      canvas("d", { updatedAt: AT, createdAt: LATEST }),
      canvas("e", { updatedAt: 5, createdAt: null }),
    ],
  },
  {
    name: "a blank purpose passes to the next canvas",
    rows: [
      canvas("a", { agreedAt: LATER, sections: { purpose: [{ id: "p", text: "   \n " }] } }),
      canvas("b", { agreedAt: LATER, sections: { purpose: [] } }),
      canvas("c", { agreedAt: LATER, sections: {} }),
      canvas("d", { agreedAt: LATER, sections: "x" }),
      canvas("e", { agreedAt: LATER, sections: { purpose: "x" } }),
      canvas("f", {
        agreedAt: LATER,
        sections: { purpose: [{ id: "p", text: "", owner: "Sam" }] },
      }),
      canvas("g"),
    ],
  },
  {
    name: "a single answer keeps its first readable line, even when that one is blank",
    rows: [
      canvas("a", {
        agreedAt: LATER,
        sections: {
          purpose: [
            null,
            { id: "", text: "No id" },
            { id: "x".repeat(SECTION_ITEM_ID_MAX + 1), text: "Id too long" },
            { id: "n", text: 3 },
            { id: "x".repeat(SECTION_ITEM_ID_MAX), text: "  Read\n this   one " },
            { id: "later", text: "Not this one" },
          ],
        },
      }),
      canvas("b", {
        agreedAt: LATEST,
        sections: {
          purpose: [
            { id: "p", text: " " },
            { id: "q", text: "Never read" },
          ],
        },
      }),
    ],
  },
  {
    name: "a purpose over the item cap is cut as the model cuts it",
    rows: [
      canvas("a", {
        sections: { purpose: [{ id: "p", text: `${"ab ".repeat(KICKOFF_ITEM_MAX)}🙂` }] },
      }),
      canvas("b", {
        agreedAt: LATER,
        sections: { purpose: [{ id: "p", text: `${"a".repeat(KICKOFF_ITEM_MAX - 1)}🙂 tail` }] },
      }),
    ],
  },
  {
    name: "own sections only",
    rows: [canvas("a", { sections: Object.create({ purpose: [{ id: "p", text: "Inherited" }] }) })],
  },
];

describe("the team's purpose without Kickoff's model", () => {
  it.each(CASES)("answers what the model's reading gives: $name", ({ rows }) => {
    expect(teamPurpose(rows)).toEqual(viaModel(rows));
  });

  it("is what the model exports, and reads undefined as no rows", () => {
    expect(modelTeamPurpose).toBe(teamPurpose);
    expect(teamPurpose(undefined)).toBeNull();
  });

  it("picks the expected canvas in the plain cases", () => {
    expect(teamPurpose(CASES[2].rows)).toEqual({ kickoffId: "b", text: "Purpose of b" });
    expect(teamPurpose(CASES[3].rows)?.kickoffId).toBe("b");
    expect(teamPurpose(CASES[5].rows)).toEqual({ kickoffId: "g", text: "Purpose of g" });
    expect(teamPurpose(CASES[6].rows)).toEqual({ kickoffId: "a", text: "Read this one" });
  });

  it("keeps the model, the format catalog and the sectioned kit out of the charter", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const imports = (src: string) => Array.from(src.matchAll(/from "([^"]+)"/g), (m) => m[1]);
    const purpose = imports(read("src/lib/kickoff/purpose.ts"));
    for (const path of purpose) {
      expect(path).not.toMatch(/kickoff\/(model|formats)$|^\.\/|sectioned/);
    }
    const charter = imports(read("src/app/(meta)/team/charter-view.ts"));
    expect(charter).toContain("@/lib/kickoff/purpose");
    expect(charter.filter((p) => p.startsWith("@/lib/kickoff/"))).toEqual([
      "@/lib/kickoff/purpose",
    ]);
  });
});
