import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kickoff, KickoffItem, ProductGoal } from "@/lib/stores/workspace-types";

/**
 * Kickoff (P2.8): six formats to start a team or a piece of work on the
 * same page. The empty state and the example, starting each kind of
 * format (a Team Canvas's people from the roster, Inception's sliders),
 * lines added, edited and deleted with Undo, caps and single answers,
 * ratings, covers, sends to each route with a live link (blocked for an
 * unrated worry, a [placeholder] and the example), the trade-off sliders and
 * their decision, the problem statement and its questions, Ask Amr's draft
 * with no AI, Agree and Back to draft, `?kickoff=`, the Product Goal line
 * and the export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: (...args: unknown[]) => cheers.push(args) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/kickoff",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "", filename: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, filename }: { markdown: string; filename: string }) => {
    exported.markdown = markdown;
    exported.filename = filename;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

import { KickoffClient } from "@/app/(tools)/kickoff/kickoff-client";
import { buildExample } from "@/app/(tools)/kickoff/example";
import { kickoffToMarkdown } from "@/app/(tools)/kickoff/markdown";
import { validateStart } from "@/app/(tools)/kickoff/start-form";
import { personFromText } from "@/app/(tools)/kickoff/section";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { kickoffDraftFallback, kickoffDraftInputFor } from "@/lib/ai/tasks/kickoff.lite";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import { KICKOFF_FORMAT_DEFS } from "@/lib/kickoff/formats";
import { normalizeKickoff, statementFrom } from "@/lib/kickoff/model";
import { todayIso } from "@/lib/sprints/series";
import { exampleId } from "@/lib/utils/example-id";
import { WA_ID } from "@/lib/working-agreement/model";

/** jsdom has no ResizeObserver; the send menu's popper measures with one. */
function stubResizeObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

const ws = () => useWorkspaceStore.getState();
const rows = () => ws().kickoffs ?? [];
const byId = (id: string) => normalizeKickoff(rows().find((k) => k.id === id))!;

/** The Undo of the newest toast with this label. */
function undo(label: string | RegExp) {
  const call = [...toastSpy.mock.calls]
    .reverse()
    .find((c) => (typeof label === "string" ? c[0] === label : label.test(String(c[0]))));
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  if (!opts?.action) throw new Error(`no Undo toast "${String(label)}"`);
  act(() => opts.action!.onClick());
}

const AT = "2026-11-20T09:00:00.000Z";
const item = (id: string, text: string, over: Partial<KickoffItem> = {}): KickoffItem => ({
  id,
  text,
  ...over,
});
const kickoff = (over: Partial<Kickoff> & Pick<Kickoff, "id" | "format">): Kickoff => ({
  title: "Payments liftoff",
  sections: {},
  status: "draft",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const goal: ProductGoal = {
  id: "goal_1",
  statement: "Shop owners take every payment on their own phone.",
  measures: [],
  status: "active",
  createdAt: AT,
  updatedAt: AT,
};

const seed = (...kickoffs: Kickoff[]) => useWorkspaceStore.setState({ kickoffs });

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <KickoffClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** Type into a field and press Enter. */
function enter(label: string, value: string) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key: "Enter" });
}
/** Blur-commit a field. */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}
/** Open a line's "Send to…" menu. */
function openSend(words: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name: words }), { key: "Enter" });
}
const startForm = () => screen.getByRole("button", { name: "Start the kickoff" }).closest("form")!;

beforeEach(() => {
  stubResizeObserver();
  logs.length = 0;
  cheers.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  window.history.replaceState(null, "", "/kickoff");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    kickoffs: [],
    teamMembers: [],
    productGoals: [],
    risks: [],
    stories: [],
    hypothesisTrackers: [],
    workingAgreements: [],
    opportunityTrees: [],
    rootCauseAnalyses: [],
    decisions: [],
  });
  useProductGoalPrefs.setState({ vision: "" });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the empty state and the example", () => {
  it("offers the six formats and the example; Load example and Clear example", () => {
    renderPage();
    expect(
      screen.getByText("No kickoff yet. Pick a format below, or load an example.")
    ).toBeInTheDocument();
    for (const name of [
      "Team Alignment Map",
      "Project Poster",
      "Team Canvas",
      "Inception deck",
      "Trade-off sliders",
      "Problem framing",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole("button", { name: /^Tap to pay on phones/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(rows()).toEqual([]);
    // The example is never logged.
    expect(logs).toEqual([]);
  });

  it("never sends the example's lines, and offers it no room", () => {
    seed(...buildExample());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Tap to pay on phones/ }));
    const send = screen.getAllByRole("button", { name: /^Send to…/ });
    expect(send.length).toBeGreaterThan(0);
    for (const b of send) expect(b).toBeDisabled();
    // The reason shows once in each section that sends, and once for the trade-offs.
    const [tap] = buildExample();
    const sending = KICKOFF_FORMAT_DEFS[tap.format].sections.filter(
      (d) => (d.routes ?? []).length > 0 && (tap.sections[d.id] ?? []).length > 0
    );
    expect(sending.length).toBeGreaterThan(1);
    expect(screen.getAllByText("Example lines aren't sent anywhere.")).toHaveLength(
      sending.length + 1
    );
    expect(screen.getByText(/the example keeps nothing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collect answers from phones" })).toBeNull();
  });
});

describe("starting a kickoff", () => {
  it("needs a format and a name", () => {
    expect(validateStart({ format: "", title: "", brief: "", date: "", participants: [] })).toEqual(
      {
        ok: false,
        errors: {
          format: "Pick a format.",
          title: "Name the kickoff: the team or the work it starts.",
        },
      }
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start the kickoff" }));
    expect(within(startForm()).getByText("Pick a format.")).toBeInTheDocument();
    expect(rows()).toEqual([]);
  });

  it("starts a Team Canvas with the team's people from the roster, examples left out", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana", role: "Product Owner" },
        { id: exampleId("m2"), name: "Example Eve", role: "Tester" },
        { id: "m3", name: "Bo" },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Team Canvas/ }));
    expect(screen.getByRole("button", { name: /^Team Canvas/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.change(within(startForm()).getByLabelText(/^Name/), {
      target: { value: "Checkout squad" },
    });
    fireEvent.change(within(startForm()).getByLabelText(/^Brief/), {
      target: { value: "A new squad for checkout." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start the kickoff" }));
    expect(rows()).toHaveLength(1);
    const k = byId(rows()[0].id);
    expect(k).toMatchObject({
      title: "Checkout squad",
      format: "team-canvas",
      brief: "A new squad for checkout.",
    });
    expect(k.sections.people.map((p) => [p.owner, p.text])).toEqual([
      ["Ana", "Product Owner"],
      ["Bo", ""],
    ]);
    expect(logs).toEqual([
      {
        action: KICKOFF_ACTIONS.KICKOFF_CREATED,
        payload: { kickoffId: k.id, format: "team-canvas" },
      },
    ]);
    expect(screen.getByText("Bo has no role yet.")).toBeInTheDocument();
  });

  it("starts an Inception deck with the default sliders to order", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Inception deck/ }));
    fireEvent.change(within(startForm()).getByLabelText(/^Name/), {
      target: { value: "Tap to pay" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start the kickoff" }));
    const list = screen.getByRole("list", { name: "Trade-offs, holds firm first" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      expect.stringMatching(/^1\. Scope/),
      expect.stringMatching(/^2\. Date/),
      expect.stringMatching(/^3\. Cost/),
      expect.stringMatching(/^4\. Quality/),
    ]);
  });

  it("starts another format from the same brief", () => {
    seed(
      kickoff({ id: "k1", format: "inception", title: "Tap to pay", brief: "Cards on phones." })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start another format from this brief" }));
    expect(within(startForm()).getByLabelText(/^Name/)).toHaveValue("Tap to pay");
    expect(within(startForm()).getByLabelText(/^Brief/)).toHaveValue("Cards on phones.");
    fireEvent.click(screen.getByRole("button", { name: /^Problem framing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start the kickoff" }));
    expect(
      rows()
        .map((k) => k.format)
        .sort()
    ).toEqual(["inception", "problem-framing"]);
  });
});

describe("filling it in", () => {
  it("adds, edits and deletes a line with Undo, logging the add", () => {
    seed(kickoff({ id: "k1", format: "alignment-map" }));
    renderPage();
    enter("Add to What we'll have done together", "A pilot in ten shops");
    expect(byId("k1").sections.objectives.map((i) => i.text)).toEqual(["A pilot in ten shops"]);
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.ITEM_ADDED,
      payload: { kickoffId: "k1", section: "objectives" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^A pilot in ten shops/ }));
    const editor = screen.getByLabelText("Line");
    fireEvent.change(editor, { target: { value: "A pilot in twelve shops" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(byId("k1").sections.objectives[0].text).toBe("A pilot in twelve shops");
    fireEvent.click(screen.getByRole("button", { name: "Delete “A pilot in twelve shops”" }));
    expect(byId("k1").sections.objectives).toEqual([]);
    undo("Deleted “A pilot in twelve shops”");
    expect(byId("k1").sections.objectives.map((i) => i.text)).toEqual(["A pilot in twelve shops"]);
  });

  it("says when a section is full, and keeps a single answer to one", () => {
    seed(
      kickoff({
        id: "k1",
        format: "trade-offs",
        sliders: [],
        sections: { notes: Array.from({ length: 8 }, (_, i) => item(`n${i}`, `Note ${i}`)) },
      })
    );
    renderPage();
    expect(screen.getByText(/This section is full: it holds 8/)).toBeInTheDocument();
    cleanup();
    seed(kickoff({ id: "k2", format: "alignment-map" }));
    renderPage();
    commit(screen.getByLabelText("Our aim, and by when"), "By spring, we take cards on phones.");
    expect(byId("k2").sections.mission.map((i) => i.text)).toEqual([
      "By spring, we take cards on phones.",
    ]);
  });

  it("takes a person and their role in one line, and an owner from the team", () => {
    expect(personFromText("Ana, Product Owner")).toMatchObject({
      owner: "Ana",
      text: "Product Owner",
    });
    expect(personFromText("Bo")).toMatchObject({ owner: "Bo", text: "" });
    seed(
      kickoff({ id: "k1", format: "team-canvas" }),
      kickoff({ id: "k2", format: "alignment-map", updatedAt: "2026-11-01T00:00:00.000Z" })
    );
    renderPage();
    enter("Add to Who's here and what they do", "Ana, Product Owner");
    expect(byId("k1").sections.people).toEqual([
      expect.objectContaining({ owner: "Ana", text: "Product Owner" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^Payments liftoff\s*Team Alignment Map/ }));
    enter("Add to Who carries which part", "Talk to the card partner");
    fireEvent.click(screen.getByRole("button", { name: "Owner: Nobody yet. Change" }));
    const field = screen.getByLabelText(/^Owner/);
    fireEvent.change(field, { target: { value: "Omar" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(byId("k2").sections.commitments[0]).toMatchObject({
      text: "Talk to the card partner",
      owner: "Omar",
    });
  });

  it("rates a worry, and links the section's tools that exist", () => {
    seed(
      kickoff({
        id: "k1",
        format: "inception",
        sections: { worries: [item("w1", "Certification is slow")] },
      })
    );
    renderPage();
    const likely = screen.getByRole("radiogroup", {
      name: "How likely is “Certification is slow”?",
    });
    fireEvent.click(within(likely).getByRole("radio", { name: "4" }));
    const bad = screen.getByRole("radiogroup", {
      name: "How bad would “Certification is slow” be?",
    });
    fireEvent.click(within(bad).getByRole("radio", { name: "5" }));
    expect(byId("k1").sections.worries[0]).toMatchObject({ likelihood: 4, impact: 5 });
    expect(screen.getByRole("link", { name: "Open Premortem Facilitator" })).toHaveAttribute(
      "href",
      "/premortem"
    );
    expect(screen.getByRole("link", { name: "Open Stakeholder Map" })).toBeInTheDocument();
  });

  it("covers a worry with a commitment or a resource, and flags one nothing covers", () => {
    seed(
      kickoff({
        id: "k1",
        format: "alignment-map",
        sections: { risks: [item("r1", "The partner is slow", { likelihood: 4, impact: 3 })] },
      })
    );
    renderPage();
    expect(screen.getByText("Nothing covers this yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing covers “The partner is slow” yet.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "What would take “The partner is slow” away?" })
    );
    fireEvent.click(screen.getByRole("button", { name: "a commitment" }));
    const field = screen.getByLabelText("Who will watch for this?");
    fireEvent.change(field, { target: { value: "Chase the partner weekly" } });
    fireEvent.click(screen.getByRole("button", { name: /Add a commitment/ }));
    expect(byId("k1").sections.commitments).toEqual([
      expect.objectContaining({ text: "Chase the partner weekly", covers: "r1" }),
    ]);
    expect(screen.queryByText("Nothing covers this yet.")).toBeNull();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" && /^Covered by: Chase the partner weekly/.test(el.textContent ?? "")
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Covers: The partner is slow")).toBeInTheDocument();
  });

  it("closes the cover's add with Cancel or Escape, and puts focus back on its button", () => {
    seed(
      kickoff({
        id: "k1",
        format: "inception",
        sections: { worries: [item("w1", "Certification is slow", { likelihood: 4, impact: 3 })] },
      })
    );
    renderPage();
    const trigger = () =>
      screen.getByRole("button", { name: "What would take “Certification is slow” away?" });
    fireEvent.click(trigger());
    // Inception covers with a need only: the field opens focused.
    const field = screen.getByLabelText("What would we need so this can't happen?");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "A partner contact" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(byId("k1").sections.needs ?? []).toEqual([]);
    fireEvent.click(trigger());
    // The words typed before Escape are gone.
    expect(screen.getByLabelText("What would we need so this can't happen?")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger()).toHaveFocus();
    fireEvent.click(trigger());
    fireEvent.change(screen.getByLabelText("What would we need so this can't happen?"), {
      target: { value: "A partner contact" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add a need/ }));
    expect(byId("k1").sections.needs).toEqual([
      expect.objectContaining({ text: "A partner contact", covers: "w1" }),
    ]);
    expect(trigger()).toHaveFocus();
  });

  it("puts a deleted worry back with Undo still covered, even after another edit", () => {
    seed(
      kickoff({
        id: "k1",
        format: "inception",
        sections: {
          worries: [item("w1", "Certification is slow", { likelihood: 4, impact: 3 })],
          needs: [item("n1", "A partner contact", { owner: "Omar", covers: "w1" })],
        },
      })
    );
    renderPage();
    expect(screen.getByText("Covers: Certification is slow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Certification is slow”" }));
    expect(byId("k1").sections.worries).toEqual([]);
    expect(screen.queryByText("Covers: Certification is slow")).toBeNull();
    // A write inside the Undo window reads the row without the worry.
    enter("Add to Definitely in", "Tap to pay in the app");
    expect(byId("k1").sections.needs[0].covers).toBe("w1");
    undo("Deleted “Certification is slow”");
    expect(byId("k1").sections.worries.map((w) => w.id)).toEqual(["w1"]);
    expect(byId("k1").sections.needs[0]).toMatchObject({ id: "n1", covers: "w1" });
    expect(screen.queryByText("Nothing covers this yet.")).toBeNull();
    expect(screen.queryByText("Nothing covers “Certification is slow” yet.")).toBeNull();
    expect(screen.getByText("Covers: Certification is slow")).toBeInTheDocument();
  });

  it("lists what's still open", () => {
    seed(
      kickoff({
        id: "k1",
        format: "problem-framing",
        sections: { who: [item("w", "[Which people]")] },
      })
    );
    renderPage();
    const open = screen.getByRole("list", { name: "What's still open" });
    expect(
      within(open).getByText("A line in “Who has the problem” still has [brackets] to fill in.")
    ).toBeInTheDocument();
    expect(
      within(open).getByText("Say what good looks like, so you'll know when it's solved.")
    ).toBeInTheDocument();
  });
});

describe("sending lines on", () => {
  it("keeps an unrated worry from the Risk Register, then sends it with its cover, owner and Undo", () => {
    seed(
      kickoff({
        id: "k1",
        format: "inception",
        sections: {
          worries: [item("w1", "Certification is slow", { likelihood: 4 })],
          needs: [item("n1", "A partner contact", { owner: "Omar", covers: "w1" })],
        },
      })
    );
    renderPage();
    expect(
      screen.getByText("Rate its impact before it goes to the Risk Register.")
    ).toBeInTheDocument();
    openSend(/^Send to… Certification is slow/);
    expect(screen.getByRole("menuitem", { name: "Risk Register" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    const bad = screen.getByRole("radiogroup", {
      name: "How bad would “Certification is slow” be?",
    });
    fireEvent.click(within(bad).getByRole("radio", { name: "5" }));
    const rated = byId("k1").updatedAt;
    openSend(/^Send to… Certification is slow/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Risk Register" }));
    expect(ws().risks).toEqual([
      expect.objectContaining({
        title: "Certification is slow",
        probability: 4,
        impact: 5,
        mitigation: "A partner contact",
        owner: "Omar",
        sourceRef: { tool: "kickoff", id: "w1", doc: "k1" },
      }),
    ]);
    expect(byId("k1").sections.worries[0].sentTo).toEqual([
      expect.objectContaining({ route: "risk", targetId: ws().risks![0].id }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.ITEM_SENT,
      payload: { kickoffId: "k1", section: "worries", route: "risk" },
    });
    // A send isn't a change to the words.
    expect(byId("k1").updatedAt).toBe(rated);
    openSend(/^Send to… Certification is slow \(sent\)/);
    expect(
      screen.getByRole("menuitem", { name: /Risk Register.*Sent · Open/ })
    ).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    undo(/Added to the Risk Register/);
    expect(ws().risks).toEqual([]);
    expect(byId("k1").sections.worries[0].sentTo).toBeUndefined();
  });

  it("won't send a line that still holds a [placeholder]", () => {
    seed(
      kickoff({
        id: "k1",
        format: "inception",
        sections: { "in-scope": [item("i1", "[Something we'll build]")] },
      })
    );
    renderPage();
    expect(
      screen.getByRole("button", { name: /^Send to… \[Something we'll build\]/ })
    ).toBeDisabled();
    expect(screen.getByText("Fill in the [brackets] before you send it.")).toBeInTheDocument();
  });

  it("sends scope to the backlog, an assumption to the tracker and a rule to the Working Agreement", () => {
    seed(
      kickoff({
        id: "k1",
        format: "inception",
        title: "Tap to pay",
        sections: { "in-scope": [item("i1", "Refund a tap payment")] },
      })
    );
    renderPage();
    openSend(/^Send to… Refund a tap payment/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Refund a tap payment",
        sourceRef: { tool: "kickoff", id: "i1", doc: "k1" },
      }),
    ]);
    cleanup();

    seed(
      kickoff({
        id: "k2",
        format: "project-poster",
        sections: { assumptions: [item("a1", "Sellers carry a phone with NFC")] },
      })
    );
    renderPage();
    openSend(/^Send to… Sellers carry a phone with NFC/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Hypothesis to test" }));
    const tracker = (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID);
    expect(tracker?.hypotheses).toEqual([
      expect.objectContaining({
        believe: "Sellers carry a phone with NFC",
        sourceRef: { tool: "kickoff", id: "a1", doc: "k2" },
      }),
    ]);
    cleanup();

    seed(
      kickoff({
        id: "k3",
        format: "team-canvas",
        sections: { rules: [item("r1", "We pair on payments")] },
      })
    );
    renderPage();
    openSend(/^Send to… We pair on payments/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Working Agreement rule" }));
    const wa = (ws().workingAgreements ?? []).find((d) => d.id === WA_ID);
    expect(wa?.rules).toEqual([
      expect.objectContaining({
        text: "We pair on payments",
        consent: [],
        sourceRef: { tool: "kickoff", id: "r1", doc: "k3" },
      }),
    ]);
    expect(byId("k3").sections.rules[0].sentTo?.[0].route).toBe("agreement-rule");
  });

  it("sends the problem statement as an opportunity or a root-cause analysis", () => {
    seed(
      kickoff({
        id: "k1",
        format: "problem-framing",
        sections: {
          evidence: [item("e1", "160 refund calls last month")],
          statement: [item("s1", "For buyers, refunds take a week.")],
        },
      })
    );
    renderPage();
    openSend(/^Send to… For buyers, refunds take a week\./);
    fireEvent.click(screen.getByRole("menuitem", { name: "Opportunity Tree" }));
    expect(ws().opportunityTrees?.[0].nodes).toEqual([
      expect.objectContaining({
        text: "For buyers, refunds take a week.",
        evidence: "160 refund calls last month",
      }),
    ]);
    openSend(/^Send to… For buyers, refunds take a week\. \(sent\)/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Root-cause analysis" }));
    expect(ws().rootCauseAnalyses).toEqual([
      expect.objectContaining({
        title: "For buyers, refunds take a week.",
        problem: "For buyers, refunds take a week.\n\nHow we know: 160 refund calls last month",
      }),
    ]);
    expect(
      byId("k1")
        .sections.statement[0].sentTo?.map((l) => l.route)
        .sort()
    ).toEqual(["opportunity", "root-cause"]);
  });
});

describe("the trade-off sliders", () => {
  const deck = () =>
    kickoff({
      id: "k1",
      format: "trade-offs",
      title: "Tap",
      sliders: [
        { id: "a", label: "Scope", position: 1 },
        { id: "b", label: "Date", position: 2 },
        { id: "c", label: "Cost", position: 3 },
      ],
    });

  it("moves with buttons named by the label, reads out the order and marks it set", async () => {
    seed(deck());
    renderPage();
    expect(
      screen.getByText("Put the trade-offs in order: nobody has set it yet.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Scope up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Scope down" }));
    const k = byId("k1");
    expect(k.sliders?.map((s) => [s.label, s.position])).toEqual([
      ["Date", 1],
      ["Scope", 2],
      ["Cost", 3],
    ]);
    expect(k.slidersSetAt).toBeTruthy();
    expect(
      await screen.findByText("Scope moved down. The order is now Date, then Scope, then Cost.")
    ).toBeInTheDocument();
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.SLIDERS_SET,
      payload: { kickoffId: "k1", count: 3 },
    });
    expect(screen.getByText("Holds firm: Date. Gives first: Cost.")).toBeInTheDocument();
  });

  it("confirms the order, adds a suggested trade-off and removes one with Undo", () => {
    seed(deck());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "This order is right" }));
    expect(byId("k1").slidersSetAt).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add “Easy to use”" }));
    expect(byId("k1").sliders?.at(-1)).toMatchObject({ label: "Easy to use", position: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Remove Date" }));
    expect(byId("k1").sliders?.map((s) => s.label)).toEqual(["Scope", "Cost", "Easy to use"]);
    undo("Removed “Date”");
    expect(byId("k1").sliders?.map((s) => s.label)).toEqual([
      "Scope",
      "Date",
      "Cost",
      "Easy to use",
    ]);
  });

  it("says why the order can't be sent with fewer than two trade-offs", () => {
    seed({ ...deck(), sliders: [{ id: "a", label: "Scope", position: 1 }] });
    renderPage();
    expect(screen.getByRole("button", { name: /^Send to… Trade-offs for Tap/ })).toBeDisabled();
    expect(
      screen.getByText("Add a second trade-off to send the order to the Decision Log.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add “Easy to use”" }));
    expect(screen.getByRole("button", { name: /^Send to… Trade-offs for Tap/ })).toBeEnabled();
    expect(screen.queryByText(/to send the order to the Decision Log/)).toBeNull();
  });

  it("sends the order to the Decision Log, the link kept on the kickoff", () => {
    seed(deck());
    renderPage();
    expect(screen.queryByText(/to send the order to the Decision Log/)).toBeNull();
    openSend(/^Send to… Trade-offs for Tap/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Decision Log" }));
    expect(ws().decisions).toEqual([
      expect.objectContaining({
        title: "Trade-offs for Tap",
        sourceRef: { tool: "kickoff", id: "k1:sliders", doc: "k1" },
      }),
    ]);
    expect(byId("k1").sentTo).toEqual([expect.objectContaining({ route: "decision" })]);
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.ITEM_SENT,
      payload: { kickoffId: "k1", section: "sliders", route: "decision" },
    });
  });
});

describe("problem framing", () => {
  const framing = () =>
    kickoff({
      id: "k1",
      format: "problem-framing",
      sections: {
        who: [item("w", "Buyers who return an item")],
        what: [item("x", "Their refund takes a week")],
        impact: [item("i", "Forty calls a week")],
        outcome: [item("o", "Buyers see their money the same day")],
      },
    });

  it("writes the statement with Use it, with Undo", () => {
    seed(framing());
    renderPage();
    const sentence = statementFrom(framing())!;
    expect(screen.getByText(sentence)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect(byId("k1").sections.statement.map((i) => i.text)).toEqual([sentence]);
    expect(screen.getByText("This is the statement now.")).toBeInTheDocument();
    undo("Wrote the problem statement");
    expect(byId("k1").sections.statement).toEqual([]);
  });

  it("adds starter questions, with Undo", () => {
    seed(framing());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add starter questions" }));
    expect(byId("k1").sections.hmw.map((i) => i.text)).toEqual([
      "How might we help buyers who return an item so that buyers see their money the same day?",
      "How might we change what happens today: their refund takes a week?",
      "How might we lower what it costs: forty calls a week?",
    ]);
    undo("Added 3 questions");
    expect(byId("k1").sections.hmw).toEqual([]);
  });
});

describe("Ask Amr, with no AI", () => {
  it("drafts from the brief: nothing is written until accepted; one, then all, each with Undo", async () => {
    const k = kickoff({
      id: "k1",
      format: "inception",
      title: "Tap",
      brief: "Take cards on phones. Soon.",
    });
    seed(k);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Draft without AI" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(byId("k1").sections).toEqual({});
    fireEvent.click(within(list).getByRole("button", { name: /^Add: Take cards on phones\./ }));
    expect(byId("k1").sections.why.map((i) => i.text)).toEqual(["Take cards on phones."]);
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.ITEMS_DRAFTED,
      payload: { kickoffId: "k1", source: "starter", count: 1 },
    });
    undo("Added 1 drafted line");
    expect(byId("k1").sections.why).toEqual([]);
    fireEvent.click(within(list).getByRole("button", { name: /^Add all/ }));
    const after = byId("k1");
    const expected = kickoffDraftFallback(kickoffDraftInputFor(k));
    // Every starter landed, with the extra sliders.
    expect(after.sections.pitch[0].text).toMatch(/\[who\]/);
    expect(after.sliders?.map((s) => s.label)).toEqual(expected.sliders);
    undo(/drafted lines/);
    expect(Object.values(byId("k1").sections).flat()).toEqual([]);
    expect(byId("k1").sliders).toEqual([]);
  });

  it("drafts starter lines with no brief, and leaves full sections out", async () => {
    seed(
      kickoff({
        id: "k1",
        format: "alignment-map",
        sections: { mission: [item("m", "By spring, we ship.")] },
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Draft without AI" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(within(list).queryByText("By [when], we will [what we'll have done].")).toBeNull();
    expect(within(list).getByText("[A result we can show]")).toBeInTheDocument();
    expect(within(list).getByText("What we'll have done together")).toBeInTheDocument();
  });

  it("is off with its reason once every section is full", () => {
    seed(
      kickoff({
        id: "k1",
        format: "trade-offs",
        sections: { notes: Array.from({ length: 8 }, (_, i) => item(`n${i}`, `Note ${i}`)) },
        sliders: Array.from({ length: 8 }, (_, i) => ({
          id: `s${i}`,
          label: `L${i}`,
          position: i + 1,
        })),
      })
    );
    renderPage();
    const button = screen.getByRole("button", { name: /Draft without AI/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

describe("agreeing", () => {
  it("logs and cheers in the same tick, notices a change after, and goes back to draft", () => {
    seed(
      kickoff({
        id: "k1",
        format: "alignment-map",
        sections: { objectives: [item("o", "A pilot")] },
      })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Agree it" }));
    expect(byId("k1")).toMatchObject({ status: "agreed" });
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.KICKOFF_AGREED,
      payload: { kickoffId: "k1", format: "alignment-map", count: 1 },
    });
    expect(cheers).toEqual([["kickoff", "agreed"]]);
    fireEvent.click(screen.getByRole("button", { name: "Back to draft" }));
    expect(byId("k1").status).toBe("draft");
    expect(byId("k1").agreedAt).toBeUndefined();
  });

  it("says when an agreed kickoff changed since", () => {
    seed(
      kickoff({
        id: "k1",
        format: "alignment-map",
        status: "agreed",
        agreedAt: "2026-11-01T09:00:00.000Z",
        updatedAt: "2026-11-01T09:00:00.000Z",
      })
    );
    renderPage();
    expect(screen.queryByText(/Changed since you agreed/)).toBeNull();
    enter("Add to What we'll have done together", "A pilot");
    expect(screen.getByText(/Changed since you agreed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agree again" })).toBeInTheDocument();
  });
});

describe("the page around it", () => {
  it("opens the kickoff ?kickoff= names, and drops the parameter", async () => {
    seed(
      kickoff({
        id: "k1",
        format: "alignment-map",
        title: "First",
        updatedAt: "2026-11-21T00:00:00.000Z",
      }),
      kickoff({ id: "k2", format: "trade-offs", title: "Second" })
    );
    window.history.replaceState(null, "", "/kickoff?kickoff=k2");
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Second/ })).toHaveAttribute(
        "aria-current",
        "true"
      )
    );
    expect(window.location.search).toBe("");
  });

  it("shows the active Product Goal, read only", () => {
    useWorkspaceStore.setState({ productGoals: [goal] });
    renderPage();
    expect(screen.getByText(goal.statement)).toBeInTheDocument();
  });

  it("exports the kickoff on screen as Markdown", () => {
    const [tap] = buildExample();
    seed(tap);
    renderPage();
    expect(exported.filename).toBe("kickoff-tap-to-pay-on-phones");
    expect(exported.markdown).toBe(kickoffToMarkdown(byId(tap.id), { today: todayIso() }));
    expect(exported.markdown).toContain("# Tap to pay on phones");
  });

  it("deletes a kickoff with Undo", () => {
    seed(kickoff({ id: "k1", format: "trade-offs", title: "Tap" }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete this kickoff" }));
    expect(rows()).toEqual([]);
    expect(logs.at(-1)).toEqual({
      action: KICKOFF_ACTIONS.KICKOFF_REMOVED,
      payload: { kickoffId: "k1", format: "trade-offs" },
    });
    undo("Deleted “Tap”");
    expect(rows().map((k) => k.id)).toEqual(["k1"]);
  });
});
