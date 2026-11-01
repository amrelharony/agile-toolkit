/**
 * docs/MCP-AGENTS.md against the code it describes, for the Team & people
 * work: which singleton CRUDs need the fixed id on create (and which still
 * mint a document no page shows without it), what to do with such a document
 * an older create minted, and every case the Release
 * Readiness "Definition of Done met" check leaves to a manual tick. The
 * answers come from the registry and checkDodGate, so a change on either
 * side fails here instead of leaving the doc wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/workspace";
import { checkDodGate } from "@/lib/releases/auto-gates";
import { MATURITY_ID } from "@/lib/maturity/assessment";
import { SKILLS_MATRIX_ID } from "@/lib/skills/coverage";
import {
  ADKAR_DOC_ID,
  DOD_DOC_ID,
  RACI_ID,
  WORKING_AGREEMENT_ID,
  type Story,
} from "@/lib/stores/workspace-types";
import { ADKAR, AGREEMENT, DOD, MATURITY, RACI, SKILLS, STORY } from "../team/phase6-fixtures";

const DOC = readFileSync(join(process.cwd(), "docs", "MCP-AGENTS.md"), "utf8");

/** The text under `heading`, up to the next heading of the same level. */
function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`No "${heading}" in docs/MCP-AGENTS.md`);
  const level = heading.slice(0, heading.indexOf(" "));
  const next = DOC.indexOf(`\n${level} `, start + heading.length + 1);
  return next < 0 ? DOC.slice(start) : DOC.slice(start, next);
}

describe("MCP-AGENTS.md: the Team & people singletons", () => {
  const bullet =
    section("### Team & people")
      .split("\n")
      .find((l) => l.startsWith("- **One document each.**")) ?? "";
  const sentences = bullet.split(/(?<=\.)\s+/);

  it.each([
    ["workspace.working_agreement", WORKING_AGREEMENT_ID, AGREEMENT],
    ["workspace.definition_of_done", DOD_DOC_ID, DOD],
    ["workspace.raci_matrix", RACI_ID, RACI],
    ["workspace.skills_matrix", SKILLS_MATRIX_ID, SKILLS],
    ["workspace.maturity_assessment", MATURITY_ID, MATURITY],
    ["workspace.adkar_doc", ADKAR_DOC_ID, ADKAR],
  ] as const)("%s: says what a create without the id does", (toolId, id, doc) => {
    expect(bullet).toContain(`\`${id}\``);
    const said = sentences.filter((s) => s.includes(`\`${toolId}\``)).join(" ");
    expect(said, `${toolId} isn't named`).not.toBe("");

    const create = registry.get(`${toolId}.create`);
    if (!create) throw new Error(`missing action ${toolId}.create`);
    const takesNoId = create.paramsSchema.safeParse({ entity: { ...doc, id: undefined } }).success;
    if (takesNoId) {
      // A generateId CRUD fills in its own id, which the page never reads.
      expect(said).toMatch(/no page shows/);
      expect(said).toContain(`\`${id}\``);
    } else {
      expect(said).toMatch(/needs the fixed id on create/);
    }
  });

  it.each([
    ["workspace.skills_matrix", "skillsMatrix_", SKILLS],
    ["workspace.maturity_assessment", "maturityAssessment_", MATURITY],
  ] as const)(
    "%s: says what to do with a document an older id-less create minted",
    (toolId, prefix, doc) => {
      const said = sentences.filter((s) => s.includes(`\`${prefix}…\``)).join(" ");
      expect(said, `${prefix}… isn't named`).not.toBe("");
      expect(said).toMatch(/no page shows it/);

      // Its id isn't the fixed one, so the schema (which update checks the
      // merged document against, under its own id) refuses it; delete takes any id.
      const orphan = `${prefix}abc12345`;
      const create = registry.get(`${toolId}.create`);
      const remove = registry.get(`${toolId}.delete`);
      if (!create || !remove) throw new Error(`missing action ${toolId}.create or .delete`);
      expect(create.paramsSchema.safeParse({ entity: { ...doc, id: orphan } }).success).toBe(false);
      expect(said).toMatch(/`update` refuses it/);
      expect(remove.paramsSchema.safeParse({ id: orphan }).success).toBe(true);
      expect(said).toMatch(/`delete` it/);
    }
  );
});

describe("MCP-AGENTS.md: the Release Readiness DoD gate", () => {
  const text = section("#### Release Readiness (`tool.release_readiness.*`)");
  const cantTell = /A check that can't tell \(([^)]*)\)/.exec(text)?.[1] ?? "";

  const optional = { ...DOD, items: DOD.items.map((i) => ({ ...i, required: false })) };
  const noOldTicks = { ...DOD, items: DOD.items.map((i) => ({ ...i, done: undefined })) };
  const notDone: Story = { ...STORY, status: "in_progress" };

  it.each([
    ["no DoD", null, undefined],
    ["no required criterion", optional, undefined],
    ["none of the linked stories done yet", DOD, [notDone]],
    ["no linked stories once the old ticks are gone", noOldTicks, []],
  ] as const)("names the case %j, which checkDodGate can't tell", (words, dod, linked) => {
    expect(checkDodGate(dod, linked).passed).toBeNull();
    expect(cantTell).toContain(words);
  });
});
