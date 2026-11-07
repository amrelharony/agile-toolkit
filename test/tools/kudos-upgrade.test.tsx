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
  notThanked,
  recognitionReceived,
  sprintWindow,
} from "@/lib/kudos/recognition";

/**
 * Kudos, upgraded: Not thanked yet, the owner's list of the teammates no
 * kudos has reached in a window (names only, never a count; replies and
 * example kudos left out, a roster member matched by id then by name), each
 * with Send to <name>; the tallies and fairness hints the agent still reads;
 * a wall export, a feed into the retro's appreciations, no recipient picked
 * on the sender's behalf, a validated form that stamps the roster member,
 * an example that never reaches the room, and settings with no custom
 * themes.
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

describe("notThanked", () => {
  it("names the roster's teammates no kudos reached, in roster order, as recognitionReceived matches them", () => {
    const parent = kudo("Sam");
    const rows = [
      parent,
      // A reply copies its parent's recipient: it thanks nobody new.
      kudo("Priya", { replyTo: parent.id }),
      kudo("Omar", { id: "example-kudos-1" }),
      // Off the roster: never on the list, and never thanks a teammate.
      kudo("Kim"),
    ];
    expect(notThanked(rows, ROSTER)).toEqual([
      { memberId: "m-priya", name: "Priya" },
      { memberId: "m-omar", name: "Omar" },
    ]);
    expect(notThanked(rows, ROSTER)).toEqual(recognitionReceived(rows, ROSTER).rosterWithNone);
    // By member id after a rename, else by name (trimmed, any case).
    const renamed: TeamMember[] = [{ id: "m-sam", name: "Samuel" }, ...ROSTER.slice(1)];
    expect(
      notThanked([kudo("Sam", { toMemberId: "m-sam" }), kudo(" OMAR ")], renamed).map((m) => m.name)
    ).toEqual(["Priya"]);
  });

  it("reads the window, everyone with no kudos, nobody with no roster, and examples when asked", () => {
    const rows = [kudo("Sam", { sentAt: daysAgo(40) }), kudo("Priya", { sentAt: daysAgo(3) })];
    expect(notThanked(rows, ROSTER, lastDaysWindow(TODAY, 30)).map((m) => m.name)).toEqual([
      "Sam",
      "Omar",
    ]);
    expect(notThanked(rows, ROSTER, null).map((m) => m.name)).toEqual(["Omar"]);
    expect(notThanked([], ROSTER)).toHaveLength(3);
    expect(notThanked(rows, [])).toEqual([]);
    // A blank name on the roster names nobody.
    expect(notThanked([], [{ id: "m-blank", name: "  " }])).toEqual([]);
    const example = buildExample(NOW);
    expect(notThanked(example, EXAMPLE_ROSTER)).toHaveLength(5);
    expect(
      notThanked(example, EXAMPLE_ROSTER, null, { includeExamples: true }).map((m) => m.name)
    ).toEqual(["Omar"]);
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
    expect(hints[0].sentence).toBe("Omar and Lee haven't received a kudos yet in this window.");
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
  it("exports who hasn't been thanked and the wall, replies under their kudos, examples left out", () => {
    const parent = kudo("Sam", { sentAt: daysAgo(3), message: "Fixed the | build" });
    const reply = kudo("Sam", {
      replyTo: parent.id,
      fromName: "Sam",
      sentAt: daysAgo(2),
      message: "Thanks!",
    });
    const later = kudo("Priya", { sentAt: daysAgo(1), teamName: "Checkout" });
    const rows = [parent, reply, later, kudo("Omar", { id: "example-kudos-x" })];
    const md = kudosToMarkdown(rows, notThanked(rows, ROSTER), {
      windowLabel: "so far",
      rosterSize: ROSTER.length,
    });
    expect(md).toContain("# Kudos wall\n\n## Not thanked yet so far\n\n- Omar\n\n## Wall\n");
    // Names only: no verdict, no table, no counts.
    expect(md).not.toMatch(/^>|\|\s*\d|Recognition received/m);
    const wall = md.slice(md.indexOf("## Wall"));
    expect(wall.indexOf("to Priya (Checkout)")).toBeLessThan(wall.indexOf("to Sam"));
    expect(wall).toContain("— Fixed the | build");
    expect(wall).toContain("  - Reply from Sam");
    expect(md).not.toContain("example");
    expect(kudosCsv(rows).rows.map((r) => r[1])).toEqual(["Sam", "Sam", "Priya"]);
  });

  it("says everyone has been thanked, and leaves the section out with no team", () => {
    const rows = ["Sam", "Priya", "omar"].map((n) => kudo(n));
    const all = kudosToMarkdown(rows, notThanked(rows, ROSTER), {
      windowLabel: "in Sprint 12",
      rosterSize: ROSTER.length,
    });
    expect(all).toContain(
      "## Not thanked yet in Sprint 12\n\nEveryone on your team has been thanked in Sprint 12.\n"
    );
    const none = kudosToMarkdown(rows, notThanked(rows, []), {
      windowLabel: "so far",
      rosterSize: 0,
    });
    expect(none).not.toContain("Not thanked yet");
    expect(none.startsWith("# Kudos wall\n\n## Wall\n")).toBe(true);
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
    fireEvent.change(screen.getByLabelText("Thank you for"), {
      target: { value: "Great pairing" },
    });
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
    const message = screen.getByLabelText("Thank you for");
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

describe("Kudos page: not thanked yet", () => {
  const list = () => screen.getByRole("list", { name: "Not thanked yet" });
  const listed = () =>
    within(list())
      .getAllByRole("listitem")
      .map((li) => li.firstChild?.textContent);

  it("names each teammate nobody has thanked, one Send to each, no counts, nothing above the form", async () => {
    const parent = kudo("Sam");
    seed([
      parent,
      kudo("sam "),
      // A reply is a kudos for nobody, whoever it names; Kim isn't on the team.
      kudo("Priya", { replyTo: parent.id, fromName: "Sam" }),
      kudo("Kim"),
    ]);
    renderPage();
    expect(screen.getByRole("heading", { name: "Not thanked yet" })).toBeInTheDocument();
    expect(
      screen.getByText("No kudos have reached these teammates in the last 30 days.")
    ).toBeInTheDocument();
    expect(listed()).toEqual(["Priya", "Omar"]);
    // One button per teammate, all of them in the list: no hint above the form.
    for (const name of ["Priya", "Omar"]) {
      expect(screen.getAllByRole("button", { name: `Send to ${name}` })).toHaveLength(1);
    }
    const sends = screen.getAllByRole("button", { name: /^Send to/ });
    expect(sends).toHaveLength(2);
    for (const b of sends) expect(list()).toContainElement(b);
    expect(screen.queryByRole("button", { name: "Send to Sam" })).toBeNull();
    // Names only: no tally, chart, table, verdict or hints.
    expect(list().textContent).not.toMatch(/\d/);
    expect(screen.queryByRole("list", { name: "Fairness hints" })).toBeNull();
    expect(screen.queryByRole("table", { name: /kudos received/i })).toBeNull();
    expect(screen.queryByText(/kudos received|Recognition reached|more kudos to see/i)).toBeNull();

    fireEvent.click(within(list()).getByRole("button", { name: "Send to Omar" }));
    await waitFor(() =>
      expect((screen.getByLabelText("To") as HTMLSelectElement).value).toBe("team:m-omar")
    );
    expect(screen.getByLabelText("Thank you for")).toHaveFocus();
  });

  it("names a teammate by their first name on the button", () => {
    seed([], { teamMembers: [{ id: "m-sl", name: "Sam Lee" }] });
    renderPage();
    expect(listed()).toEqual(["Sam Lee"]);
    expect(within(list()).getByRole("button", { name: "Send to Sam" })).toBeInTheDocument();
  });

  it("says when everyone has been thanked", () => {
    seed([kudo("Sam"), kudo("Priya"), kudo("OMAR")]);
    renderPage();
    expect(
      screen.getByText("Everyone on your team has been thanked in the last 30 days.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Not thanked yet" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
  });

  it("asks for the team on the Team page when there is no roster", () => {
    seed([kudo("Sam")], { teamMembers: [] });
    renderPage();
    const link = screen.getByRole("link", { name: "Team page" });
    expect(link).toHaveAttribute("href", "/team");
    expect(link.closest("p")?.textContent).toBe(
      "Add your teammates on the Team page to see who hasn't been thanked yet."
    );
    expect(screen.queryByRole("list", { name: "Not thanked yet" })).toBeNull();
    expect(screen.queryByText(/Everyone on your team/)).toBeNull();
    // And the Markdown leaves the section out.
    expect(screen.getByTestId("export-markdown").textContent).not.toContain("Not thanked yet");
  });

  it("reads the sprint when one has dates, then the last 30 days, then all time", () => {
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
    seed(
      [
        kudo("Sam", { sentAt: daysAgo(2) }),
        kudo("Priya", { sentAt: daysAgo(20) }),
        kudo("Omar", { sentAt: daysAgo(40) }),
      ],
      { sprints: [sprint] }
    );
    renderPage();
    expect(screen.getByRole("radio", { name: "Sprint" })).toBeChecked();
    expect(
      screen.getByText("No kudos have reached these teammates in Sprint 12.")
    ).toBeInTheDocument();
    expect(listed()).toEqual(["Priya", "Omar"]);

    fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
    expect(
      screen.getByText("No kudos have reached these teammates in the last 30 days.")
    ).toBeInTheDocument();
    expect(listed()).toEqual(["Omar"]);

    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(screen.getByText("Everyone on your team has been thanked so far.")).toBeInTheDocument();
    // The Markdown follows the window.
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "## Not thanked yet so far\n\nEveryone on your team has been thanked so far."
    );
  });

  it("exports who hasn't been thanked and the wall as Markdown", () => {
    seed([kudo("Sam", { message: "Shipped the fix" })]);
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Kudos wall");
    expect(md).toContain("## Not thanked yet in the last 30 days\n\n- Priya\n- Omar\n");
    expect(md).not.toContain("| Sam |");
    // A card saved under an original theme is named as the card it is drawn as.
    expect(md).toContain("**Thank you!** to Sam from Mia");
  });

  it("shows How kudos cards work below, with the owner's line on Send kudos", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "How kudos cards work" })).toBeInTheDocument();
    expect(
      screen.getByText("Online, Send kudos pins it on your squad's wall.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Online, Send kudos gives you a link and an image to pass on.")
    ).toBeNull();
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
    // Not thanked yet reads the example's own team: Omar, with no button to send him one.
    const notThankedList = screen.getByRole("list", { name: "Not thanked yet" });
    expect(
      within(notThankedList)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Omar"]);
    expect(
      screen.getByText("No kudos have reached these teammates in the last 30 days.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
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

describe("Kudos settings", () => {
  it("has the AI and beacon switches, and no custom themes: the cards are the printed ones", () => {
    render(<KudosSettings open onOpenChange={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "Kudos settings" });
    expect(within(dialog).getAllByRole("switch")).toHaveLength(5);
    expect(within(dialog).getByRole("heading", { name: "AI features" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Beacon visibility" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/custom theme/i)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Add theme/ })).toBeNull();

    fireEvent.click(within(dialog).getByRole("switch", { name: /Sentiment analysis/ }));
    expect(useKudosSettingsStore.getState().aiSentiment).toBe(false);
    useKudosSettingsStore.setState({ aiSentiment: true });
  });
});
