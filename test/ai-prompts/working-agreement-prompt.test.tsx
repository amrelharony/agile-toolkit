import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { generateWorkingAgreementPrompts } from "@/lib/ai-prompts/working-agreement";
import type { ToolPromptConfig } from "@/lib/ai-prompts/types";

/**
 * The Working Agreement prompts read the page's check-in data: a rule's
 * mark in the round in progress can be Partly (printed "partly working"),
 * which the page used to drop before the prompt saw it; each rule's saved
 * check-ins come as its card says them, since saving a round clears the
 * marks; the latest saved round is given as the page states it, in both
 * prompts, its percentage only when quotable, never "0%" before the first
 * round; and the charter is published, or not, as the page's verdict says.
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
import { dayLabel, emptyAgreement, published } from "@/lib/working-agreement/model";
import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "work",
  text,
  agreedBy: [],
  ...extra,
});

const PUBLISHED_AT = "2026-09-12T10:00:00.000Z";
// The day as the page shows it ("12 Sep", or "12 Sept" where the locale data says so).
const ON = `published ${dayLabel(PUBLISHED_AT)}`;

describe("generateWorkingAgreementPrompts", () => {
  const [completeness, conflict] = generateWorkingAgreementPrompts({
    rules: [
      rule("r1", "Core hours 10 to 4", { stillWorking: true }),
      rule("r2", "Reviews within a day", { stillWorking: "partly" }),
      rule("r3", "No meetings on Fridays", { stillWorking: false }),
      rule("r4", "Cameras optional"),
    ],
    meta: { version: 2, publishedAt: PUBLISHED_AT },
    lastCheckIn: { summary: "2 of 4 working, 1 partly", pct: 63 },
  });

  it("prints a rule partly working as partly working", () => {
    for (const p of [completeness.prompt, conflict.prompt]) {
      expect(p).toContain("| Category | Rule | Agreed by | This round |");
      expect(p).toContain("| work | Core hours 10 to 4 | — | working |");
      expect(p).toContain("| work | Reviews within a day | — | partly working |");
      expect(p).toContain("| work | No meetings on Fridays | — | not working |");
      expect(p).toContain("| work | Cameras optional | — | not marked |");
      expect(p).toContain('"This round" is the check-in in progress, not saved yet.');
    }
  });

  it("gives the latest round as the page states it, in both prompts", () => {
    for (const p of [completeness.prompt, conflict.prompt]) {
      expect(p).toContain(
        "Latest check-in: 2 of 4 working, 1 partly (63% adherence, a rule partly working counting half)."
      );
    }
    // The renegotiation question points at the check-ins it was given.
    expect(conflict.prompt).toContain("Start from what the check-ins found");
    expect(conflict.prompt).not.toContain('"still working?" %');
  });

  it("gives each rule's saved check-ins as its card says them", () => {
    const prompts = generateWorkingAgreementPrompts({
      rules: [
        { ...rule("r1", "One"), slipping: [] },
        { ...rule("r2", "Two"), slipping: ["not_working", "not_working"] },
        { ...rule("r3", "Three"), slipping: ["partly"] },
        { ...rule("r4", "Four"), slipping: ["partly", "not_working"] },
        rule("r5", "Five"),
      ],
      meta: { version: 1, publishedAt: PUBLISHED_AT },
      lastCheckIn: { summary: "1 of 4 working, 2 partly", pct: null },
    });
    for (const { prompt: p } of prompts) {
      // Saving a round clears the marks: no "This round" column of blanks.
      expect(p).toContain("| Category | Rule | Agreed by | Saved check-ins |");
      expect(p).not.toContain("This round");
      expect(p).toContain("| work | One | — | working in the last check-in |");
      expect(p).toContain("| work | Two | — | not working in the last 2 check-ins |");
      expect(p).toContain("| work | Three | — | partly working in the last check-in |");
      expect(p).toContain("| work | Four | — | not fully working in the last 2 check-ins |");
      expect(p).toContain("| work | Five | — | not checked yet |");
    }
  });

  it("says when there is no check-in, never 0%", () => {
    const prompts = generateWorkingAgreementPrompts({
      rules: [rule("r1", "One")],
      meta: { version: 0 },
      lastCheckIn: null,
    });
    for (const { prompt: p } of prompts) {
      expect(p).toContain("No check-in saved yet.");
      expect(p).not.toMatch(/\d%/);
      expect(p).not.toContain("check-in in progress");
      expect(p).toContain("| Category | Rule | Agreed by |\n");
    }
    expect(prompts[1].prompt).toContain(
      "4. How should the team check whether its rules still work (no check-in is saved yet)"
    );
  });

  it("leaves out a percentage the page doesn't quote", () => {
    const [p] = generateWorkingAgreementPrompts({
      rules: [rule("r1", "One")],
      meta: { version: 1 },
      lastCheckIn: { summary: "1 of 2 working", pct: null },
    });
    expect(p.prompt).toContain("Latest check-in: 1 of 2 working.");
  });

  it("says the charter is published only when the page's verdict does", () => {
    // A version and a date: published.
    expect(completeness.prompt).toContain(
      `Team "(unnamed)": 4 rules in v2 (${ON}). Rules by category: work 4.`
    );
    expect(conflict.prompt).toContain(`4 rules in v2 (${ON}). Latest check-in:`);
    const draft = (meta: { version: number; publishedAt?: string }, unpublishedChanges = false) =>
      generateWorkingAgreementPrompts({
        rules: [rule("r1", "One"), rule("r2", "Two")],
        meta,
        unpublishedChanges,
        lastCheckIn: null,
      }).map((p) => p.prompt);
    // Never published, or a version with no date: a draft.
    for (const meta of [{ version: 0 }, { version: 3 }]) {
      for (const p of draft(meta)) {
        expect(p).toContain("2 rules, not published yet.");
        expect(p).not.toContain("currently published");
        expect(p).not.toMatch(/\bv\d|version \d/);
      }
    }
    // Published, with the draft changed since.
    for (const p of draft({ version: 3, publishedAt: PUBLISHED_AT }, true)) {
      expect(p).toContain(`2 rules in v3 (${ON}), with changes not yet published.`);
    }
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

  const prompts = () => (config.current?.prompts ?? []).map((p) => p.prompt);

  it("passes Partly marks, each rule's saved check-ins and the last round's adherence", () => {
    seed({
      rules: [
        rule("r1", "One", { stillWorking: "partly" }),
        rule("r2", "Two", { stillWorking: true }),
        rule("r3", "Three"),
        rule("r4", "Four"),
      ],
      meta: { version: 1, publishedAt: PUBLISHED_AT },
      checkIns: [
        {
          id: "c0",
          date: "2026-09-15",
          version: 1,
          results: { r3: "not_working" },
        },
        {
          id: "c1",
          date: "2026-10-01",
          version: 1,
          results: { r1: "working", r2: "partly", r3: "not_working" },
        },
      ],
    });
    renderPage();
    const all = prompts();
    expect(all).toHaveLength(2);
    for (const p of all) {
      expect(p).toContain("| work | One | — | working in the last check-in | partly working |");
      expect(p).toContain("| work | Two | — | partly working in the last check-in | working |");
      expect(p).toContain(
        "| work | Three | — | not working in the last 2 check-ins | not marked |"
      );
      expect(p).toContain("| work | Four | — | not checked yet | not marked |");
      // (1 + ½) of 3, quoted from three rules checked.
      expect(p).toContain("Latest check-in: 1 of 3 working, 1 partly (50% adherence");
    }
  });

  it("keeps a saved round's findings once its marks are cleared", () => {
    seed({
      rules: [rule("r1", "One"), rule("r2", "Two")],
      meta: { version: 1, publishedAt: PUBLISHED_AT },
      checkIns: [
        { id: "c1", date: "2026-10-01", version: 1, results: { r1: "working", r2: "partly" } },
      ],
    });
    renderPage();
    const [, conflict] = prompts();
    expect(conflict).toContain("| work | Two | — | partly working in the last check-in |");
    expect(conflict).not.toContain("This round");
    expect(conflict).toContain("Latest check-in: 1 of 2 working, 1 partly.");
  });

  it("says the charter is published, with changes since, as the verdict does", () => {
    const doc = published(
      { ...emptyAgreement(), rules: [rule("r1", "One")], meta: { version: 0 } },
      PUBLISHED_AT
    );
    seed({ ...doc, rules: [...doc.rules, rule("r2", "Two")] });
    renderPage();
    for (const p of prompts()) {
      expect(p).toContain(`2 rules in v1 (${ON}), with changes not yet published.`);
    }
  });

  it("says not published and no check-in yet before the first round", () => {
    seed({ rules: [rule("r1", "One")], meta: { version: 0 } });
    renderPage();
    for (const p of prompts()) {
      expect(p).toContain("1 rule, not published yet.");
      expect(p).toContain("No check-in saved yet.");
    }
  });
});
