import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { MIXER_INITIAL, type MixerState } from "@/lib/team-mixer/state";
import { readMixer, useTeamMixerStore } from "@/lib/team-mixer/store";
import { addPeople } from "@/lib/team-mixer/ops";
import { pairKey } from "@/lib/team-mixer/model";
import { TEAM_MIXER_ACTIONS } from "@/lib/history/event-actions";

/**
 * Team Mixer, the new tool (tools plan, phase 1): who is in the mix (the
 * roster, typed or pasted names), groups by size or count, pairs with a
 * trio or a sit-out, World Café tables, balance by role or skill from the
 * Team page, keep-apart and keep-together rules, rounds that avoid earlier
 * pairings, moving someone and naming the groups after a mix (built-in
 * names, or Picker's AI task where it's on: a theme and a count only), a
 * live room that shows the groups, Undo on every removal, the example, the
 * Markdown export and the history log, which never names anyone.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() })
);
const spies = vi.hoisted(() => ({
  log: vi.fn(),
  cheer: vi.fn(),
  show: vi.fn<(kind: string, payload: unknown) => boolean>(() => true),
  aiInput: vi.fn(),
}));
const aiHolder = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/team-mixer",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, filename }: { markdown?: string; filename: string }) => (
    <pre data-testid={`export-${filename}`}>{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log, toolRunId: "test" }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: spies.cheer }));
// The live room, as the kit hands it to the tool once it's open.
vi.mock("@/components/collab/show-room", () => ({
  ShowRoomHost: ({ children }: { children?: (room: unknown) => ReactNode }) => (
    <div data-testid="show-room">{children?.({ status: "live", show: spies.show })}</div>
  ),
}));
vi.mock("@/app/(tools)/team-mixer/group-name-task", () => ({
  get GROUP_NAME_AI() {
    return aiHolder.value;
  },
}));
vi.mock("@/components/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ai")>();
  return {
    ...actual,
    // Stands in for Ask Amr: records the input the task would get, answers with names.
    AiButton: ({
      label,
      input,
      onResult,
    }: {
      label: string;
      input: () => unknown;
      onResult: (data: unknown, meta: { source: "ai" }) => void;
    }) => (
      <button
        type="button"
        onClick={() => {
          spies.aiInput(input());
          onResult({ names: ["Comet", "Nebula", "Quasar"] }, { source: "ai" });
        }}
      >
        {label}
      </button>
    ),
  };
});

import { TeamMixerClient } from "@/app/(tools)/team-mixer/team-mixer-client";
import { EXAMPLE_PEOPLE, EXAMPLE_TITLE, buildExample } from "@/app/(tools)/team-mixer/example";
import { toMarkdown } from "@/app/(tools)/team-mixer/markdown";
import { validateWhole } from "@/app/(tools)/team-mixer/fields";
import { generateTeamMixerPrompts } from "@/lib/ai-prompts/team-mixer";

const ROSTER: TeamMember[] = [
  { id: "m1", name: "Ana", role: "Developer", skills: ["React"] },
  { id: "m2", name: "Bo", role: "Developer" },
  { id: "m3", name: "Cy", role: "Tester" },
  { id: "m4", name: "Dee", role: "Tester" },
];

const SIX = ["Ana", "Bo", "Cy", "Dee", "Eve", "Fay"];

function seed(names: string[], over: Partial<MixerState> = {}) {
  let n = 0;
  const s = addPeople({ ...MIXER_INITIAL, ...over }, names, [], () => `p${++n}`).state;
  useTeamMixerStore.setState(s);
}

const state = () => readMixer();
const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <TeamMixerClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );
async function mount() {
  const view = renderPage();
  await screen.findByRole("heading", { name: /How to mix/ });
  return view;
}
const undoOf = (label: string | RegExp) => {
  const call = [...toastSpy.mock.calls]
    .reverse()
    .find((c) => (typeof label === "string" ? c[0] === label : label.test(String(c[0]))));
  expect(call, `toast "${label}"`).toBeTruthy();
  return () => act(() => (call![1] as { action: { onClick: () => void } }).action.onClick());
};
const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });
const mixButton = () => screen.getByRole("button", { name: /^(Mix|Plan)/ });
const loggedNames = () =>
  JSON.stringify(spies.log.mock.calls.map((c) => c[1])).match(/Ana|Bo|Cy|Dee|Eve|Fay/);

beforeEach(() => {
  toastSpy.mockReset();
  spies.log.mockReset();
  spies.cheer.mockReset();
  spies.show.mockClear();
  spies.aiInput.mockReset();
  aiHolder.value = null;
  localStorage.clear();
  useTeamMixerStore.setState({ ...MIXER_INITIAL });
  useWorkspaceStore.setState({ teamMembers: [] });
});

// ─────────────────────────────────────────────────────────────
describe("the example and the empty page", () => {
  it("starts empty, with a way to load the example", async () => {
    await mount();
    expect(screen.getByText(/Nobody in the mix yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(state().people.map((p) => p.name)).toEqual([...EXAMPLE_PEOPLE]);
    expect(state().rules).toHaveLength(2);
    expect(state().rounds).toHaveLength(1);
    expect(await screen.findByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Round 1: 3 groups/ })).toBeInTheDocument();
  });

  it("clears only the example's rows", async () => {
    useTeamMixerStore.setState(buildExample(new Date()));
    useTeamMixerStore.setState((s) => ({
      people: [...s.people, { id: "mine", name: "Zed" }],
    }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(state().people.map((p) => p.name)).toEqual(["Zed"]);
    expect(state().rules).toEqual([]);
    expect(state().rounds).toEqual([]);
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });

  it("keeps the example's rules in its first round", () => {
    const ex = buildExample(new Date());
    const groups = ex.rounds[0].groups.map((g) => g.people);
    const at = (n: string) => groups.findIndex((g) => g.includes(n));
    expect(at("Amira")).not.toBe(at("Ben"));
    expect(at("Chen")).toBe(at("Dana"));
    expect(ex.title).toBe(EXAMPLE_TITLE);
  });
});

describe("who is in the mix", () => {
  it("adds a typed name and everyone on the team, each once", async () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    await mount();
    const box = screen.getByRole("combobox", { name: "People in the mix" });
    fireEvent.change(box, { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to People in the mix" }));
    expect(state().people.map((p) => p.name)).toEqual(["Zed"]);
    fireEvent.click(screen.getByRole("button", { name: /Add everyone on the team \(4\)/ }));
    expect(state().people.map((p) => p.name)).toEqual(["Zed", "Ana", "Bo", "Cy", "Dee"]);
    expect(screen.getByText("Added 4 people.")).toBeInTheDocument();
    // Nobody joins the Team page from here.
    expect(useWorkspaceStore.getState().teamMembers).toHaveLength(4);
  });

  it("adds a pasted list", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Paste a list of names" }));
    fireEvent.change(screen.getByLabelText(/Names, one per line/), {
      target: { value: "Ana\nBo, Cy\n- Dee\nana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add these names" }));
    expect(state().people.map((p) => p.name)).toEqual(["Ana", "Bo", "Cy", "Dee"]);
    expect(screen.getByText("Added 4 people.")).toBeInTheDocument();
  });

  it("takes someone out with Undo, and clears the list with Undo", async () => {
    seed(SIX);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove Cy" }));
    expect(state().people.map((p) => p.name)).not.toContain("Cy");
    undoOf("Took Cy out of the mix")();
    expect(state().people.map((p) => p.name)).toEqual(SIX);
    fireEvent.click(screen.getByRole("button", { name: "Clear the list" }));
    expect(state().people).toEqual([]);
    undoOf("Cleared 6 people from the mix")();
    expect(state().people).toHaveLength(6);
  });

  it("says how many can be balanced from the Team page", async () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    seed(SIX);
    await mount();
    expect(screen.getByText(/4 of 6 have a role or skills on the Team page/)).toBeInTheDocument();
  });
});

describe("mixing groups", () => {
  it("mixes groups of the size asked, saves the round and logs no names", async () => {
    seed(SIX, { size: 3 });
    await mount();
    expect(screen.getByText("2 groups of 3.")).toBeInTheDocument();
    fireEvent.click(mixButton());
    const round = state().rounds[0];
    expect(round.groups.map((g) => g.people.length)).toEqual([3, 3]);
    expect(screen.getByRole("heading", { name: "Round 1: 2 groups" })).toBeInTheDocument();
    expect(spies.log).toHaveBeenCalledWith(
      TEAM_MIXER_ACTIONS.GROUPS_MIXED,
      expect.objectContaining({ mode: "groups", groups: 2, size: 3, round: 1, broken: 0 })
    );
    expect(loggedNames()).toBeNull();
    expect(spies.cheer).toHaveBeenCalledWith("team-mixer", "result");
    expect(screen.getByRole("button", { name: "Mix the next round" })).toBeInTheDocument();
  });

  it("splits into a number of groups", async () => {
    seed(SIX);
    await mount();
    fireEvent.click(radio("Split by", "Number of groups"));
    fireEvent.change(screen.getByLabelText("Number of groups"), { target: { value: "3" } });
    expect(state().split).toBe("count");
    expect(state().count).toBe(3);
    fireEvent.click(mixButton());
    expect(state().rounds[0].groups).toHaveLength(3);
  });

  it("refuses a size it can't use instead of saving a default", async () => {
    seed(SIX);
    await mount();
    fireEvent.change(screen.getByLabelText("People in each group"), { target: { value: "1" } });
    expect(screen.getByText("Enter a whole number from 2 to 60.")).toBeInTheDocument();
    expect(state().size).toBe(4);
    fireEvent.change(screen.getByLabelText("People in each group"), { target: { value: "" } });
    expect(screen.getByText("Enter a number from 2 to 60.")).toBeInTheDocument();
    expect(validateWhole("3", 2, 60)).toEqual({ ok: true, value: 3 });
    expect(validateWhole("2.5", 2, 60).ok).toBe(false);
  });

  it("says plainly what stops a mix, and saves nothing", async () => {
    seed(["Ana"]);
    await mount();
    expect(screen.getByText("Add at least 2 people to mix.")).toBeInTheDocument();
    fireEvent.click(mixButton());
    expect(state().rounds).toEqual([]);
    expect(spies.log).not.toHaveBeenCalled();
  });

  it("keeps the title with the round, saved when the field is left", async () => {
    seed(SIX);
    await mount();
    const title = screen.getByLabelText(/What are the groups for/);
    fireEvent.change(title, { target: { value: "Retro breakouts " } });
    fireEvent.blur(title);
    expect(state().title).toBe("Retro breakouts");
    fireEvent.click(mixButton());
    expect(state().rounds[0].title).toBe("Retro breakouts");
    expect(screen.getAllByText("Retro breakouts").length).toBeGreaterThan(0);
  });
});

describe("pairs and fresh company", () => {
  it("pairs people, and the next round pairs nobody twice", async () => {
    seed(SIX);
    await mount();
    fireEvent.click(radio("Mix into", "Pairs"));
    expect(screen.getByText("3 pairs.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mix pairs" }));
    fireEvent.click(screen.getByRole("button", { name: "Mix the next round" }));
    const [first, second] = state().rounds;
    const before = new Set(first.groups.map((g) => pairKey(g.people[0], g.people[1])));
    for (const g of second.groups)
      expect(before.has(pairKey(g.people[0], g.people[1]))).toBe(false);
    expect(screen.getByRole("heading", { name: "Round 2: 3 pairs" })).toBeInTheDocument();
  });

  it("with an odd number makes a trio, or sits someone out and says who", async () => {
    seed(SIX.slice(0, 5), { mode: "pairs" });
    await mount();
    expect(screen.getByText("1 pair and a group of 3.")).toBeInTheDocument();
    fireEvent.click(radio("With an odd number of people", "One person sits out"));
    expect(screen.getByText("2 pairs, and 1 person sits out each round.")).toBeInTheDocument();
    fireEvent.click(mixButton());
    const out = state().rounds[0].sitOut[0];
    expect(screen.getByText(`${out} sits out this round.`)).toBeInTheDocument();
    expect(screen.getByText(`Sitting out: ${out}`)).toBeInTheDocument();
  });

  it("balances by role from the Team page, and shows each person's role", async () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    seed(["Ana", "Bo", "Cy", "Dee"], { mode: "pairs" });
    await mount();
    fireEvent.click(radio("Balance", "By role"));
    fireEvent.click(mixButton());
    for (const g of state().rounds[0].groups) {
      const roles = g.people.map((n) => ROSTER.find((m) => m.name === n)!.role);
      expect(new Set(roles).size).toBe(2);
    }
    expect(screen.getAllByText("Developer")).toHaveLength(2);
  });
});

describe("rules", () => {
  it("are checked before they save, then keep people apart", async () => {
    seed(["Ana", "Bo", "Cy", "Dee"], { split: "count", count: 2 });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(await screen.findByText("Name the first person.")).toBeInTheDocument();
    expect(state().rules).toEqual([]);
    fireEvent.change(screen.getByLabelText("First person"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Second person"), { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(await screen.findByText("Pick two different people.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Second person"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(state().rules).toEqual([expect.objectContaining({ kind: "apart", a: "Ana", b: "Bo" })]);
    expect(spies.log).toHaveBeenCalledWith(TEAM_MIXER_ACTIONS.RULE_ADDED, { kind: "apart" });
    expect(screen.getByText("Keep Ana and Bo apart")).toBeInTheDocument();
    fireEvent.click(mixButton());
    const groups = state().rounds[0].groups.map((g) => g.people);
    expect(groups.findIndex((g) => g.includes("Ana"))).not.toBe(
      groups.findIndex((g) => g.includes("Bo"))
    );
  });

  it("refuse a second rule for the same pair", async () => {
    seed(["Ana", "Bo"], { rules: [{ id: "r1", kind: "apart", a: "Ana", b: "Bo" }] });
    await mount();
    fireEvent.click(radio("Rule", "Keep together"));
    fireEvent.change(screen.getByLabelText("First person"), { target: { value: "Bo" } });
    fireEvent.change(screen.getByLabelText("Second person"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(await screen.findByText("There's already a rule for Ana and Bo.")).toBeInTheDocument();
    expect(state().rules).toHaveLength(1);
  });

  it("say when someone in a rule isn't in the mix, and go with Undo", async () => {
    seed(["Ana", "Bo"], { rules: [{ id: "r1", kind: "together", a: "Ana", b: "Zed" }] });
    await mount();
    expect(screen.getByText("Zed isn't in the mix, so this rule waits.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the rule: Keep Ana and Zed together" })
    );
    expect(state().rules).toEqual([]);
    expect(spies.log).toHaveBeenCalledWith(TEAM_MIXER_ACTIONS.RULE_REMOVED, { kind: "together" });
    undoOf("Removed the rule for Ana and Zed")();
    expect(state().rules).toHaveLength(1);
  });

  it("name a rule the mix had to break, marked as broken", async () => {
    seed(["Ana", "Bo", "Cy", "Dee"], {
      split: "count",
      count: 2,
      rules: [
        { id: "r1", kind: "apart", a: "Ana", b: "Bo" },
        { id: "r2", kind: "apart", a: "Bo", b: "Cy" },
        { id: "r3", kind: "apart", a: "Ana", b: "Cy" },
      ],
    });
    await mount();
    fireEvent.click(mixButton());
    const list = screen.getByRole("list", { name: "About this mix" });
    expect(within(list).getByLabelText("Rule broken")).toBeInTheDocument();
    expect(within(list).getByText(/though they should be kept apart\.$/)).toBeInTheDocument();
    expect(spies.log).toHaveBeenCalledWith(
      TEAM_MIXER_ACTIONS.GROUPS_MIXED,
      expect.objectContaining({ broken: 1 })
    );
  });
});

describe("after a mix", () => {
  it("moves someone to another group, with Undo", async () => {
    seed(SIX, { split: "count", count: 2 });
    await mount();
    fireEvent.click(mixButton());
    const round = state().rounds[0];
    const who = round.groups[0].people[0];
    fireEvent.change(screen.getByLabelText("Who"), { target: { value: who } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(state().rounds[0].groups[1].people).toContain(who);
    expect(spies.log).toHaveBeenCalledWith(
      TEAM_MIXER_ACTIONS.MIX_SAVED,
      expect.objectContaining({ edit: "moved" })
    );
    undoOf(`Moved ${who}`)();
    expect(state().rounds[0]).toEqual(round);
  });

  it("asks who and where before moving", async () => {
    seed(SIX);
    await mount();
    fireEvent.click(mixButton());
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByText("Pick who to move.")).toBeInTheDocument();
  });

  it("names the groups from the built-in lists, with Undo", async () => {
    seed(SIX, { split: "count", count: 2 });
    await mount();
    fireEvent.click(mixButton());
    fireEvent.change(screen.getByLabelText("Theme (optional)"), { target: { value: "trees" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest names" }));
    expect(screen.getByText(/^Suggested without AI/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use all 2" }));
    const names = state().rounds[0].groups.map((g) => g.name);
    expect(names.every((n) => typeof n === "string" && n.length > 0)).toBe(true);
    expect(screen.getByRole("list", { name: names[0]! })).toBeInTheDocument();
    undoOf("Named 2 groups")();
    expect(state().rounds[0].groups.every((g) => g.name === undefined)).toBe(true);
  });

  it("asks Picker's AI task for names with a theme and a count only, never a name", async () => {
    aiHolder.value = {
      task: { id: "picker.theme_names" },
      input: (theme: string, count: number) => ({ theme, count }),
      names: (o: { names: string[] }) => o.names,
      max: 20,
    };
    seed(SIX, { split: "count", count: 3 });
    await mount();
    fireEvent.click(mixButton());
    fireEvent.change(screen.getByLabelText("Theme (optional)"), { target: { value: "space" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr for names" }));
    expect(spies.aiInput).toHaveBeenCalledWith({ theme: "space", count: 3 });
    // Suggestions wait for the person.
    expect(state().rounds[0].groups.every((g) => g.name === undefined)).toBe(true);
    const uses = screen.getAllByRole("button", { name: /^Use: / });
    fireEvent.click(uses[1]);
    expect(state().rounds[0].groups.map((g) => g.name)).toEqual([undefined, "Nebula", undefined]);
  });

  it("lists the rounds so far; one goes with Undo, and Start over forgets them all", async () => {
    seed(SIX, { mode: "pairs" });
    await mount();
    fireEvent.click(mixButton());
    fireEvent.click(screen.getByRole("button", { name: "Mix the next round" }));
    expect(screen.getByRole("heading", { name: /Rounds so far \(2\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove round 1" }));
    expect(state().rounds).toHaveLength(1);
    undoOf("Removed a round: its pairings count again")();
    expect(state().rounds).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(state().rounds).toEqual([]);
    expect(spies.log).toHaveBeenCalledWith(TEAM_MIXER_ACTIONS.MIXER_RESET, {
      what: "rounds",
      rounds: 2,
    });
    undoOf("Forgot 2 rounds")();
    expect(state().rounds).toHaveLength(2);
  });
});

describe("World Café", () => {
  const EIGHT = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"];

  it("plans tables with hosts who stay, and steps through the rounds", async () => {
    seed(EIGHT, { mode: "cafe", tables: 2, cafeRounds: 2 });
    await mount();
    expect(
      screen.getByText("2 tables, each with a host and 3 guests, over 2 rounds.")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Table 1"), { target: { value: "A1" } });
    expect(state().hosts[0]).toBe("A1");
    fireEvent.click(screen.getByRole("button", { name: "Plan the café" }));
    const cafe = state().cafe!;
    expect(cafe.rounds[0][0].host).toBe("A1");
    expect(screen.getByRole("heading", { name: "Round 1 of 2" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("A1")).toBeInTheDocument();
    fireEvent.click(radio("Round on screen", "Round 2"));
    expect(state().cafe!.current).toBe(1);
    expect(screen.getByRole("heading", { name: "Round 2 of 2" })).toBeInTheDocument();
    expect(spies.log).toHaveBeenCalledWith(
      TEAM_MIXER_ACTIONS.GROUPS_MIXED,
      expect.objectContaining({ mode: "cafe", groups: 2, rounds: 2 })
    );
  });

  it("says when there are too few people for the tables", async () => {
    seed(EIGHT.slice(0, 5), { mode: "cafe", tables: 3 });
    await mount();
    expect(
      screen.getByText("3 tables need at least 6 people: a host and a guest at each.")
    ).toBeInTheDocument();
  });
});

describe("the live room", () => {
  it("puts the newest round on everyone's phone", async () => {
    seed(SIX, { split: "count", count: 2, title: "Retro breakouts" });
    await mount();
    expect(screen.getByRole("button", { name: "Show the groups" })).toBeDisabled();
    expect(screen.getByText("Mix a round first, above.")).toBeInTheDocument();
    fireEvent.click(mixButton());
    fireEvent.click(screen.getByRole("button", { name: "Show round 1" }));
    expect(spies.show).toHaveBeenCalledTimes(1);
    const [kind, payload] = spies.show.mock.calls[0] as [string, Record<string, unknown>];
    expect(kind).toBe("groups");
    expect(payload).toMatchObject({ title: "Retro breakouts", round: 1, unit: "group" });
    expect((payload.groups as { people: string[] }[]).flatMap((g) => g.people).sort()).toEqual(
      [...SIX].sort()
    );
    expect(screen.getByText("Round 1 is on everyone's screen.")).toBeInTheDocument();
  });

  it("puts the café round on screen", async () => {
    seed(["A1", "B2", "C3", "D4"], { mode: "cafe", tables: 2, cafeRounds: 1 });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Plan the café" }));
    fireEvent.click(screen.getByRole("button", { name: "Show café round 1" }));
    expect(spies.show.mock.calls[0][0]).toBe("cafe");
  });

  it("says so when the room refuses a frame", async () => {
    spies.show.mockReturnValueOnce(false);
    seed(SIX);
    await mount();
    fireEvent.click(mixButton());
    fireEvent.click(screen.getByRole("button", { name: "Show round 1" }));
    expect(screen.getByText(/too big to show at once/)).toBeInTheDocument();
  });
});

describe("export, reset and prompts", () => {
  it("exports the rounds and the rules as Markdown", async () => {
    seed(SIX, {
      split: "count",
      count: 2,
      rules: [{ id: "r1", kind: "apart", a: "Ana", b: "Bo" }],
    });
    await mount();
    fireEvent.click(mixButton());
    const md = screen.getByTestId("export-team-mixer").textContent ?? "";
    expect(md).toMatch(/^# Team Mixer/);
    expect(md).toContain("## Round 1: 2 groups");
    expect(md).toContain("- Keep Ana and Bo apart");
    expect(md).toContain("**In the mix (6):** Ana, Bo, Cy, Dee, Eve, Fay");
  });

  it("writes the café's who-goes-where table", () => {
    const s = { ...buildExample(new Date()) };
    expect(toMarkdown({ ...s, rounds: [], cafe: null })).toContain("_No groups mixed yet._");
    const cafe = {
      id: "c1",
      at: "2026-11-12T10:00:00.000Z",
      seed: 1,
      balance: "none" as const,
      rounds: [
        [
          { host: "Ana", guests: ["Bo"] },
          { host: "Cy", guests: ["Dee|x"] },
        ],
      ],
      issues: [],
      current: 0,
    };
    const md = toMarkdown({ ...MIXER_INITIAL, mode: "cafe", cafe });
    expect(md).toContain("| Person | Round 1 |");
    expect(md).toContain("| Ana (host) | Table 1 |");
    expect(md).toContain("| Dee/x | Table 2 |");
  });

  it("resets everything after asking, with Undo", async () => {
    seed(SIX);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset Team Mixer" }));
    await waitFor(() => expect(state().people).toEqual([]));
    expect(spies.log).toHaveBeenCalledWith(TEAM_MIXER_ACTIONS.MIXER_RESET, { what: "everything" });
    undoOf("Reset Team Mixer")();
    expect(state().people).toHaveLength(6);
  });

  it("builds copyable prompts that never carry a name", () => {
    const prompts = generateTeamMixerPrompts({
      mode: "groups",
      people: 12,
      groups: 3,
      title: "Ana's retro",
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("12 people into 3 groups of about 4");
    expect(generateTeamMixerPrompts({ mode: "cafe", people: 12, groups: 3, rounds: 2 })[0].id).toBe(
      "team-mixer-cafe-questions"
    );
    expect(generateTeamMixerPrompts({ mode: "pairs", people: 1, groups: 0 })).toEqual([]);
  });
});

describe("the tool's own rules", () => {
  const dir = path.resolve(__dirname, "../../src/app/(tools)/team-mixer");
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
  const src = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");

  it("uses no raw storage, no confirm(), no server module and no non-error toast", () => {
    expect(src).not.toMatch(/\blocalStorage\s*\./);
    expect(src).not.toMatch(/(?<![\w.])confirm\s*\(/);
    expect(src).not.toMatch(/\.server["']/);
    expect(src).not.toMatch(/\btoast(\.(success|info|message))?\(/);
  });

  it("shuffles only through the shared seeded helpers", () => {
    const lib = path.resolve(__dirname, "../../src/lib/team-mixer");
    const libSrc = readdirSync(lib)
      .map((f) => readFileSync(path.join(lib, f), "utf8"))
      .join("\n");
    expect(`${src}\n${libSrc}`).not.toMatch(/Math\.random\(/);
    expect(libSrc).toMatch(/@\/lib\/utils\/random/);
  });
});
