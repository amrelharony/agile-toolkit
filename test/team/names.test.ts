/**
 * The roster name match moved out of the "use client" use-team-roster
 * module into lib/team/names, so server code (agent actions, next-step
 * rules, shared libs) can use it; use-team-roster re-exports it.
 */

import { describe, expect, it } from "vitest";
import { findRosterMember, nameKey } from "@/lib/team/names";
import * as roster from "@/lib/team/use-team-roster";
import type { TeamMember } from "@/lib/stores/workspace-types";

const TEAM: TeamMember[] = [
  { id: "m1", name: "Ana Lima" },
  { id: "m2", name: "Bo" },
];

describe("names", () => {
  it("keys a name trimmed and case-insensitive", () => {
    expect(nameKey("  Ana LIMA ")).toBe("ana lima");
    expect(nameKey(undefined)).toBe("");
    expect(nameKey(null)).toBe("");
  });

  it("finds the roster member by name, never for a blank one", () => {
    expect(findRosterMember(TEAM, " ana lima")).toBe(TEAM[0]);
    expect(findRosterMember(TEAM, "Cy")).toBeUndefined();
    expect(findRosterMember([{ id: "x", name: "" }], "  ")).toBeUndefined();
  });

  it("works on any list of named people", () => {
    const consent = [{ name: "Bo", vote: "consent" }];
    expect(findRosterMember(consent, "BO")).toBe(consent[0]);
  });

  it("is what use-team-roster still exports, so its callers keep working", () => {
    expect(roster.nameKey).toBe(nameKey);
    expect(roster.findRosterMember).toBe(findRosterMember);
  });
});
