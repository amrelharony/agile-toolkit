import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateHealthCheckPrompts } from "@/lib/ai-prompts/health-check";
import type { ToolPromptConfig } from "@/lib/ai-prompts/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_CHECK_DIMENSIONS,
  type HealthCheck,
  type HealthCheckEntry,
  type HealthDimension,
  type HealthDimensionScore,
} from "@/lib/stores/workspace-types";
import {
  emptyHealthCheck,
  withCustomDimension,
  withNote,
  withRating,
} from "@/lib/health-check/score";

/**
 * The Health Check prompt takes the dimensions it is given (the built-in
 * ones and the team's own, rated only) instead of a fixed list of eight,
 * and a dimension's trend is optional: "First check" with no saved check
 * before, "New since …" when that check has no light for it, never
 * "Stable". The page passes the trends it derives (`trendSince`) and its
 * custom dimensions.
 */

const config = vi.hoisted(() => ({ current: null as ToolPromptConfig | null }));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config: c }: { config: ToolPromptConfig }) => {
    config.current = c;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/app/(tools)/health-check/charts", () => ({ HealthTrendChart: () => null }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";

const [deepDive, facilitation] = generateHealthCheckPrompts({
  current: {
    label: "Sprint 12",
    dimensions: [
      { name: "Fun", light: "green", trend: "up" },
      { name: "Speed", light: "red", trend: "down", note: "Reviews wait two days" },
      { name: "Mission", light: "yellow", trend: "same" },
      { name: "On-call load", light: "red", trend: null, custom: true },
    ],
    unrated: ["Teamwork"],
    healthPct: 38,
  },
  previousLabel: "Sprint 11",
});

describe("generateHealthCheckPrompts", () => {
  it("lists the dimensions it is given, the team's own included, and no others", () => {
    expect(deepDive.prompt).toContain("The team rated 4 dimensions (1 of their own)");
    expect(deepDive.prompt).toContain('for "Sprint 12"');
    expect(deepDive.prompt).toContain("| On-call load (team's own) | RED |");
    // Built-ins nobody rated are not listed as rated rows.
    expect(deepDive.prompt).not.toMatch(/\| (Learning|Easy to Release|Teamwork) \|/);
    expect(deepDive.prompt).not.toContain("N/A");
    expect(deepDive.prompt).toContain("Not rated yet: Teamwork.");
    expect(deepDive.prompt).toContain("🔴 Red dimensions: Speed, On-call load");
    expect(deepDive.prompt).toContain("🟡 Yellow dimensions: Mission");
    expect(deepDive.prompt).toContain("📉 Declining dimensions: Speed");
    expect(deepDive.prompt).toContain("Health 38%");
    expect(facilitation.prompt).toContain("| Speed | RED | ↓ Declining | Reviews wait two days |");
  });

  it("says New since … for a dimension the previous check had no light for", () => {
    expect(deepDive.prompt).toContain('against the previous saved check, "Sprint 11"');
    expect(deepDive.prompt).toContain("| Fun | GREEN | ↑ Improving | — |");
    expect(deepDive.prompt).toContain("| Mission | YELLOW | → Stable | — |");
    expect(deepDive.prompt).toContain(
      "| On-call load (team's own) | RED | New since Sprint 11 | — |"
    );
  });

  it("says First check when there is no saved check before, never Stable", () => {
    const [first] = generateHealthCheckPrompts({
      current: { label: "Check of 2026-10-26", dimensions: [{ name: "Fun", light: "yellow" }] },
    });
    expect(first.prompt).toContain("| Fun | YELLOW | First check |");
    expect(first.prompt).toContain(
      "This is the team's first saved check, so there are no trends yet."
    );
    expect(first.prompt).not.toContain("Stable");
    expect(first.prompt).toContain("The team rated 1 dimension using");
  });

  it("has no prompts before a dimension is rated", () => {
    expect(generateHealthCheckPrompts({ current: { label: "S1", dimensions: [] } })).toEqual([]);
  });
});

/* ── The page's prompt input ────────────────────────────────────────── */

const D = HEALTH_CHECK_DIMENSIONS;
const scores = (
  set: Partial<Record<HealthDimension, "green" | "yellow" | "red">>
): Record<HealthDimension, HealthDimensionScore> =>
  Object.fromEntries(D.map((d) => [d, { light: set[d] ?? "green", trend: "same" }])) as Record<
    HealthDimension,
    HealthDimensionScore
  >;

describe("the page's prompt", () => {
  beforeEach(() => {
    config.current = null;
    useWorkspaceStore.setState({ healthChecks: [], sprints: [], retroBoards: [] });
  });

  const renderPage = () =>
    render(
      <TooltipProvider>
        <HealthCheckClient />
      </TooltipProvider>
    );

  it("passes the rated dimensions, custom ones included, with their derived trends", () => {
    const before: HealthCheckEntry = {
      id: "c1",
      sprintName: "Sprint 11",
      date: "2026-10-01",
      scores: scores({ Speed: "green", Fun: "yellow" }),
    };
    let d: HealthCheck = { ...emptyHealthCheck(), history: [before] };
    d = withCustomDimension(d, { id: "custom-oncall", name: "On-call load" });
    d = withRating(d, "Speed", "red");
    d = withRating(d, "Fun", "green");
    d = withRating(d, "custom-oncall", "yellow");
    d = withNote(d, "custom-oncall", "Two pages a night");
    d = { ...d, current: { ...d.current, sprintName: "Sprint 12", date: "2026-10-20" } };
    useWorkspaceStore.setState({ healthChecks: [d] });
    renderPage();

    const prompt = config.current?.prompts[0]?.prompt ?? "";
    expect(prompt).toContain(
      'The team rated 3 dimensions (1 of their own) using traffic lights (Green/Yellow/Red) for "Sprint 12".'
    );
    expect(prompt).toContain("| Fun | GREEN | ↑ Improving | — |");
    expect(prompt).toContain("| Speed | RED | ↓ Declining | — |");
    expect(prompt).toContain(
      "| On-call load (team's own) | YELLOW | New since Sprint 11 | Two pages a night |"
    );
    // The placeholder greens of the unrated built-ins never reach the prompt.
    expect(prompt).not.toMatch(/\| Teamwork \|/);
    expect(prompt).toContain("Not rated yet: Delivering Value, Easy to Release");
  });

  it("says First check with no saved check before", () => {
    const d = withRating(emptyHealthCheck(), "Fun", "red");
    useWorkspaceStore.setState({ healthChecks: [d] });
    renderPage();
    const prompt = config.current?.prompts[0]?.prompt ?? "";
    expect(prompt).toContain("| Fun | RED | First check |");
    expect(prompt).toContain("Health 0%");
  });
});
