import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import type { Kudos, Sprint, TeamMember } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import {
  CONCENTRATED_SHARE,
  fairnessHints,
  isRecognition,
  lastDaysWindow,
  listNames,
  recognitionReceived,
  sprintWindow,
} from "@/lib/kudos/recognition";

/**
 * Kudos, upgraded: who the kudos reach (a chart with a table, replies and
 * example kudos left out, a roster member matched by id then by name),
 * fairness hints from the roster once there are enough kudos, a wall
 * export, a feed into the retro's appreciations, no recipient picked on
 * the sender's behalf, a validated form that stamps the roster member, an
 * example that never reaches the room, and Undo on a custom theme delete.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => undefined }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/components/collab/session-share-button", () => ({ SessionShareButton: () => null }));
vi.mock("@/app/(tools)/kudos/components/kudos-beacon", () => ({ KudosBeacon: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => undefined }));
vi.mock("@/lib/whiteboard/export", () => ({ exportPng: async () => undefined }));
vi.mock("@/lib/gamification/engine", () => ({ dispatch: () => undefined }));
vi.mock("@/lib/predictions/use-predicted-default", () => ({
  usePredictedDefault: () => ({ confidence: "none", value: "" }),
}));
vi.mock("@/lib/kudos/llm/sentiment", () => ({ analyseSentiment: async () => null }));
vi.mock("@/lib/kudos/llm", () => ({
  analyseSentiment: async () => null,
  detectDuplicate: async () => null,
  computeFairness: async () => null,
  installFairnessInvalidator: () => () => undefined,
  primeRecipientSuggestion: async () => undefined,
}));
// The signed-in owner, so the page runs its owner paths.
vi.mock("@/lib/auth/use-is-owner", () => ({
  useIsOwner: () => true,
  useOwnerState: () => ({ isOwner: true, settled: true, unverified: false, visitor: false }),
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => ({
    status: "authenticated",
    user: { id: "owner-1", user_metadata: {} },
    profile: { display_name: "Mia" },
  }),
}));
// A connected room, so a real send broadcasts and the example must not.
const room = vi.hoisted(() => ({
  broadcast: vi.fn(),
}));
vi.mock("@/lib/realtime/use-room", () => ({
  useRoom: () => ({
    isConnected: true,
    isLocalOnly: false,
    userId: "owner-1",
    members: [],
    broadcast: room.broadcast,
    subscribeToEvent: () => () => undefined,
  }),
}));

import { KudosClient } from "@/app/(tools)/kudos/kudos-client";
import { KudosSettings } from "@/app/(tools)/kudos/components/kudos-settings";
import { EXAMPLE_ROSTER, buildExample } from "@/app/(tools)/kudos/example";
import { validateKudosDraft } from "@/app/(tools)/kudos/form";
import { kudosCsv, kudosToMarkdown } from "@/app/(tools)/kudos/markdown";
import {
  recognitionChartText,
  recognitionRows,
  recognitionVerdict,
} from "@/app/(tools)/kudos/verdict";
import { kudosCardText } from "@/app/(tools)/retro/kudos";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
const NOW = new Date();
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(NOW.getTime() - n * DAY_MS);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localIso(NOW);

let seq = 0;
const kudo = (toName: string, over: Partial<Kudos> = {}): Kudos => ({
  id: `kud_${(seq++).toString().padStart(8, "0")}`,
  theme: "thank-you",
  toName,
  fromName: "Mia",
  message: `Thanks ${toName}`,
  sentAt: daysAgo(2),
  ...over,
});

const ROSTER: TeamMember[] = [
  { id: "m-sam", name: "Sam" },
  { id: "m-priya", name: "Priya" },
  { id: "m-omar", name: "Omar" },
];

const ws = () => useWorkspaceStore.getState();
const seed = (kudos: Kudos[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    kudos,
    teamMembers: ROSTER,
    sprints: [],
    retroBoards: [],
    ...extra,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <KudosClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const [, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  act(() => opts.action.onClick());
};

beforeEach(() => {
  seq = 0;
  toastSpy.mockReset();
  room.broadcast.mockReset();
  localStorage.clear();
  resetSelectedSprint();
  window.history.replaceState(null, "", "/kudos");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
  );
  useKudosSettingsStore.setState({ customThemes: [] });
  seed([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── The recognition lib ────────────────────────────────────────────── */

describe("recognitionReceived", () => {
  it("counts per roster member, leaving replies and example kudos out", () => {
    const parent = kudo("Sam");
    const s = recognitionReceived(
      [
        parent,
        kudo("Sam", { fromName: "Priya" }),
        kudo("Priya"),
        // A reply copies its parent's recipient: not a second kudos for Sam.
        kudo("Sam", { replyTo: parent.id, fromName: "Sam", message: "thanks!" }),
        kudo("Sam", { id: "example-kudos-1" }),
      ],
      ROSTER
    );
    expect(s.total).toBe(3);
    expect(s.recipients.map((r) => [r.name, r.count, r.fromPeople])).toEqual([
      ["Sam", 2, 2],
      ["Priya", 1, 1],
    ]);
    expect(s.rosterWithNone).toEqual([{ memberId: "m-omar", name: "Omar" }]);
    expect(s.topShare).toBeCloseTo(2 / 3);
    expect(s.enough).toBe(false);
  });

  it("keeps a kudos with its member after a rename, and matches names by key", () => {
    const renamed: TeamMember[] = [{ id: "m-sam", name: "Samuel" }, ...ROSTER.slice(1)];
    const s = recognitionReceived(
      [
        kudo("Sam", { toMemberId: "m-sam" }),
        kudo("  priya "),
        kudo("PRIYA"),
        kudo("Kim", { sentAt: daysAgo(3) }),
        // Off the roster, the latest spelling names the row.
        kudo("kim ", { sentAt: daysAgo(1) }),
      ],
      renamed
    );
    expect(s.recipients.map((r) => [r.key, r.name, r.count, r.onRoster])).toEqual([
      ["name:kim", "kim", 2, false],
      ["member:m-priya", "Priya", 2, true],
      ["member:m-sam", "Samuel", 1, true],
    ]);
    expect(s.recipients.find((r) => r.key === "member:m-sam")?.memberId).toBe("m-sam");
  });

  it("falls back to the name when the member id is gone from the roster", () => {
    const s = recognitionReceived([kudo("Sam", { toMemberId: "m-deleted" })], ROSTER);
    expect(s.recipients[0]).toMatchObject({ key: "member:m-sam", count: 1 });
  });

  it("counts only the window's days, and the latest kudos per person", () => {
    const s = recognitionReceived(
      [
        kudo("Sam", { sentAt: daysAgo(40) }),
        kudo("Sam", { sentAt: daysAgo(3) }),
        kudo("Sam", { sentAt: daysAgo(1) }),
      ],
      ROSTER,
      lastDaysWindow(TODAY, 30)
    );
    expect(s.total).toBe(2);
    expect(s.recipients[0].lastAt).toBe(daysAgo(1));
  });

  it("reads a sprint's start to end day, and nothing for placeholder dates", () => {
    expect(sprintWindow({ startDate: "2026-09-21", endDate: "2026-10-04" } as Sprint)).toEqual({
      from: "2026-09-21",
      to: "2026-10-04",
    });
    expect(sprintWindow({ startDate: "2020-01-01", endDate: "2020-01-14" } as Sprint)).toBeNull();
  });

  it("is empty with no kudos, and copes with a huge wall", () => {
    const empty = recognitionReceived([], ROSTER);
    expect(empty).toMatchObject({ total: 0, recipients: [], topShare: null, enough: false });
    expect(empty.rosterWithNone).toHaveLength(3);
    const many = Array.from({ length: 500 }, (_, i) => kudo(i % 2 ? "Sam" : "Priya"));
    const big = recognitionReceived(many, ROSTER);
    expect(big.total).toBe(500);
    expect(big.recipients.map((r) => r.count)).toEqual([250, 250]);
  });

  it("counts examples only when the page's preview asks", () => {
    const rows = buildExample(NOW);
    expect(recognitionReceived(rows, EXAMPLE_ROSTER).total).toBe(0);
    const preview = recognitionReceived(rows, EXAMPLE_ROSTER, null, { includeExamples: true });
    // Nine kudos; the tenth row is a reply.
    expect(preview.total).toBe(9);
    expect(preview.rosterWithNone.map((m) => m.name)).toEqual(["Omar"]);
  });

  it("isRecognition leaves out replies and examples", () => {
    expect(isRecognition({ id: "kud_1" })).toBe(true);
    expect(isRecognition({ id: "kud_1", replyTo: "kud_0" })).toBe(false);
    expect(isRecognition({ id: "example-1" })).toBe(false);
  });
});

describe("fairnessHints", () => {
  const five = (names: string[]) => names.map((n) => kudo(n));

  it("waits for MIN_SAMPLE.distribution kudos and a roster of two", () => {
    expect(MIN_SAMPLE.distribution).toBe(5);
    const four = recognitionReceived(five(["Sam", "Sam", "Priya", "Priya"]), ROSTER);
    expect(fairnessHints(four, ROSTER.length)).toEqual([]);
    const enough = recognitionReceived(five(["Sam", "Sam", "Priya", "Priya", "Priya"]), ROSTER);
    expect(fairnessHints(enough, 1)).toEqual([]);
    const hints = fairnessHints(enough, ROSTER.length, { windowLabel: "in Sprint 12" });
    expect(hints).toEqual([
      {
        kind: "none-received",
        memberIds: ["m-omar"],
        names: ["Omar"],
        sentence: "Omar hasn't received a kudos yet in Sprint 12.",
      },
    ]);
  });

  it("flags kudos piling up on one person, without blaming anyone", () => {
    const s = recognitionReceived(five(["Sam", "Sam", "Sam", "Sam", "Priya", "Omar"]), ROSTER);
    const [hint] = fairnessHints(s, ROSTER.length);
    expect(hint.kind).toBe("concentrated");
    expect(hint.memberIds).toEqual(["m-sam"]);
    expect(hint.sentence).toBe(
      "Sam received 4 of 6 kudos in this window. Recognition tends to follow the most visible work; quieter contributions may be worth a look too."
    );
  });

  it("never reads an even split of two as concentrated", () => {
    const pair: TeamMember[] = ROSTER.slice(0, 2);
    const s = recognitionReceived(five(["Sam", "Sam", "Sam", "Priya", "Priya", "Priya"]), pair);
    expect(s.topShare).toBe(CONCENTRATED_SHARE);
    expect(fairnessHints(s, 2)).toEqual([]);
  });

  it("never names one of two people tied at the top, whatever the roster's size", () => {
    // A roster of four puts the bar at half the kudos: Priya and Sam with 5
    // each reach it, but neither leads alone.
    const four: TeamMember[] = [...ROSTER, { id: "m-lee", name: "Lee" }];
    const s = recognitionReceived(five([...Array(5).fill("Sam"), ...Array(5).fill("Priya")]), four);
    expect(s.topShare).toBe(0.5);
    const hints = fairnessHints(s, four.length);
    expect(hints.map((h) => h.kind)).toEqual(["none-received"]);
    expect(recognitionVerdict(s, four.length, "so far")).toBe(
      "Recognition reached 2 of 4 teammates so far; Omar and Lee have none yet."
    );
    // One more for Sam and he leads alone: now it reads as concentrated.
    const ahead = recognitionReceived(
      five([...Array(6).fill("Sam"), ...Array(5).fill("Priya")]),
      four
    );
    expect(fairnessHints(ahead, four.length).map((h) => h.kind)).toEqual([
      "none-received",
      "concentrated",
    ]);
  });

  it("names up to three teammates, then counts the rest", () => {
    expect(listNames(["Omar"])).toBe("Omar");
    expect(listNames(["Omar", "Lee"])).toBe("Omar and Lee");
    expect(listNames(["Omar", "Lee", "Ana", "Kim", "Jo"])).toBe("Omar, Lee, Ana and 2 more");
    const roster: TeamMember[] = ["Sam", "Omar", "Lee", "Ana", "Kim"].map((name) => ({
      id: `m-${name}`,
      name,
    }));
    const s = recognitionReceived(five(["Sam", "Sam", "Sam", "Sam", "Sam"]), roster);
    const none = fairnessHints(s, roster.length).find((h) => h.kind === "none-received");
    expect(none?.sentence).toBe(
      "4 teammates haven't received a kudos yet in this window: Omar, Lee, Ana and 1 more."
    );
  });
});

describe("verdict and chart text", () => {
  it("counts below the minimum, then reads the reach", () => {
    expect(recognitionVerdict(recognitionReceived([], ROSTER), 3, "in Sprint 12")).toBe(
      "No kudos in Sprint 12 yet."
    );
    const few = recognitionReceived([kudo("Sam"), kudo("Priya")], ROSTER);
    expect(recognitionVerdict(few, 3, "in Sprint 12")).toBe("2 kudos in Sprint 12, for 2 people.");
    const some = recognitionReceived(
      ["Sam", "Sam", "Priya", "Priya", "Sam"].map((n) => kudo(n)),
      ROSTER
    );
    expect(recognitionVerdict(some, 3, "in Sprint 12")).toBe(
      "Recognition reached 2 of 3 teammates in Sprint 12; Omar has none yet."
    );
    const all = recognitionReceived(
      ["Sam", "Sam", "Priya", "Priya", "Omar"].map((n) => kudo(n)),
      ROSTER
    );
    expect(recognitionVerdict(all, 3, "so far")).toBe(
      "Recognition reached all 3 teammates so far."
    );
    const piled = recognitionReceived(
      ["Sam", "Sam", "Sam", "Sam", "Priya", "Omar"].map((n) => kudo(n)),
      ROSTER
    );
    expect(recognitionVerdict(piled, 3, "so far")).toBe(
      "Recognition reached all 3 teammates so far; Sam received 4 of 6."
    );
    const noRoster = recognitionReceived(
      ["Sam", "Sam", "Priya", "Kim", "Kim", "Kim"].map((n) => kudo(n)),
      []
    );
    expect(recognitionVerdict(noRoster, 0, "so far")).toBe(
      "6 kudos so far, for 3 people; Kim received the most (3)."
    );
  });

  it("gives every teammate a row, those with none included", () => {
    const s = recognitionReceived([kudo("Sam"), kudo("Kim", { sentAt: daysAgo(1) })], ROSTER);
    expect(recognitionRows(s).map((r) => [r.name, r.count])).toEqual([
      ["Kim", 1],
      ["Sam", 1],
      ["Priya", 0],
      ["Omar", 0],
    ]);
    const text = recognitionChartText(s, ROSTER.length, "so far");
    expect(text.summary).toBe("Kudos received so far: Kim 1, Sam 1, Priya 0 and Omar 0.");
    expect(text.table.columns).toEqual(["Person", "Kudos received", "From people", "Last kudos"]);
    expect(text.table.rows[0]).toEqual([
      "Kim (not on the team)",
      1,
      1,
      localIso(new Date(daysAgo(1))),
    ]);
    expect(text.table.rows[2]).toEqual(["Priya", 0, 0, "—"]);
  });
});

describe("validateKudosDraft", () => {
  it("needs a recipient and a message, within the card's word limits", () => {
    expect(validateKudosDraft({ to: " ", message: "", team: "" })).toEqual({
      ok: false,
      errors: { to: "Pick who the kudos is for.", message: "Write what you're thanking them for." },
    });
    const long = validateKudosDraft({
      to: "One Two Three Four Five",
      message: Array.from({ length: 51 }, () => "word").join(" "),
      team: "A B C D",
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(Object.keys(long.errors).sort()).toEqual(["message", "team", "to"]);
    expect(validateKudosDraft({ to: " Sam ", message: " Thanks ", team: "" })).toEqual({
      ok: true,
      values: { to: "Sam", message: "Thanks" },
    });
  });
});

describe("Markdown and CSV export", () => {
  it("exports the recognition table and the wall, replies under their kudos, examples left out", () => {
    const parent = kudo("Sam", { sentAt: daysAgo(3), message: "Fixed the | build" });
    const reply = kudo("Sam", {
      replyTo: parent.id,
      fromName: "Sam",
      sentAt: daysAgo(2),
      message: "Thanks!",
    });
    const later = kudo("Priya", { sentAt: daysAgo(1), teamName: "Checkout" });
    const rows = [parent, reply, later, kudo("Omar", { id: "example-kudos-x" })];
    const md = kudosToMarkdown(rows, recognitionReceived(rows, ROSTER), {
      windowLabel: "so far",
      rosterSize: ROSTER.length,
    });
    expect(md).toContain("> 2 kudos so far, for 2 people.");
    expect(md).toContain("## Recognition received so far");
    expect(md).toContain("| Omar | 0 | 0 | — |");
    const wall = md.slice(md.indexOf("## Wall"));
    expect(wall.indexOf("to Priya (Checkout)")).toBeLessThan(wall.indexOf("to Sam"));
    expect(wall).toContain("— Fixed the | build");
    expect(wall).toContain("  - Reply from Sam");
    expect(md).not.toContain("example");
    expect(kudosCsv(rows).rows.map((r) => r[1])).toEqual(["Sam", "Sam", "Priya"]);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Kudos page: compose", () => {
  it("never picks the recipient, and shows what's missing on Send", async () => {
    renderPage();
    const to = screen.getByLabelText("To") as HTMLSelectElement;
    expect(to.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    expect(await screen.findByText("Pick who the kudos is for.")).toBeInTheDocument();
    expect(screen.getByText("Write what you're thanking them for.")).toBeInTheDocument();
    await waitFor(() => expect(to).toHaveFocus());
    expect(ws().kudos).toEqual([]);
    expect(room.broadcast).not.toHaveBeenCalled();
  });

  it("stamps the roster member on a kudos picked from the team", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:m-sam" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Great pairing" } });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await waitFor(() => expect(ws().kudos).toHaveLength(1));
    expect(ws().kudos?.[0]).toMatchObject({ toName: "Sam", toMemberId: "m-sam", fromName: "Mia" });
    expect(room.broadcast).toHaveBeenCalledWith("kudos:created", expect.anything());
    // The form starts again with nobody picked.
    expect((screen.getByLabelText("To") as HTMLSelectElement).value).toBe("");
  });

  it("matches a typed name to the roster, and sends Ctrl+Enter from the message", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "free" } });
    fireEvent.change(screen.getByLabelText("Recipient name"), {
      target: { value: " priya " },
    });
    const message = screen.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "Thanks for the review" } });
    fireEvent.keyDown(message, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(ws().kudos).toHaveLength(1));
    expect(ws().kudos?.[0]).toMatchObject({ toName: "Priya", toMemberId: "m-priya" });
  });

  it("offers Add to the team for a typed name off the roster, as an explicit click", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "free" } });
    fireEvent.change(screen.getByLabelText("Recipient name"), {
      target: { value: "Kim" },
    });
    expect(ws().teamMembers).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(ws().teamMembers?.map((m) => m.name)).toEqual(["Sam", "Priya", "Omar", "Kim"]);
  });
});

describe("Kudos page: recognition received", () => {
  it("shows the counts below the minimum, and no hints", () => {
    seed([kudo("Sam"), kudo("Sam"), kudo("Priya")]);
    renderPage();
    expect(screen.getByText("3 kudos in the last 30 days, for 2 people.")).toBeInTheDocument();
    expect(
      screen.getByText("Kudos received in the last 30 days: Sam 2, Priya 1 and Omar 0.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Send 2 more kudos to see how recognition spreads across the team.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Fairness hints" })).toBeNull();
  });

  it("hints at teammates with none from five kudos, and Send to picks them", async () => {
    const parent = kudo("Sam");
    seed([
      parent,
      kudo("Sam"),
      kudo("Priya"),
      kudo("Priya"),
      kudo("sam "),
      kudo("Sam", { replyTo: parent.id, fromName: "Sam" }),
    ]);
    renderPage();
    expect(
      screen.getByText(
        "Recognition reached 2 of 3 teammates in the last 30 days; Omar has none yet."
      )
    ).toBeInTheDocument();
    const hints = screen.getByRole("list", { name: "Fairness hints" });
    expect(
      within(hints).getByText("Omar hasn't received a kudos yet in the last 30 days.")
    ).toBeInTheDocument();
    // The same hint sits above the form, with the AI one off.
    const buttons = screen.getAllByRole("button", { name: "Send to Omar" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(within(hints).getByRole("button", { name: "Send to Omar" }));
    await waitFor(() =>
      expect((screen.getByLabelText("To") as HTMLSelectElement).value).toBe("team:m-omar")
    );
    expect(screen.getByLabelText("Message")).toHaveFocus();
  });

  it("reads the sprint when one has dates, and switches to all time", () => {
    const start = localIso(new Date(NOW.getTime() - 6 * DAY_MS));
    const end = localIso(new Date(NOW.getTime() + 7 * DAY_MS));
    const sprint: Sprint = {
      id: "s-12",
      name: "Sprint 12",
      startDate: start,
      endDate: end,
      pointsPlanned: 20,
      status: "active",
    };
    seed([kudo("Sam", { sentAt: daysAgo(2) }), kudo("Priya", { sentAt: daysAgo(20) })], {
      sprints: [sprint],
    });
    renderPage();
    expect(screen.getByText("1 kudos in Sprint 12, for 1 person.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(screen.getByText("2 kudos so far, for 2 people.")).toBeInTheDocument();
  });

  it("exports the wall as Markdown", () => {
    seed([kudo("Sam", { message: "Shipped the fix" })]);
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Kudos wall");
    expect(md).toContain("| Sam | 1 | 1 |");
    expect(md).toContain("**Thank You** to Sam from Mia");
  });
});

describe("Kudos page: retro appreciations", () => {
  it("adds a kudos to the retro as the same card Retro adds, once, with Undo", () => {
    const k = kudo("Sam", { message: "Stayed late to fix the flaky tests" });
    seed([k]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add the kudos for Sam to the retro" }));
    const board = ws().retroBoards?.find((b) => b.id === RETRO_CURRENT_ID);
    expect(board?.cards).toHaveLength(1);
    expect(board?.cards[0]).toMatchObject({
      text: kudosCardText(k),
      sourceRef: { tool: "kudos", id: k.id },
      isActionItem: false,
    });
    // "On the retro board" is read from the board: no second card.
    expect(screen.getByRole("link", { name: /On the retro board/ })).toHaveAttribute(
      "href",
      "/retro"
    );
    expect(screen.queryByRole("button", { name: "Add the kudos for Sam to the retro" })).toBeNull();

    undoLast();
    expect(ws().retroBoards?.find((b) => b.id === RETRO_CURRENT_ID)).toBeUndefined();
    expect(
      screen.getByRole("button", { name: "Add the kudos for Sam to the retro" })
    ).toBeInTheDocument();
  });

  it("offers nothing for a reply", () => {
    const parent = kudo("Sam");
    seed([parent, kudo("Sam", { replyTo: parent.id, fromName: "Sam" })]);
    renderPage();
    expect(screen.getAllByRole("button", { name: /to the retro/ })).toHaveLength(1);
  });

  it("offers nothing for a reply whose kudos was removed, though it shows as a card", () => {
    seed([kudo("Sam", { replyTo: "kud_gone", fromName: "Priya", message: "Seconded!" })]);
    renderPage();
    expect(screen.getByText("Seconded!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to the retro/ })).toBeNull();
  });
});

describe("Kudos page: example", () => {
  it("loads through the store, never the room, reads its own team, and clears with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const rows = ws().kudos ?? [];
    expect(rows).toHaveLength(10);
    expect(rows.every((k) => k.id.startsWith("example-"))).toBe(true);
    expect(room.broadcast).not.toHaveBeenCalled();
    expect(ws().teamMembers).toEqual(ROSTER);
    expect(
      screen.getByText(
        "Recognition reached 4 of 5 teammates in the last 30 days; Omar has none yet."
      )
    ).toBeInTheDocument();
    // Example cards can't be sent to the retro, reacted to or replied to.
    expect(screen.queryByRole("button", { name: /to the retro/ })).toBeNull();
    // The notice says it stays on the wall until cleared.
    expect(screen.getByText(/stays on this wall \(and in your saved workspace\)/)).toBeTruthy();
    // The export is the team's own wall.
    expect(screen.getByTestId("export-markdown").textContent).not.toContain("Untangled");

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ws().kudos).toEqual([]);
    undoLast();
    expect(ws().kudos).toHaveLength(10);
  });
});

describe("Kudos settings: custom themes", () => {
  it("deletes a custom theme with Undo that puts it back in its place", () => {
    const a = { id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" };
    const b = { id: "fix-it", title: "Fix It", emoji: "🔧", hex: "#654321" };
    useKudosSettingsStore.setState({ customThemes: [a, b] });
    render(<KudosSettings open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete theme Ship Day" }));
    expect(useKudosSettingsStore.getState().customThemes).toEqual([b]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted the “Ship Day” theme");
    undoLast();
    expect(useKudosSettingsStore.getState().customThemes).toEqual([a, b]);
  });

  it("offers the Undo inside the dialog too, focused, and restores once", async () => {
    const a = { id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" };
    const b = { id: "fix-it", title: "Fix It", emoji: "🔧", hex: "#654321" };
    useKudosSettingsStore.setState({ customThemes: [a, b] });
    render(<KudosSettings open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete theme Ship Day" }));
    const undo = screen.getByRole("button", { name: "Undo deleting the Ship Day theme" });
    // The toast sits outside the dialog's focus trap; this one is in reach.
    await waitFor(() => expect(undo).toHaveFocus());
    fireEvent.click(undo);
    expect(useKudosSettingsStore.getState().customThemes).toEqual([a, b]);
    expect(screen.queryByRole("button", { name: /^Undo deleting/ })).toBeNull();
    // The toast's Undo after it does nothing more: no second copy.
    undoLast();
    expect(useKudosSettingsStore.getState().customThemes).toEqual([a, b]);
  });
});
