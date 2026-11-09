/**
 * lib/agent/grounding.ts — the site knowledge that goes into the agent's
 * system prompt: the open tool's guide and related tools as Markdown links.
 * VIP-only and unreleased tools must never be suggested.
 */

import { describe, it, expect } from "vitest";
import { composeGrounding, formatGuideForPrompt, formatRelatedTools } from "@/lib/agent/grounding";
import { getToolById, tools } from "@/lib/constants/tools";
import { getGuide } from "@/lib/tools/guides";
import { searchTools } from "@/lib/search/tool-search";
import type { ToolGuide } from "@/lib/tools/guides/types";

const TOOL = {
  id: "retro",
  name: "Retrospective",
  path: "/retro",
  description: "Run a  team\nretrospective.",
};

const GUIDE: ToolGuide = {
  toolId: "retro",
  summary: "Look back on the sprint and agree what to change.",
  whenToUse: ["At the end of every sprint", "After an incident"],
  steps: ["Set the stage", "Gather data", "Decide what to do"],
  tips: ["Keep actions small"],
  timebox: "45–90 minutes",
};

describe("formatGuideForPrompt", () => {
  it("covers the summary, when to use, steps, tips and timebox", () => {
    const out = formatGuideForPrompt(TOOL, GUIDE);
    expect(out).toContain("Current tool: Retrospective (/retro)");
    expect(out).toContain("What it is: Look back on the sprint and agree what to change.");
    expect(out).toContain("When to use it:\n- At the end of every sprint\n- After an incident");
    expect(out).toContain("How to run it:\n1. Set the stage\n2. Gather data\n3. Decide what to do");
    expect(out).toContain("Tips:\n- Keep actions small");
    expect(out).toContain("Typical timebox: 45–90 minutes");
  });

  it("falls back to the tool's description without a guide", () => {
    const out = formatGuideForPrompt(TOOL, undefined);
    expect(out).toBe("Current tool: Retrospective (/retro)\nWhat it is: Run a team retrospective.");
  });

  it("leaves out sections the guide doesn't have", () => {
    const out = formatGuideForPrompt(TOOL, { ...GUIDE, tips: undefined, timebox: undefined });
    expect(out).not.toContain("Tips:");
    expect(out).not.toContain("Typical timebox");
  });

  it("stays within maxChars", () => {
    const long: ToolGuide = {
      ...GUIDE,
      steps: Array.from({ length: 60 }, (_, i) => `Step number ${i} with some words in it`),
    };
    const out = formatGuideForPrompt(TOOL, long, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("Current tool: Retrospective")).toBe(true);
  });

  it("fits a real guide into the default 1800 characters", async () => {
    const tool = getToolById("retro");
    const guide = await getGuide("retro");
    expect(tool && guide).toBeTruthy();
    const out = formatGuideForPrompt(tool!, guide);
    expect(out.length).toBeLessThanOrEqual(1800);
    expect(out).toContain(guide!.steps[0].replace(/\s+/g, " ").trim().slice(0, 30));
  });
});

describe("formatRelatedTools", () => {
  const t = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Tool ${id}`,
    path: `/${id}`,
    description: `About ${id}.`,
    ...extra,
  });

  it("lists tools as Markdown links with their description", () => {
    expect(formatRelatedTools([t("a"), t("b")])).toBe(
      "- [Tool a](/a): About a.\n- [Tool b](/b): About b."
    );
  });

  it("stops at max (4 by default)", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => t(id));
    expect(formatRelatedTools(many).split("\n")).toHaveLength(4);
    expect(formatRelatedTools(many, 2).split("\n")).toHaveLength(2);
  });

  it("never suggests a VIP-only or unreleased tool", () => {
    const out = formatRelatedTools([
      t("vip", { access: "vip" }),
      t("pending", { pendingApproval: true }),
      t("open"),
    ]);
    expect(out).toBe("- [Tool open](/open): About open.");
  });

  it("never suggests a real VIP tool", () => {
    const vipTools = tools.filter((x) => x.access === "vip");
    expect(vipTools.length).toBeGreaterThan(0);
    expect(formatRelatedTools(vipTools)).toBe("");
  });

  it("is empty for no tools", () => {
    expect(formatRelatedTools([])).toBe("");
  });
});

describe("composeGrounding", () => {
  it("joins the guide and related tools, leaving the open tool out of the suggestions", () => {
    const related = [
      { ...TOOL, description: "Same tool." },
      { id: "kudos", name: "Kudos", path: "/kudos", description: "Thank a teammate." },
    ];
    const out = composeGrounding({ tool: TOOL, guide: GUIDE, related });
    expect(out).toContain("Current tool: Retrospective (/retro)");
    expect(out).toContain("- [Kudos](/kudos): Thank a teammate.");
    expect(out).not.toContain("[Retrospective](/retro)");
  });

  it("works with only related tools, or nothing at all", () => {
    const related = [{ id: "kudos", name: "Kudos", path: "/kudos", description: "Thanks." }];
    expect(composeGrounding({ related })).toMatch(/^Toolkit pages that may help/);
    expect(composeGrounding({})).toBe("");
    expect(composeGrounding({ tool: null, related: [] })).toBe("");
  });

  it("links real search results by their real paths", () => {
    const related = searchTools("run a retrospective", 3);
    expect(related.length).toBeGreaterThan(0);
    const out = composeGrounding({ related });
    for (const tool of related) expect(out).toContain(`[${tool.name}](${tool.path})`);
  });
});
