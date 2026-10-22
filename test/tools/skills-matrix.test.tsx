import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  defaultSkillsMatrix,
  type SkillProficiency,
  type SkillsMatrix,
} from "@/lib/stores/workspace-types";

/**
 * Team Skills Matrix: the demo seed, cycling proficiency cells, coverage,
 * bus-factor / knowledge-gap detection, adding / removing / renaming members
 * and skills, descriptions, reset, and the CSV + clipboard exports.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: string[][] } | undefined,
  clipboard: undefined as string | undefined,
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    csvData,
    clipboardText,
  }: {
    csvData?: { headers: string[]; rows: string[][] };
    clipboardText?: string;
  }) => {
    exported.csv = csvData;
    exported.clipboard = clipboardText;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { SkillsMatrixClient } from "@/app/(tools)/skills-matrix/skills-matrix-client";

const SM_ID = "skillsMatrix:current";

const doc = () => (useWorkspaceStore.getState().skillsMatrices ?? []).find((d) => d.id === SM_ID);

const seed = (m: Omit<SkillsMatrix, "id">) =>
  useWorkspaceStore.setState({ skillsMatrices: [{ id: SM_ID, ...m }] });

/**
 * Two members x three skills:
 *  - Go:   Ana Expert, Ben Advanced  -> covered (2 at Advanced+)
 *  - Rust: Ana Advanced, Ben Beginner -> bus factor (only Ana at Advanced+)
 *  - SQL:  Ana Beginner, Ben none    -> knowledge gap (nobody Intermediate+)
 */
const seedTeam = () =>
  seed({
    members: [
      { id: "a", name: "Ana" },
      { id: "b", name: "Ben" },
    ],
    skills: [
      { id: "x", name: "Go" },
      { id: "y", name: "Rust" },
      { id: "z", name: "SQL" },
    ],
    grid: { x: { a: 4, b: 3 }, y: { a: 3, b: 1 }, z: { a: 1, b: 0 } },
  });

const coverage = () => screen.getByText("Coverage").nextElementSibling!.textContent;
const cell = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  exported.csv = undefined;
  exported.clipboard = undefined;
  useWorkspaceStore.setState({ skillsMatrices: [] });
});

describe("Skills matrix: demo seed", () => {
  it("shows the 3 x 4 unrated demo without persisting it", () => {
    render(<SkillsMatrixClient />);
    for (const m of ["Alice", "Bob", "Carol"]) {
      expect(screen.getByRole("button", { name: m })).toBeInTheDocument();
    }
    for (const s of ["TypeScript", "React", "Node.js", "CI/CD"]) {
      expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: /: None$/ })).toHaveLength(12);
    expect(coverage()).toBe("0%");
    expect(screen.getByText("4 knowledge gaps")).toBeInTheDocument();
    expect(screen.queryByText(/bus factor/)).toBeNull();
    expect(screen.getAllByText(/Knowledge gap — nobody has Intermediate\+/)).toHaveLength(4);
    // Just looking does not write the seed to the synced store.
    expect(useWorkspaceStore.getState().skillsMatrices).toEqual([]);
  });
});

describe("Skills matrix: proficiency cells", () => {
  it("cycles a cell None -> Beginner -> ... -> Expert -> None and persists it", () => {
    render(<SkillsMatrixClient />);
    const labels = ["Beginner", "Intermediate", "Advanced", "Expert", "None"];
    labels.forEach((label, i) => {
      fireEvent.click(screen.getByRole("button", { name: /^TypeScript \/ Alice: / }));
      expect(doc()?.grid.s1.m1).toBe((i + 1) % 5);
      expect(cell(`TypeScript / Alice: ${label}`)).toBeInTheDocument();
    });
    // Only that cell changed.
    expect(doc()?.grid.s1.m2).toBe(0);
    expect(doc()?.grid.s2.m1).toBe(0);
  });

  it("updates coverage, bus factor and knowledge gaps as cells change", () => {
    render(<SkillsMatrixClient />);
    // Alice -> Advanced in TypeScript: one person at Advanced+ is a bus factor.
    for (let i = 0; i < 3; i++) fireEvent.click(cell(/^TypeScript \/ Alice: /));
    expect(coverage()).toBe("8%"); // 1 of 12 cells
    expect(screen.getByText("1 bus factor")).toBeInTheDocument();
    expect(screen.getByText("3 knowledge gaps")).toBeInTheDocument();
    expect(screen.getByText("BUS 1")).toBeInTheDocument();
    expect(screen.getByText(/Bus factor 1 — only one person/)).toBeInTheDocument();

    // Bob -> Intermediate: still only one at Advanced+.
    for (let i = 0; i < 2; i++) fireEvent.click(cell(/^TypeScript \/ Bob: /));
    expect(coverage()).toBe("17%"); // 2 of 12
    expect(screen.getByText("1 bus factor")).toBeInTheDocument();

    // Bob -> Advanced: two people at Advanced+, the risk clears.
    fireEvent.click(cell("TypeScript / Bob: Intermediate"));
    expect(screen.queryByText(/bus factor/)).toBeNull();
    expect(screen.queryByText("BUS 1")).toBeNull();
  });

  it("an Intermediate rating closes a knowledge gap without creating a bus factor", () => {
    render(<SkillsMatrixClient />);
    for (let i = 0; i < 2; i++) fireEvent.click(cell(/^React \/ Carol: /));
    expect(screen.getByText("3 knowledge gaps")).toBeInTheDocument();
    expect(screen.queryByText(/bus factor/)).toBeNull();
  });
});

describe("Skills matrix: seeded analysis", () => {
  it("derives coverage, risk badges and singular labels", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    expect(coverage()).toBe("83%"); // 5 of 6 cells rated
    expect(screen.getByText("1 bus factor")).toBeInTheDocument();
    expect(screen.getByText("1 knowledge gap")).toBeInTheDocument();
    expect(screen.getByText("BUS 1").closest("td")).toHaveTextContent("Rust");
    expect(screen.getByText("GAP").closest("td")).toHaveTextContent("SQL");
    expect(cell("Go / Ana: Expert")).toBeInTheDocument();
    expect(cell("Go / Ben: Advanced")).toBeInTheDocument();
    expect(cell("SQL / Ben: None")).toBeInTheDocument();
  });

  it("reports no risks when every skill has two people at Advanced+", () => {
    seed({
      members: [
        { id: "a", name: "Ana" },
        { id: "b", name: "Ben" },
      ],
      skills: [{ id: "x", name: "Go" }],
      grid: { x: { a: 3, b: 4 } },
    });
    render(<SkillsMatrixClient />);
    expect(coverage()).toBe("100%");
    expect(screen.getByText(/No risks detected/)).toBeInTheDocument();
  });

  it("shows 0% coverage and no crash with no members", () => {
    seed({ members: [], skills: [{ id: "x", name: "Go" }], grid: { x: {} } });
    render(<SkillsMatrixClient />);
    expect(coverage()).toBe("0%");
    expect(screen.getByText("1 knowledge gap")).toBeInTheDocument();
  });

  it("clamps a corrupt out-of-range level instead of crashing", () => {
    seed({
      members: [{ id: "a", name: "Ana" }],
      skills: [{ id: "x", name: "Go" }],
      grid: { x: { a: 9 as SkillProficiency } },
    });
    render(<SkillsMatrixClient />);
    expect(cell("Go / Ana: Expert")).toBeInTheDocument();
    expect(exported.csv?.rows).toEqual([["Go", "", "Expert"]]);
  });
});

describe("Skills matrix: members and skills", () => {
  it("adds a member named with the lowest unused number and an unrated column", () => {
    seed({
      members: [
        { id: "a", name: "Ana" },
        { id: "b", name: "Member 2" },
      ],
      skills: [{ id: "x", name: "Go" }],
      grid: { x: { a: 2, b: 1 } },
    });
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const added = doc()!.members[2];
    expect(added.name).toBe("Member 1");
    expect(doc()!.grid.x).toEqual({ a: 2, b: 1, [added.id]: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(doc()!.members.map((m) => m.name)).toEqual(["Ana", "Member 2", "Member 1", "Member 3"]);
  });

  it("adds a member to the demo seed (first edit persists it)", () => {
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(doc()!.members.map((m) => m.name)).toEqual(["Alice", "Bob", "Carol", "Member 1"]);
    expect(Object.keys(doc()!.grid)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("adds a skill with an unrated row for every member", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    const added = doc()!.skills[3];
    expect(added.name).toBe("Skill 1");
    expect(doc()!.grid[added.id]).toEqual({ a: 0, b: 0 });
    expect(cell("Skill 1 / Ana: None")).toBeInTheDocument();
  });

  it("removes a member and their column; the last member can't be removed", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove member Ben" }));
    expect(doc()!.members.map((m) => m.id)).toEqual(["a"]);
    expect(doc()!.grid).toEqual({ x: { a: 4 }, y: { a: 3 }, z: { a: 1 } });
    expect(screen.queryByRole("button", { name: /^Remove member/ })).toBeNull();
  });

  it("removes a skill and its row; the last skill can't be removed", () => {
    seed({
      members: [{ id: "a", name: "Ana" }],
      skills: [
        { id: "x", name: "Go" },
        { id: "y", name: "Rust" },
      ],
      grid: { x: { a: 4 }, y: { a: 1 } },
    });
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove skill Rust" }));
    expect(doc()!.skills.map((s) => s.id)).toEqual(["x"]);
    expect(doc()!.grid).toEqual({ x: { a: 4 } });
    expect(screen.queryByRole("button", { name: /^Remove skill/ })).toBeNull();
  });

  it("renames a member (trimmed) and ignores a blank rename", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Ana" }));
    const input = screen.getByRole("textbox", { name: "Rename Ana" });
    fireEvent.change(input, { target: { value: "  Anna  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(doc()!.members[0].name).toBe("Anna");
    expect(cell("Go / Anna: Expert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Anna" }));
    const again = screen.getByRole("textbox", { name: "Rename Anna" });
    fireEvent.change(again, { target: { value: "   " } });
    fireEvent.blur(again);
    expect(doc()!.members[0].name).toBe("Anna");
  });

  it("renames a skill", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "SQL" }));
    const input = screen.getByRole("textbox", { name: "Rename SQL" });
    fireEvent.change(input, { target: { value: "PostgreSQL" } });
    fireEvent.blur(input);
    expect(doc()!.skills[2]).toEqual({ id: "z", name: "PostgreSQL" });
  });

  it("commits member and skill descriptions on blur, trimming blanks to undefined", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    const memberDesc = screen.getByRole("textbox", { name: "Description for member Ana" });
    fireEvent.change(memberDesc, { target: { value: "  Tech lead  " } });
    // Nothing is written per keystroke.
    expect(doc()!.members[0].description).toBeUndefined();
    fireEvent.blur(memberDesc);
    expect(doc()!.members[0].description).toBe("Tech lead");
    expect(screen.getByRole("button", { name: "Ana" }).closest("th")).toHaveAttribute(
      "title",
      "Tech lead"
    );

    fireEvent.change(memberDesc, { target: { value: "   " } });
    fireEvent.blur(memberDesc);
    expect(doc()!.members[0].description).toBeUndefined();

    const skillDesc = screen.getByRole("textbox", { name: "Description for skill Go" });
    fireEvent.change(skillDesc, { target: { value: "Backend services" } });
    fireEvent.keyDown(skillDesc, { key: "Enter" });
    fireEvent.blur(skillDesc);
    expect(doc()!.skills[0].description).toBe("Backend services");
  });

  it("Reset restores the demo seed", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(doc()).toEqual(defaultSkillsMatrix(SM_ID));
    expect(coverage()).toBe("0%");
  });
});

describe("Skills matrix: exports", () => {
  it("exports a CSV with a description column and level labels", () => {
    seedTeam();
    useWorkspaceStore.setState((s) => ({
      skillsMatrices: s.skillsMatrices!.map((d) => ({
        ...d,
        skills: d.skills.map((sk) => (sk.id === "x" ? { ...sk, description: "APIs" } : sk)),
      })),
    }));
    render(<SkillsMatrixClient />);
    expect(exported.csv).toEqual({
      headers: ["Skill", "Description", "Ana", "Ben"],
      rows: [
        ["Go", "APIs", "Expert", "Advanced"],
        ["Rust", "", "Advanced", "Beginner"],
        ["SQL", "", "Beginner", ""],
      ],
    });
  });

  it("builds a clipboard table with risk flags", () => {
    seedTeam();
    render(<SkillsMatrixClient />);
    const lines = exported.clipboard!.split("\n");
    expect(lines[0]).toBe("TEAM SKILLS MATRIX");
    expect(lines[3]).toBe(["Skill".padEnd(20), "Ana".padEnd(14), "Ben".padEnd(14)].join(" | "));
    expect(lines).toContain(["SQL".padEnd(20), "Beginner".padEnd(14), "-".padEnd(14)].join(" | "));
    expect(lines).toContain("RISK FLAGS");
    expect(lines).toContain("[KNOWLEDGE GAP] SQL");
    expect(lines).toContain("[BUS FACTOR] Rust — only 1 person at Advanced+");
    expect(lines.some((l) => l.includes("Go") && l.startsWith("["))).toBe(false);
  });

  it("omits the risk section from the clipboard when there are no risks", () => {
    seed({
      members: [
        { id: "a", name: "Ana" },
        { id: "b", name: "Ben" },
      ],
      skills: [{ id: "x", name: "Go" }],
      grid: { x: { a: 3, b: 3 } },
    });
    render(<SkillsMatrixClient />);
    expect(exported.clipboard).not.toContain("RISK FLAGS");
  });
});
