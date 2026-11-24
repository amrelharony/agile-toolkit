import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CharterRule, TeamMember, WorkingAgreement } from "@/lib/stores/workspace-types";
import {
  WA_ID,
  emptyAgreement,
  normalizeAgreement,
  withConsent,
} from "@/lib/working-agreement/model";
import { applyTemplate, templateDefaults } from "@/lib/working-agreement/templates";
import { london, newYork } from "../team-time/fixtures";

/**
 * The Working Agreement's charter templates on the page: the Templates row
 * in "Add a rule", a form with a live preview, Apply with one Undo, applying
 * again in place, a hand edit detaching a rule, the in-memory example, the
 * core hours filled from Team Time, and ?template= links.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/app/(tools)/working-agreement/charts", () => ({ AdherenceChart: () => null }));

import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

const NOW = "2026-11-16T10:00:00.000Z";
const ROSTER: TeamMember[] = [
  { id: "m1", name: "Ann" },
  { id: "m2", name: "Sam" },
];

const ws = () => useWorkspaceStore.getState();
const stored = () => normalizeAgreement((ws().workingAgreements ?? []).find((d) => d.id === WA_ID));
const seed = (doc: Partial<WorkingAgreement> | null, extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    workingAgreements: doc ? [{ ...emptyAgreement(), ...doc } as WorkingAgreement] : [],
    teamMembers: ROSTER,
    sprints: [],
    retroBoards: [],
    teamTimePeople: [],
    ...extra,
  });

const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "work",
  text,
  agreedBy: [],
  consent: [],
  ...extra,
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <WorkingAgreementClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const templateButton = (name: RegExp) => screen.getByRole("button", { name });
const form = () => document.getElementById("wa-template-form") as HTMLElement;
const preview = () => form().querySelector("[data-template-preview]") as HTMLElement;
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

/** A charter with the urgency ladder applied, its first rule consented by Ann. */
function withLadder(): WorkingAgreement {
  let n = 0;
  const applied = applyTemplate(
    emptyAgreement(),
    "urgency-ladder",
    templateDefaults("urgency-ladder"),
    () => `t${++n}`,
    NOW
  ).doc;
  return {
    ...applied,
    rules: applied.rules.map((r) => (r.id === "t1" ? withConsent(r, "Ann", "consent", NOW) : r)),
  };
}

// The template forms load with next/dynamic when one opens. Open one once, and
// wait for it, so in every test the forms draw as soon as a template opens. The
// first opening says it is loading, then focus goes into the form once it draws.
beforeAll(async () => {
  seed(null);
  renderPage();
  fireEvent.click(templateButton(/^Urgency ladder/));
  expect(within(form()).getByText("Loading the template…")).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "Urgency ladder" }, { timeout: 15_000 })
  ).toBeInTheDocument();
  expect(within(form()).getAllByLabelText(/^Name/)[0]).toHaveFocus();
  cleanup();
}, 20_000);

let tzBefore: string | undefined;
beforeEach(() => {
  // The page reads this browser's zone; pin it so every machine reads the same.
  tzBefore = process.env.TZ;
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  toastSpy.mockReset();
  history.log.mockReset();
  window.history.replaceState(null, "", "/working-agreement");
  seed(null);
});

afterEach(() => {
  vi.useRealTimers();
  if (tzBefore === undefined) delete process.env.TZ;
  else process.env.TZ = tzBefore;
  useWorkspaceStore.setState({
    workingAgreements: [],
    teamMembers: [],
    sprints: [],
    retroBoards: [],
    teamTimePeople: [],
  });
});

describe("the Templates row", () => {
  it("lists the four templates in Add a rule and opens one form at a time", () => {
    renderPage();
    const row = screen.getByRole("region", { name: "Templates" });
    expect(within(row).getAllByRole("button", { expanded: false })).toHaveLength(4);
    fireEvent.click(templateButton(/^Urgency ladder/));
    expect(templateButton(/^Urgency ladder/)).toHaveAttribute("aria-expanded", "true");
    expect(within(form()).getByRole("heading", { name: "Urgency ladder" })).toBeInTheDocument();
    fireEvent.click(templateButton(/^Focus time/));
    expect(within(form()).getByRole("heading", { name: "Focus time" })).toBeInTheDocument();
    expect(templateButton(/^Urgency ladder/)).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(form()).getByRole("button", { name: "Cancel" }));
    expect(form()).toBeNull();
  });

  it("previews the rules, then adds them with one Undo and logs the counts", () => {
    renderPage();
    fireEvent.click(templateButton(/^Urgency ladder/));
    expect(within(preview()).getAllByText("New")).toHaveLength(2);
    expect(ws().workingAgreements).toEqual([]);
    fireEvent.click(within(form()).getByRole("button", { name: "Add 2 rules" }));
    expect(stored().rules.map((r) => [r.category, r.template?.slot])).toEqual([
      ["communication", "ladder"],
      ["communication", "after-hours"],
    ]);
    expect(stored().templates?.urgencyLadder?.levels).toHaveLength(4);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Applied the Urgency ladder template: 2 added");
    expect(history.log).toHaveBeenCalledWith("template_applied", {
      templateId: "urgency-ladder",
      added: 2,
      updated: 0,
      removed: 0,
      skipped: 0,
    });
    expect(screen.getAllByText("From the Urgency ladder template")).toHaveLength(2);
    undoLast();
    expect(stored().rules).toEqual([]);
    expect(stored()).not.toHaveProperty("templates");
  });

  it("applies again in place: consent stays, a dropped line comes out", () => {
    seed(withLadder());
    renderPage();
    expect(templateButton(/^Urgency ladder/)).toHaveTextContent("In the charter");
    fireEvent.click(templateButton(/^Urgency ladder/));
    expect(within(form()).getByText(/Consent stays as it is/)).toBeInTheDocument();
    expect(within(form()).getByRole("button", { name: "Update 2 rules" })).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("checkbox", { name: /only Emergency can't wait/ }));
    fireEvent.change(within(form()).getAllByLabelText(/^Reply within/)[0], {
      target: { value: "1 hour" },
    });
    expect(within(preview()).getByText("Changed")).toBeInTheDocument();
    expect(
      within(preview()).getByText(/Comes out: “Outside someone's working hours/)
    ).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("button", { name: "Update 1 rule" }));
    expect(stored().rules.map((r) => r.id)).toEqual(["t1"]);
    expect(stored().rules[0].description).toContain("1 hour.");
    expect(stored().rules[0].agreedBy).toEqual(["Ann"]);
    undoLast();
    expect(stored().rules.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(stored().templates?.urgencyLadder?.afterHours).toBe(true);
  });

  it("shows that a ladder applied after focus time rewords its rule, and Undo puts it back", () => {
    let n = 0;
    seed(
      applyTemplate(
        emptyAgreement(),
        "focus-time",
        templateDefaults("focus-time"),
        () => `f${++n}`,
        NOW
      ).doc
    );
    renderPage();
    fireEvent.click(templateButton(/^Urgency ladder/));
    expect(
      within(preview()).getByText(/The Focus time rule follows: “.*Emergency or Urgent today/)
    ).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("button", { name: "Add 2 rules" }));
    expect(stored().rules[0].text).toContain("unless they are Emergency or Urgent today");
    undoLast();
    expect(stored().rules[0].text).toContain("unless they are urgent.");
  });

  it("refuses a level with no name and saves nothing", () => {
    renderPage();
    fireEvent.click(templateButton(/^Urgency ladder/));
    fireEvent.change(within(form()).getAllByLabelText(/^Name/)[1], { target: { value: " " } });
    expect(within(preview()).getByText(/Fill in the answers above/)).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("button", { name: "Add rules" }));
    expect(within(form()).getByText("Name the level.")).toBeInTheDocument();
    expect(ws().workingAgreements).toEqual([]);
  });

  it("marks a line already in the charter, a Kickoff rule included, and leaves it out", () => {
    seed({
      rules: [
        rule("k1", "A person reads anything customer-facing before it goes out", {
          sourceRef: { tool: "kickoff", id: "item-1", doc: "kick-1" },
        }),
      ],
    });
    renderPage();
    fireEvent.click(templateButton(/^AI use/));
    expect(within(preview()).getByText("Already in the charter")).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("button", { name: "Add 2 rules" }));
    expect(stored().rules).toHaveLength(3);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe(
      "Applied the AI use template: 2 added, 1 already in the charter"
    );
  });
});

describe("template rules on the charter", () => {
  it("shows where a rule came from, AI use with its badge, and a Kickoff rule linking back", () => {
    let n = 0;
    const doc = applyTemplate(
      {
        ...emptyAgreement(),
        rules: [
          rule("k1", "Ship small", { sourceRef: { tool: "kickoff", id: "i", doc: "kick-1" } }),
        ],
      },
      "ai-use",
      templateDefaults("ai-use"),
      () => `a${++n}`,
      NOW
    ).doc;
    seed(doc);
    renderPage();
    expect(screen.getAllByText("AI use", { selector: "div" })).toHaveLength(3);
    expect(screen.getAllByText("From the AI use template")).toHaveLength(3);
    const back = screen.getByRole("link", { name: "From kickoff" });
    expect(back).toHaveAttribute("href", "/kickoff?kickoff=kick-1");
    const work = screen.getByRole("region", { name: "Work" });
    expect(within(work).getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
  });

  it("a hand edit makes the rule the team's own; Edit in template opens the form", () => {
    let n = 0;
    seed(
      applyTemplate(
        emptyAgreement(),
        "focus-time",
        templateDefaults("focus-time"),
        () => `f${++n}`,
        NOW
      ).doc
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit in template: Focus time" }));
    expect(within(form()).getByRole("heading", { name: "Focus time" })).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: /^Focus time is Tue and Thu/ }));
    const editor = screen.getByLabelText("Rule text");
    fireEvent.change(editor, { target: { value: "Focus on Tuesday mornings" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(stored().rules[0].text).toBe("Focus on Tuesday mornings");
    expect(stored().rules[0]).not.toHaveProperty("template");
    expect(screen.queryByText("From the Focus time template")).toBeNull();
  });

  it("Edit in template moves focus into the urgency ladder's first field", () => {
    seed(withLadder());
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit in template: Urgency ladder" })[0]);
    // Level 1's "Move up" is disabled; focus lands on its name instead.
    const first = within(form()).getAllByLabelText(/^Name/)[0];
    expect(first).toHaveValue("Emergency");
    expect(document.activeElement).toBe(first);
  });

  it("exports the urgency ladder as a table", () => {
    seed(withLadder());
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("## Urgency ladder");
    expect(md).toContain(
      "| Normal | Questions and reviews | A thread in the team channel | 1 working day |"
    );
  });
});

describe("the example", () => {
  it("tries the templates on the example only: the workspace stays empty and nothing is logged", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(templateButton(/^AI use/));
    fireEvent.click(within(form()).getByRole("button", { name: /^Add \d rules$/ }));
    expect(ws().workingAgreements).toEqual([]);
    expect(screen.getAllByText("From the AI use template").length).toBeGreaterThan(0);
    expect(history.log).not.toHaveBeenCalledWith("template_applied", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText("From the AI use template")).toBeNull();
  });
});

describe("core hours from Team Time", () => {
  it("links to Team Time when it has nobody yet", () => {
    renderPage();
    fireEvent.click(templateButton(/^Core hours/));
    expect(within(form()).getByRole("link", { name: "Team Time" })).toHaveAttribute(
      "href",
      "/team-time"
    );
    expect(
      within(form()).queryByRole("button", { name: "Use Team Time's shared hours" })
    ).toBeNull();
  });

  it("fills the hours everyone shares and shows them on each person's clock, never saved", () => {
    seed(null, { teamTimePeople: [london, newYork, { ...london, id: "example-x", name: "Ex" }] });
    renderPage();
    fireEvent.click(templateButton(/^Core hours/));
    fireEvent.click(within(form()).getByRole("button", { name: "Use Team Time's shared hours" }));
    expect(within(form()).getByLabelText(/^Start/)).toHaveValue("14:00");
    expect(within(form()).getByLabelText(/^End/)).toHaveValue("17:30");
    expect(
      within(form()).getByText(/everyone shares 14:00–17:30 UTC, Mon–Fri/)
    ).toBeInTheDocument();
    const clocks = within(form()).getByRole("region", { name: "On each person's clock" });
    expect(within(clocks).getByText("Lou: 14:00–17:30 London")).toBeInTheDocument();
    expect(within(clocks).getByText("Noor: 09:00–12:30 New York")).toBeInTheDocument();
    expect(within(clocks).queryByText(/^Ex:/)).toBeNull();
    fireEvent.change(within(form()).getByLabelText(/^Start/), { target: { value: "08:00" } });
    expect(
      within(clocks).getByText(/These hours fall outside the working hours of Lou, Noor/)
    ).toBeInTheDocument();
    fireEvent.change(within(form()).getByLabelText(/^Start/), { target: { value: "14:00" } });
    fireEvent.click(within(form()).getByRole("button", { name: "Add 1 rule" }));
    expect(stored().rules[0].text).toBe(
      "Our core hours are 14:00–17:30 UTC, Mon–Fri: we keep meetings and quick replies inside them."
    );
    expect(JSON.stringify(stored().templates?.coreHours)).not.toMatch(/Lou|Noor/);
  });

  it("says why Apply stops when an office is listed twice", () => {
    let n = 0;
    seed(
      applyTemplate(
        emptyAgreement(),
        "core-hours",
        {
          ...templateDefaults("core-hours", { timeZone: "UTC" }),
          anchorDays: [
            { site: "London", days: [1] },
            { site: "london", days: [3] },
          ],
        },
        () => `c${++n}`,
        NOW
      ).doc
    );
    renderPage();
    fireEvent.click(templateButton(/^Core hours/));
    expect(within(form()).getAllByText(/^london$/i)).toHaveLength(2);
    fireEvent.click(within(form()).getByRole("button", { name: /^Update/ }));
    expect(within(form()).getByRole("alert")).toHaveTextContent("This office is listed twice.");
    // Leaving one out clears it.
    fireEvent.click(within(form()).getByRole("button", { name: "Leave out london" }));
    expect(within(form()).queryByText("This office is listed twice.")).toBeNull();
  });

  it("opens from ?template=core-hours filled from Team Time, and leaves the address", () => {
    window.history.replaceState(null, "", "/working-agreement?template=core-hours&x=1");
    seed(null, { teamTimePeople: [london, newYork] });
    renderPage();
    expect(within(form()).getByRole("heading", { name: "Core hours" })).toBeInTheDocument();
    expect(within(form()).getByLabelText(/^Start/)).toHaveValue("14:00");
    expect(window.location.search).toBe("?x=1");
    expect(ws().workingAgreements).toEqual([]);
  });

  it("ignores a ?template= it doesn't know, dropping it all the same", () => {
    window.history.replaceState(null, "", "/working-agreement?template=nope");
    renderPage();
    expect(form()).toBeNull();
    expect(window.location.search).toBe("");
  });
});
