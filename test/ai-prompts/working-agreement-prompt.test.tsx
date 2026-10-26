import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { generateWorkingAgreementPrompts } from "@/lib/ai-prompts/working-agreement";
import type { ToolPromptConfig } from "@/lib/ai-prompts/types";

/**
 * The Working Agreement prompt reads the page's check-in data: a rule's
 * mark in the round in progress can be Partly (printed "partly working"),
 * which the page used to drop before the prompt saw it; and the latest
 * saved round is given as the page states it, its percentage only when
 * quotable, never "0%" before the first round.
 */

const config = vi.hoisted(() => ({ current: null as ToolPromptConfig | null }));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config: c }: { config: ToolPromptConfig }) => {
    config.current = c;
    return null;
  },
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/app/(tools)/working-agreement/charts", () => ({ AdherenceChart: () => null }));

import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CharterRule, WorkingAgreement } from "@/lib/stores/workspace-types";
import { emptyAgreement } from "@/lib/working-agreement/model";
import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "work",
  text,
  agreedBy: [],
  ...extra,
});

describe("generateWorkingAgreementPrompts", () => {
  const [completeness, conflict] = generateWorkingAgreementPrompts({
    rules: [
      rule("r1", "Core hours 10 to 4", { stillWorking: true }),
      rule("r2", "Reviews within a day", { stillWorking: "partly" }),
      rule("r3", "No meetings on Fridays", { stillWorking: false }),
      rule("r4", "Cameras optional"),
    ],
    meta: { version: 2, publishedAt: "2026-09-12T10:00:00.000Z" },
    lastCheckIn: { summary: "2 of 4 working, 1 partly", pct: 63 },
  });

  it("prints a rule partly working as partly working", () => {
    for (const p of [completeness.prompt, conflict.prompt]) {
      expect(p).toContain("| work | Core hours 10 to 4 | — | yes |");
      expect(p).toContain("| work | Reviews within a day | — | partly working |");
      expect(p).toContain("| work | No meetings on Fridays | — | no |");
      expect(p).toContain("| work | Cameras optional | — | — |");
      expect(p).toContain('"Still working?" is the check-in in progress');
    }
  });

  it("gives the latest round as the page states it", () => {
    expect(completeness.prompt).toContain(
      "Latest check-in: 2 of 4 working, 1 partly (63% adherence, a rule partly working counting half)."
    );
  });

  it("says when there is no check-in, never 0%", () => {
    const [p] = generateWorkingAgreementPrompts({
      rules: [rule("r1", "One")],
      meta: { version: 0 },
      lastCheckIn: null,
    });
    expect(p.prompt).toContain("No check-in saved yet.");
    expect(p.prompt).not.toMatch(/\b0%/);
    expect(p.prompt).not.toContain("check-in in progress");
  });

  it("leaves out a percentage the page doesn't quote", () => {
    const [p] = generateWorkingAgreementPrompts({
      rules: [rule("r1", "One")],
      meta: { version: 1 },
      lastCheckIn: { summary: "1 of 2 working", pct: null },
    });
    expect(p.prompt).toContain("Latest check-in: 1 of 2 working.");
  });
});

describe("the page's prompt", () => {
  beforeEach(() => {
    config.current = null;
    useWorkspaceStore.getState().resetWorkspace();
  });

  const seed = (doc: Partial<WorkingAgreement>) =>
    useWorkspaceStore.setState({
      workingAgreements: [{ ...emptyAgreement(), ...doc } as WorkingAgreement],
      teamMembers: [],
      sprints: [],
      retroBoards: [],
    });

  const renderPage = () =>
    render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <WorkingAgreementClient />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );

  it("passes Partly marks and the last round's adherence", () => {
    seed({
      rules: [
        rule("r1", "One", { stillWorking: "partly" }),
        rule("r2", "Two", { stillWorking: true }),
        rule("r3", "Three"),
      ],
      meta: { version: 1, publishedAt: "2026-09-12T10:00:00.000Z" },
      checkIns: [
        {
          id: "c1",
          date: "2026-10-01",
          version: 1,
          results: { r1: "working", r2: "partly", r3: "not_working" },
        },
      ],
    });
    renderPage();
    const prompt = config.current?.prompts[0]?.prompt ?? "";
    expect(prompt).toContain("| work | One | — | partly working |");
    expect(prompt).toContain("| work | Two | — | yes |");
    // (1 + ½) of 3, quoted from three rules checked.
    expect(prompt).toContain("Latest check-in: 1 of 3 working, 1 partly (50% adherence");
  });

  it("says no check-in yet before the first round", () => {
    seed({ rules: [rule("r1", "One")], meta: { version: 0 } });
    renderPage();
    expect(config.current?.prompts[0]?.prompt).toContain("No check-in saved yet.");
  });
});
