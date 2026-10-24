import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Premortem: "Load an example" adds an example premortem of its own (never
 * mixed into the user's), "Clear example" removes it but keeps whatever the
 * user made their own in it, and a premortem exports as Markdown.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { PremortemClient } from "@/app/(tools)/premortem/premortem-client";
import {
  EXAMPLE_PREMORTEM_ID,
  EXAMPLE_SCENARIO,
  buildExample,
} from "@/app/(tools)/premortem/example";
import { toMarkdown } from "@/app/(tools)/premortem/markdown";
import type { Premortem, PremortemState } from "@/app/(tools)/premortem/model";

const KEY = "agile-toolkit:premortem";
const NOW = new Date(2026, 9, 18);
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "{}") as PremortemState;
const notice = () => screen.queryByText("Example data.");
const renderPremortem = () =>
  render(
    <TooltipProvider>
      <PremortemClient />
    </TooltipProvider>
  );

const premortem = (over: Partial<Premortem>): Premortem => ({
  id: "p1",
  title: "Launch",
  scenario: "It failed.",
  phase: "act",
  causes: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  localStorage.removeItem(KEY);
  window.history.replaceState(null, "", "/premortem");
});

describe("Premortem Markdown", () => {
  it("lists the scenario, the causes in rank order and the actions with owners", () => {
    const md = toMarkdown(buildExample(), { now: NOW });
    expect(md).toMatch(/^# Premortem: Mobile checkout launch — 18 Oct 2026\n/);
    expect(md).toContain("**Phase:** Act");
    expect(md).toContain(`## Imagined failure\n\n${EXAMPLE_SCENARIO}`);
    expect(md).toContain(
      "| # | Cause | Votes | Likelihood | Impact | Score | Preventive action | Owner | Risk Register |"
    );
    expect(md).toContain(
      "| 1 | Payment provider integration took far longer than estimated — Nobody on the team has built a wallet integration before. | 5 | 4 | 4 | 16 | Spike the wallet integration in sprint 1 and get sandbox access this week. | Diego (iOS) |  |"
    );
    // The duplicate grouped into the flaky tests travels with it.
    expect(md).toContain("(also: “Nobody trusted the CI pipeline”) | 4 | 5 | 3 | 15 |");
    // Two causes score 12; the votes put the launch date first.
    expect(md.indexOf("Launch date announced")).toBeLessThan(md.indexOf("older Android"));
    // The example's causes never go to the real Risk Register, so the
    // verdict doesn't ask for it.
    expect(md).toContain(
      "**Top risk: “Payment provider integration took far longer than estimated” (5 votes, L4 × I4 = 16). Each has a preventive action. Example causes stay in the example: start a premortem of your own to send risks.**"
    );
    expect(md).toContain("## Preventive actions");
    expect(md).toContain("- [ ] Book the legal review for sprint 3. — **Priya (PM)**");
  });

  it("escapes pipes and collapses newlines in table cells", () => {
    const md = toMarkdown(
      premortem({
        causes: [
          {
            id: "c1",
            text: "Scope | creep",
            likelihood: 2,
            impact: 3,
            preventiveAction: "Say\nno",
            owner: "PO",
          },
        ],
      }),
      { now: NOW }
    );
    expect(md).toContain("| 1 | Scope \\| creep | 0 | 2 | 3 | 6 | Say no | PO |  |");
  });

  it("says there are no causes yet on a blank premortem", () => {
    const md = toMarkdown(premortem({ scenario: "" }), { now: NOW });
    expect(md).toContain("_Not described yet._");
    expect(md).toContain("## Causes\n\n_No causes yet._\n");
  });
});

describe("Premortem example", () => {
  it("loads as its own premortem and clears only the example", () => {
    renderPremortem();
    expect(screen.getByText(/No premortem yet/)).toBeInTheDocument();
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(notice()).toBeInTheDocument();
    const [example] = stored().premortems;
    expect(example.id).toBe(EXAMPLE_PREMORTEM_ID);
    expect(example.causes).toHaveLength(6);
    expect(example.causes.every((c) => c.id.startsWith("example-"))).toBe(true);
    expect(screen.getByRole("heading", { name: /Mobile checkout launch/ })).toBeInTheDocument();
    expect(screen.getByText(EXAMPLE_SCENARIO)).toBeInTheDocument();

    // The user writes a cause of their own into it.
    fireEvent.click(screen.getByRole("button", { name: /Step 1 of 4: Write/ }));
    const field = screen.getByLabelText(/A reason it failed/);
    fireEvent.change(field, { target: { value: "Nobody owned the rollout" } });
    fireEvent.submit(field.closest("form")!);
    const mine = stored().premortems[0].causes.find((c) => !c.id.startsWith("example-"))!;
    expect(mine.text).toBe("Nobody owned the rollout");

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    const after = stored().premortems;
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toMatch(/^example-/);
    expect(after[0]).toMatchObject({ title: "Premortem", scenario: "" });
    expect(after[0].causes.map((c) => c.id)).toEqual([mine.id]);
    expect(notice()).toBeNull();
  });

  it("keeps an edited scenario when clearing", () => {
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit the details of “Mobile checkout launch”" })
    );
    fireEvent.change(screen.getByLabelText(/Imagined failure/), {
      target: { value: "Our launch slipped a quarter." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    const [kept] = stored().premortems;
    expect(kept).toMatchObject({
      title: "Premortem",
      scenario: "Our launch slipped a quarter.",
      phase: "write",
      causes: [],
    });
  });

  it("goes away entirely when nothing in it was the user's", () => {
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().premortems).toEqual([]);
    expect(screen.getByText(/No premortem yet/)).toBeInTheDocument();
  });

  it("is offered beside a premortem with no causes, without touching it", () => {
    localStorage.setItem(KEY, JSON.stringify({ scenario: "We missed the date.", causes: [] }));
    renderPremortem();
    expect(screen.getByText("We missed the date.")).toBeInTheDocument();
    // With nothing to act on, the old premortem opens in Write.
    expect(screen.getByRole("button", { name: /Step 1 of 4: Write/ })).toHaveAttribute(
      "aria-current",
      "step"
    );
    expect(screen.getByLabelText(/A reason it failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See an example premortem" }));
    const ids = stored().premortems.map((p) => p.id);
    expect(ids).toEqual([EXAMPLE_PREMORTEM_ID, "legacy-premortem"]);
    expect(stored().premortems[1]).toMatchObject({
      scenario: "We missed the date.",
      phase: "write",
      causes: [],
    });
  });
});
