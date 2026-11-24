import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ExampleMap, Story } from "@/lib/stores/workspace-types";
import { useDockTimer } from "@/lib/timer/dock-timer";

/**
 * Example Mapping on workspace.exampleMaps: the empty state and the
 * example (loaded, cleared, never sent), starting a map from a backlog
 * story or a typed one (and from `?story=` / `?map=`), Enter adding rules,
 * examples and questions, Given/When/Then checked before it is saved,
 * deletes with Undo (a rule takes its examples), the caps, the timebox on
 * the docked timer (and whose timer holds it), what the map says, the
 * verdict and the Quick Vote link, "Send to the story" with one Undo,
 * "Add to backlog" linking the map and its Undo unlinking it, "Split by
 * rule" with one Undo and a second split, the suggestions without AI, the
 * export, and no non-error toasts.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
const lastUndo = () => undo.all[undo.all.length - 1];
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: (...args: unknown[]) => cheers.push(args) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/example-mapping",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

import { ExampleMappingClient } from "@/app/(tools)/example-mapping/example-mapping-client";
import { EXAMPLE_MAPPING_ACTIONS } from "@/lib/history/event-actions";
import { fallbackRules } from "@/lib/ai/tasks/example-mapping.lite";
import { exampleMappingSteps } from "@/lib/example-mapping/next-steps";

const ws = () => useWorkspaceStore.getState();
const maps = () => ws().exampleMaps ?? [];
const stored = (id = "exmap_a") => maps().find((m) => m.id === id);
const storyById = (id: string) => ws().stories.find((s) => s.id === id);
const actions = () => logs.map((l) => l.action);

const map = (over: Partial<ExampleMap> = {}): ExampleMap => ({
  id: "exmap_a",
  title: "Pay with a saved card",
  rules: [],
  examples: [],
  questions: [],
  timeboxMinutes: 25,
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T09:00:00.000Z",
  ...over,
});
const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});
const twoRules = () =>
  map({
    rules: [
      { id: "r1", text: "An expired card is refused" },
      { id: "r2", text: "Only the holder saves a card" },
    ],
    examples: [
      {
        id: "e1",
        ruleId: "r1",
        text: "Maria's card expired",
        given: "an expired card",
        when: "Maria pays",
        then: "it is refused",
      },
      { id: "e2", ruleId: "r2", text: "Ana saves her own card" },
    ],
  });

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <ExampleMappingClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

const announced = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(text));

const type = (name: string | RegExp, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
const submitWith = (name: string | RegExp, value: string) => {
  const box = screen.getByRole("textbox", { name });
  fireEvent.change(box, { target: { value } });
  fireEvent.submit(box.closest("form")!);
};

beforeEach(() => {
  undo.all = [];
  logs.length = 0;
  cheers.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  toastSpy.success.mockClear();
  toastSpy.info.mockClear();
  window.history.replaceState(null, "", "/example-mapping");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({ exampleMaps: [], stories: [] });
  useDockTimer.setState({ timer: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Never a non-error toast: Undo comes from undoable, the rest is inline.
  expect(toastSpy).not.toHaveBeenCalled();
  expect(toastSpy.success).not.toHaveBeenCalled();
  expect(toastSpy.info).not.toHaveBeenCalled();
});

describe("an empty page", () => {
  it("says what a map is for and offers the example", () => {
    renderPage();
    expect(screen.getByText(/No maps yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const example = maps()[0];
    expect(example.id.startsWith("example-")).toBe(true);
    expect(example.rules).toHaveLength(3);
    expect(example.examples).toHaveLength(7);
    expect(example.examples.filter((e) => e.given)).toHaveLength(4);
    expect(example.questions.map((q) => q.status)).toEqual(["open", "answered"]);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    // An example map is never sent, and its work isn't logged.
    expect(screen.queryByRole("button", { name: "Add to backlog" })).toBeNull();
    expect(screen.getByText(/The example map stays here/)).toBeInTheDocument();
    expect(logs).toEqual([]);
  });

  it("clears the example with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(maps()).toEqual([]);
    act(() => lastUndo().revert());
    expect(maps()).toHaveLength(1);
  });
});

describe("starting a map", () => {
  it("maps a backlog story picked from the list", async () => {
    useWorkspaceStore.setState({
      stories: [story(), story({ id: "st2", title: "Refund", status: "done" })],
    });
    renderPage();
    const select = screen.getByRole("combobox", { name: "A story from the backlog" });
    expect(within(select).queryByRole("option", { name: "Refund" })).toBeNull();
    fireEvent.change(select, { target: { value: "st1" } });
    fireEvent.click(screen.getByRole("button", { name: "Start the map" }));
    expect(maps()[0]).toMatchObject({
      title: "Pay with a saved card",
      storyId: "st1",
      timeboxMinutes: 25,
    });
    expect(logs[0]).toMatchObject({
      action: EXAMPLE_MAPPING_ACTIONS.MAP_CREATED,
      payload: { storyId: "st1" },
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "A rule the story must follow" })
      )
    );
  });

  it("maps a typed story, and refuses a blank one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start the map" }));
    expect(screen.getByText("Pick a story or type one.")).toBeInTheDocument();
    expect(maps()).toEqual([]);
    type("The story", "Split the bill");
    fireEvent.click(screen.getByRole("button", { name: "Start the map" }));
    expect(maps()[0]).toMatchObject({ title: "Split the bill" });
    expect(maps()[0].storyId).toBeUndefined();
  });

  it("opens a story's map from ?story=, starting one when there is none", async () => {
    useWorkspaceStore.setState({ stories: [story()] });
    window.history.replaceState(null, "", "/example-mapping?story=st1");
    renderPage();
    await waitFor(() => expect(maps()).toHaveLength(1));
    expect(maps()[0].storyId).toBe("st1");
    expect(window.location.search).toBe("");
  });

  it("opens a map from ?map=", async () => {
    useWorkspaceStore.setState({
      exampleMaps: [
        map(),
        map({ id: "exmap_b", title: "Refund", updatedAt: "2026-11-19T09:00:00.000Z" }),
      ],
    });
    window.history.replaceState(null, "", "/example-mapping?map=exmap_b");
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Refund\. Rename the story/ })).toBeInTheDocument()
    );
  });
});

describe("cards", () => {
  beforeEach(() => useWorkspaceStore.setState({ exampleMaps: [map()] }));

  it("adds a rule on Enter, then an example under it and a question about it", async () => {
    renderPage();
    submitWith("A rule the story must follow", "An expired card is refused");
    expect(stored()!.rules.map((r) => r.text)).toEqual(["An expired card is refused"]);
    await announced("Added the rule “An expired card is refused”");
    submitWith(/^An example of/, "Maria's card expired in October");
    expect(stored()!.examples[0]).toMatchObject({ text: "Maria's card expired in October" });
    type("A question nobody can answer yet", "Business accounts?");
    fireEvent.change(screen.getByRole("combobox", { name: "About the rule" }), {
      target: { value: stored()!.rules[0].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(stored()!.questions[0]).toMatchObject({
      text: "Business accounts?",
      ruleId: stored()!.rules[0].id,
    });
    expect(actions()).toEqual([
      EXAMPLE_MAPPING_ACTIONS.RULE_ADDED,
      EXAMPLE_MAPPING_ACTIONS.EXAMPLE_ADDED,
      EXAMPLE_MAPPING_ACTIONS.QUESTION_ADDED,
    ]);
    // Payloads hold ids and counts, never the words.
    expect(JSON.stringify(logs)).not.toContain("expired");
  });

  it("adds nothing blank", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.getByText("Write the rule.")).toBeInTheDocument();
    expect(stored()!.rules).toEqual([]);
  });

  it("deletes a rule with its examples, and Undo brings both back", () => {
    useWorkspaceStore.setState({ exampleMaps: [twoRules()] });
    renderPage();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete the rule “An expired card is refused” and its examples",
      })
    );
    expect(stored()!.rules.map((r) => r.id)).toEqual(["r2"]);
    expect(stored()!.examples.map((e) => e.id)).toEqual(["e2"]);
    expect(lastUndo().label).toBe("Deleted the rule “An expired card is refused” and 1 example");
    act(() => lastUndo().revert());
    expect(stored()!.rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(stored()!.examples.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("deletes an example and a question with Undo", () => {
    useWorkspaceStore.setState({
      exampleMaps: [{ ...twoRules(), questions: [{ id: "q1", text: "Who?", status: "open" }] }],
    });
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete the example “Ana saves her own card”" })
    );
    expect(stored()!.examples.map((e) => e.id)).toEqual(["e1"]);
    act(() => lastUndo().revert());
    expect(stored()!.examples.map((e) => e.id)).toEqual(["e1", "e2"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete the question “Who?”" }));
    expect(stored()!.questions).toEqual([]);
    act(() => lastUndo().revert());
    expect(stored()!.questions.map((q) => q.id)).toEqual(["q1"]);
  });

  it("checks Given, When and Then before it saves them", () => {
    useWorkspaceStore.setState({ exampleMaps: [twoRules()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Write as Given, When, Then: Ana saves/ }));
    type("Given", "Ana is signed in");
    fireEvent.click(screen.getByRole("button", { name: "Save Given, When, Then" }));
    expect(screen.getByText("Write the “When” part.")).toBeInTheDocument();
    expect(stored()!.examples[1].given).toBeUndefined();
    type("When", "she saves her card");
    type("Then", "it is on her account");
    fireEvent.click(screen.getByRole("button", { name: "Save Given, When, Then" }));
    expect(stored()!.examples[1]).toMatchObject({
      given: "Ana is signed in",
      then: "it is on her account",
    });
  });

  it("stops at the caps and says so", () => {
    useWorkspaceStore.setState({
      exampleMaps: [
        map({ rules: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, text: `Rule ${i}` })) }),
      ],
    });
    renderPage();
    expect(screen.queryByRole("textbox", { name: "A rule the story must follow" })).toBeNull();
    expect(screen.getByText(/A map holds 12 rules at most/)).toBeInTheDocument();
  });

  it("answers a question, then makes the answer a rule", () => {
    useWorkspaceStore.setState({
      exampleMaps: [
        map({ questions: [{ id: "q1", text: "How long is a session?", status: "open" }] }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Answer it: How long is a session?" }));
    type("Answer", "Twelve hours");
    fireEvent.click(screen.getByRole("button", { name: "Save the answer" }));
    expect(stored()!.questions[0]).toMatchObject({ status: "answered", answer: "Twelve hours" });
    expect(logs.at(-1)).toMatchObject({
      action: EXAMPLE_MAPPING_ACTIONS.QUESTION_ANSWERED,
      payload: { questionId: "q1", status: "answered" },
    });
    // The last open question answered: Amr cheers.
    expect(cheers).toEqual([["example-mapping", "done"]]);
    fireEvent.click(screen.getByRole("button", { name: "Make it a rule: How long is a session?" }));
    expect(stored()!.rules.map((r) => r.text)).toEqual(["Twelve hours"]);
  });
});

describe("the timebox", () => {
  beforeEach(() => useWorkspaceStore.setState({ exampleMaps: [map()] }));

  it("puts the map's timebox on the docked timer", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start the 25-minute timebox" }));
    expect(useDockTimer.getState().timer).toMatchObject({
      href: "/example-mapping",
      totalSeconds: 25 * 60,
      label: "Example Mapping · Pay with a saved card",
    });
    expect(screen.getByRole("timer")).toHaveTextContent("25:00");
  });

  it("never replaces another page's timer, and says whose it is", () => {
    useDockTimer.setState({
      timer: {
        label: "Standup",
        href: "/standup",
        totalSeconds: 900,
        endsAt: null,
        pausedRemaining: 900,
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start the 25-minute timebox" }));
    expect(useDockTimer.getState().timer?.href).toBe("/standup");
    expect(screen.getByText(/The “Standup” timer is running/)).toBeInTheDocument();
  });
});

describe("what the map says and deciding", () => {
  it("reads the cards: a rule with no example, and looks ready once each has one", () => {
    useWorkspaceStore.setState({
      exampleMaps: [map({ rules: [{ id: "r1", text: "Refuse expired cards" }] })],
    });
    renderPage();
    const says = screen.getByRole("list", { name: "What the map says" });
    expect(says).toHaveTextContent("“Refuse expired cards” has no example yet");
    submitWith(/^An example of/, "Maria's card expired");
    expect(screen.getByRole("list", { name: "What the map says" })).toHaveTextContent(
      "it looks ready"
    );
  });

  it("sets the verdict and links Ask the room to a Quick Vote poll", () => {
    useWorkspaceStore.setState({ exampleMaps: [map()] });
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Split by rule" }));
    expect(stored()!.verdict).toBe("split");
    expect(logs.at(-1)).toMatchObject({
      action: EXAMPLE_MAPPING_ACTIONS.VERDICT_SET,
      payload: { verdict: "split" },
    });
    const href = screen
      .getByRole("link", { name: "Ask the room in Quick Vote" })
      .getAttribute("href")!;
    const params = new URLSearchParams(href.split("#")[1]);
    expect(href.startsWith("/quick-vote#")).toBe(true);
    expect(params.get("question")).toBe("Is this story ready to build?");
    expect(params.get("options")).toBe("Ready\nNot yet: open questions\nSplit it first");
  });
});

describe("sending", () => {
  it("sends the rules and Given/When/Then examples to the story, with one Undo", () => {
    useWorkspaceStore.setState({
      stories: [
        story({ acceptanceCriteria: "- Charged once", refinedAt: "2026-11-01T00:00:00.000Z" }),
      ],
      exampleMaps: [{ ...twoRules(), storyId: "st1" }],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Send to the story" }));
    const s = storyById("st1")!;
    expect(s.acceptanceCriteria).toBe(
      "- Charged once\n- An expired card is refused\n- Only the holder saves a card"
    );
    expect(s.gwt).toHaveLength(1);
    expect(stored()!.sentAt).toBeTruthy();
    expect(
      screen
        .getAllByRole("status")
        .some((el) => /^Sent 2 rules and 1 example/.test(el.textContent ?? ""))
    ).toBe(true);
    expect(logs.at(-1)).toMatchObject({
      action: EXAMPLE_MAPPING_ACTIONS.SENT_TO_STORY,
      payload: { storyId: "st1", lines: 3 },
    });
    act(() => lastUndo().revert());
    const back = storyById("st1")!;
    expect(back.acceptanceCriteria).toBe("- Charged once");
    expect(back.gwt).toBeUndefined();
    expect(back.refinedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(stored()!.sentAt).toBeUndefined();
  });

  it("records a send when the story already has everything, so the next step moves on", () => {
    // Rules that came from the story's own criteria, and one-line examples only.
    useWorkspaceStore.setState({
      stories: [story({ acceptanceCriteria: "- An expired card is refused" })],
      exampleMaps: [
        map({
          storyId: "st1",
          verdict: "ready",
          rules: [{ id: "r1", text: "An expired card is refused" }],
          examples: [{ id: "e1", ruleId: "r1", text: "Maria's card expired" }],
        }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Send to the story" }));
    expect(
      screen
        .getAllByRole("status")
        .some((el) => /already has these rules/.test(el.textContent ?? ""))
    ).toBe(true);
    expect(storyById("st1")!.acceptanceCriteria).toBe("- An expired card is refused");
    expect(stored()!.sentAt).toBeTruthy();
    // Nothing was sent: no Undo, no history.
    expect(undo.all).toEqual([]);
    expect(actions()).not.toContain(EXAMPLE_MAPPING_ACTIONS.SENT_TO_STORY);
    const steps = exampleMappingSteps({ maps: maps(), stories: ws().stories });
    expect(steps.map((s) => s.id)).toEqual(["example-mapping-size-story"]);
  });

  it("adds a typed story to the backlog and links the map; Undo unlinks it", () => {
    useWorkspaceStore.setState({ exampleMaps: [twoRules()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    const linked = stored()!.storyId!;
    expect(storyById(linked)).toMatchObject({
      title: "Pay with a saved card",
      sourceRef: { tool: "example-mapping", id: "exmap_a", doc: "exmap_a" },
    });
    // Title only: the rules go through "Send to the story", once.
    expect(storyById(linked)?.notes).toBeUndefined();
    expect(screen.getByRole("button", { name: "Send to the story" })).toBeInTheDocument();
    act(() => lastUndo().revert());
    expect(stored()!.storyId).toBeUndefined();
    expect(storyById(linked)).toBeUndefined();
  });

  it("splits picked rules into stories with one Undo, then splits another", () => {
    useWorkspaceStore.setState({
      exampleMaps: [
        {
          ...twoRules(),
          rules: [...twoRules().rules, { id: "r3", text: "The CVC is asked once" }],
        },
      ],
    });
    renderPage();
    const pick = screen.getByRole("checkbox", { name: "An expired card is refused" });
    // A 44 px row on touch screens, not just the 16 px box.
    expect(pick.closest("label")).toHaveClass("flex", "min-h-11");
    fireEvent.click(pick);
    fireEvent.click(screen.getByRole("checkbox", { name: "Only the holder saves a card" }));
    fireEvent.click(screen.getByRole("button", { name: "Split 2 rules into stories" }));
    const made = ws().stories;
    expect(made.map((s) => s.title)).toEqual([
      "Pay with a saved card: An expired card is refused",
      "Pay with a saved card: Only the holder saves a card",
    ]);
    expect(made[0]).toMatchObject({
      notes: "- Maria's card expired",
      sourceRef: { tool: "example-mapping", id: "r1", doc: "exmap_a" },
    });
    expect(actions().filter((a) => a === EXAMPLE_MAPPING_ACTIONS.SPLIT_BY_RULE)).toHaveLength(2);
    // Split rules are no longer offered; the third still is.
    expect(screen.queryByRole("checkbox", { name: "An expired card is refused" })).toBeNull();
    expect(screen.getAllByText(/split already/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "The CVC is asked once" }));
    fireEvent.click(screen.getByRole("button", { name: "Split into a story" }));
    expect(ws().stories).toHaveLength(3);
    act(() => undo.all[undo.all.length - 2].revert());
    expect(ws().stories.map((s) => s.title)).toEqual([
      "Pay with a saved card: The CVC is asked once",
    ]);
    expect(stored()!.rules.filter((r) => r.sentTo?.length)).toHaveLength(1);
  });

  it("adds a typed story to the backlog, then splits a rule from it", () => {
    useWorkspaceStore.setState({ exampleMaps: [twoRules()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Only the holder saves a card" }));
    fireEvent.click(screen.getByRole("button", { name: "Split into a story" }));
    expect(ws().stories).toHaveLength(2);
    expect(stored()!.sentTo).toHaveLength(1);
    expect(stored()!.rules[1].sentTo).toHaveLength(1);
  });
});

describe("Amr's help, and the export", () => {
  it("suggests rules without AI; an accepted one is added with Undo", () => {
    useWorkspaceStore.setState({
      stories: [story({ acceptanceCriteria: "- The CVC is asked once per session" })],
      exampleMaps: [map({ storyId: "st1" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest rules without AI" }));
    const [first] = fallbackRules({
      title: "Pay with a saved card",
      notes: "",
      criteria: "- The CVC is asked once per session",
      rules: [],
    }).rules;
    fireEvent.click(screen.getByRole("button", { name: `Add: ${first.text}` }));
    expect(stored()!.rules.map((r) => r.text)).toEqual([first.text]);
    act(() => lastUndo().revert());
    expect(stored()!.rules).toEqual([]);
  });

  it("says why an accepted rule wasn't added to a full map, with no Undo claiming it was", () => {
    const rules = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, text: `Rule ${i}` }));
    useWorkspaceStore.setState({
      stories: [story({ acceptanceCriteria: "- The CVC is asked once per session" })],
      exampleMaps: [map({ storyId: "st1", rules })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest rules without AI" }));
    const [first] = fallbackRules({
      title: "Pay with a saved card",
      notes: "",
      criteria: "- The CVC is asked once per session",
      rules: rules.map((r) => r.text),
    }).rules;
    fireEvent.click(screen.getByRole("button", { name: `Add: ${first.text}` }));
    expect(stored()!.rules).toHaveLength(12);
    expect(undo.all).toEqual([]);
    expect(
      screen
        .getAllByRole("status")
        .some((el) => /A map holds 12 rules at most/.test(el.textContent ?? ""))
    ).toBe(true);
  });

  it("suggests examples for a rule without AI, keeping Given/When/Then", () => {
    useWorkspaceStore.setState({
      exampleMaps: [map({ rules: [{ id: "r1", text: "Refuse expired cards" }] })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest examples without AI" }));
    const add = screen.getAllByRole("button", { name: /^Add: The rule/ })[0];
    fireEvent.click(add);
    expect(stored()!.examples[0]).toMatchObject({
      when: "someone tries anyway",
      then: "they are stopped and told why",
    });
  });

  it("exports the map as Markdown", () => {
    useWorkspaceStore.setState({ exampleMaps: [twoRules()] });
    renderPage();
    expect(exported.markdown).toContain("# Example map: Pay with a saved card");
    expect(exported.markdown).toContain("1. An expired card is refused");
    expect(exported.markdown).toContain("     - Given an expired card");
    expect(exported.markdown).toContain("## What the map says");
  });

  it("deletes the map with Undo", () => {
    useWorkspaceStore.setState({ exampleMaps: [map()] });
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete the map of “Pay with a saved card”" })
    );
    expect(maps()).toEqual([]);
    expect(actions()).toEqual([EXAMPLE_MAPPING_ACTIONS.MAP_REMOVED]);
    act(() => lastUndo().revert());
    expect(maps()).toHaveLength(1);
  });
});
