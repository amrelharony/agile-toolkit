/**
 * A story's notes, acceptance criteria, link and ticket key: the caps, the
 * cleaning every write runs, the details form's validation, and the two
 * write paths that must both hold them to it (the workspace store and the
 * agents' `workspace.story.*`, browser and MCP).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
  };
});

import { registry } from "@/lib/actions/registry";
import "@/lib/actions/workspace/index";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { planToMarkdown } from "@/app/(tools)/sprint-planning/markdown";
import { toMarkdown as refinementMarkdown } from "@/app/(tools)/refinement/markdown";
import { refinementSession } from "@/app/(tools)/refinement/session";
import {
  STORY_CRITERIA_MAX,
  STORY_LINK_MAX,
  STORY_NOTES_MAX,
  STORY_TICKET_KEY_MAX,
  cleanStoryFields,
  hasStoryDetails,
  storyDetailsDraft,
  storyLink,
  storyNotes,
  storyPokerDescription,
  validateStoryDetails,
  withStoryDetails,
} from "@/lib/stories/fields";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}
const saved = () => useWorkspaceStore.getState().stories.find((s) => s.id === "st1");

describe("a story link", () => {
  it("keeps only an http or https address with a host", () => {
    expect(storyLink("https://tracker.example.com/browse/PAY-12")).toBe(
      "https://tracker.example.com/browse/PAY-12"
    );
    expect(storyLink("  http://localhost:8080/issue/7  ")).toBe("http://localhost:8080/issue/7");
    for (const bad of [
      "",
      "tracker.example.com/PAY-12",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "ftp://files.example.com/x",
      "mailto:po@example.com",
      "https://",
      "https://tracker.example.com/a b",
      "https://tracker.example.com/\njavascript:alert(1)",
      `https://tracker.example.com/${"x".repeat(STORY_LINK_MAX)}`,
      42,
      null,
    ]) {
      expect(storyLink(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("cleaning the four fields", () => {
  it("trims, caps and drops what is empty or not a web link", () => {
    const out = cleanStoryFields(
      story({
        notes: `  ${"n".repeat(STORY_NOTES_MAX + 50)}  `,
        acceptanceCriteria: "Given a saved card\r\nWhen I pay\r\nThen it is charged\n\n",
        link: "javascript:alert(1)",
        ticketKey: `  PAY-12\t${"k".repeat(STORY_TICKET_KEY_MAX)} `,
      })
    );
    expect(out.notes).toHaveLength(STORY_NOTES_MAX);
    expect(out.acceptanceCriteria).toBe("Given a saved card\nWhen I pay\nThen it is charged");
    expect("link" in out).toBe(false);
    expect(out.ticketKey).toHaveLength(STORY_TICKET_KEY_MAX);
    expect(out.ticketKey?.startsWith("PAY-12 k")).toBe(true);
    expect(cleanStoryFields(story({ acceptanceCriteria: "x".repeat(5000) }))).toMatchObject({
      acceptanceCriteria: "x".repeat(STORY_CRITERIA_MAX),
    });
  });

  it("leaves no key behind for a blank field", () => {
    const out = cleanStoryFields(story({ notes: "   ", ticketKey: "", link: undefined }));
    expect(out).toEqual(story());
    expect(Object.keys(out).sort()).toEqual(["id", "status", "title"]);
  });

  it("hands back the same object when there is nothing to clean", () => {
    const plain = story();
    expect(cleanStoryFields(plain)).toBe(plain);
    const full = story({
      notes: "Card on file only",
      acceptanceCriteria: "- charged once",
      link: "https://tracker.example.com/PAY-12",
      ticketKey: "PAY-12",
    });
    expect(cleanStoryFields(full)).toBe(full);
  });

  it("keeps a description that arrived with a story as notes, capped", () => {
    expect(storyNotes("  Refunds within 30 days\r\nNo partial refunds  ")).toBe(
      "Refunds within 30 days\nNo partial refunds"
    );
    expect(storyNotes("d".repeat(3000))).toHaveLength(STORY_NOTES_MAX);
    expect(storyNotes("   ")).toBeUndefined();
    expect(storyNotes(undefined)).toBeUndefined();
  });
});

describe("the details form", () => {
  const draft = (over: Partial<ReturnType<typeof storyDetailsDraft>> = {}) => ({
    ...storyDetailsDraft({}),
    ...over,
  });

  it("starts from the story's own values, blank where it has none", () => {
    expect(storyDetailsDraft(story({ notes: "Card on file only", ticketKey: "PAY-12" }))).toEqual({
      notes: "Card on file only",
      acceptanceCriteria: "",
      link: "",
      ticketKey: "PAY-12",
    });
  });

  it("saves only the fields that hold something", () => {
    const result = validateStoryDetails(
      draft({ notes: "  Card on file only ", link: " https://tracker.example.com/PAY-12 " })
    );
    expect(result).toEqual({
      ok: true,
      values: { notes: "Card on file only", link: "https://tracker.example.com/PAY-12" },
    });
    expect(validateStoryDetails(draft())).toEqual({ ok: true, values: {} });
  });

  it("says what is wrong with a link instead of dropping it", () => {
    const result = validateStoryDetails(draft({ link: "tracker.example.com/PAY-12" }));
    expect(result).toEqual({
      ok: false,
      errors: { link: "Enter a web address that starts with http:// or https://." },
    });
    expect(validateStoryDetails(draft({ link: "javascript:alert(1)" })).ok).toBe(false);
  });

  it("names each field that is too long", () => {
    const result = validateStoryDetails(
      draft({
        notes: "n".repeat(STORY_NOTES_MAX + 1),
        acceptanceCriteria: "c".repeat(STORY_CRITERIA_MAX + 1),
        link: `https://tracker.example.com/${"x".repeat(STORY_LINK_MAX)}`,
        ticketKey: "k".repeat(STORY_TICKET_KEY_MAX + 1),
      })
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        notes: "Keep the notes to 2,000 characters or fewer.",
        acceptanceCriteria: "Keep the acceptance criteria to 2,000 characters or fewer.",
        link: "Keep the link to 500 characters or fewer.",
        ticketKey: "Keep the ticket key to 50 characters or fewer.",
      },
    });
  });

  it("sets what was typed and removes what was cleared", () => {
    const before = story({ notes: "Old", ticketKey: "PAY-12", points: 5 });
    const after = withStoryDetails(before, { acceptanceCriteria: "- charged once" });
    expect(after).toEqual(story({ acceptanceCriteria: "- charged once", points: 5 }));
    expect("notes" in after).toBe(false);
    expect(hasStoryDetails(after)).toBe(true);
    expect(hasStoryDetails(story({ notes: "  " }))).toBe(false);
  });
});

describe("what Planning Poker shows", () => {
  it("folds the notes and the acceptance criteria into one description", () => {
    expect(
      storyPokerDescription(
        story({
          notes: "Card on file only",
          acceptanceCriteria: "- charged once\n- receipt sent",
          link: "https://tracker.example.com/PAY-12",
          ticketKey: "PAY-12",
        })
      )
    ).toBe("Card on file only\n\nAcceptance criteria:\n- charged once\n- receipt sent");
    expect(storyPokerDescription(story({ notes: "Card on file only" }))).toBe("Card on file only");
    expect(storyPokerDescription(story({ acceptanceCriteria: "- charged once" }))).toBe(
      "Acceptance criteria:\n- charged once"
    );
    expect(storyPokerDescription(story())).toBeUndefined();
  });

  it("stays inside the session's 5,000 characters", () => {
    const text = storyPokerDescription(
      story({ notes: "n".repeat(STORY_NOTES_MAX), acceptanceCriteria: "c".repeat(5000) })
    );
    expect(text?.length).toBeLessThanOrEqual(5000);
  });
});

describe("the workspace store", () => {
  beforeEach(() => useWorkspaceStore.setState({ stories: [] }));

  it("cleans the four fields on every write, whoever wrote them", () => {
    useWorkspaceStore.getState().upsertStory(
      story({
        notes: `  ${"n".repeat(2500)}`,
        link: "javascript:alert(1)",
        ticketKey: " PAY-12 ",
        acceptanceCriteria: "",
      })
    );
    const s = saved()!;
    expect(s.notes).toHaveLength(STORY_NOTES_MAX);
    expect(s.ticketKey).toBe("PAY-12");
    expect("link" in s).toBe(false);
    expect("acceptanceCriteria" in s).toBe(false);
  });

  it("cleans a bulk write too", () => {
    useWorkspaceStore.getState().bulkUpsertStories([story({ link: "ftp://x.example.com" })]);
    expect(saved() && "link" in saved()!).toBe(false);
  });
});

describe("workspace.story actions", () => {
  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({ stories: [story({ status: "todo" })] });
  });

  const update = (patch: Record<string, unknown>) =>
    registry.get("workspace.story.update")!.handler({ id: "st1", patch }, ctx());

  it("an agent can write the four fields, and an update keeps them", async () => {
    await update({
      notes: "Card on file only",
      acceptanceCriteria: "- charged once",
      link: "https://tracker.example.com/PAY-12",
      ticketKey: "PAY-12",
    });
    await update({ points: 5 });
    expect(saved()).toMatchObject({
      points: 5,
      notes: "Card on file only",
      acceptanceCriteria: "- charged once",
      link: "https://tracker.example.com/PAY-12",
      ticketKey: "PAY-12",
    });
  });

  it("rejects a value that is too long or a link that isn't http or https", async () => {
    await expect(update({ notes: "n".repeat(STORY_NOTES_MAX + 1) })).rejects.toThrow();
    await expect(
      update({ acceptanceCriteria: "c".repeat(STORY_CRITERIA_MAX + 1) })
    ).rejects.toThrow();
    await expect(update({ ticketKey: "k".repeat(STORY_TICKET_KEY_MAX + 1) })).rejects.toThrow();
    await expect(update({ link: "javascript:alert(1)" })).rejects.toThrow(/http or https/);
    await expect(update({ link: "tracker.example.com/PAY-12" })).rejects.toThrow();
    expect(saved()).toEqual(expect.not.objectContaining({ notes: expect.anything() }));
  });

  it('clears a field sent as ""', async () => {
    await update({ notes: "Card on file only", link: "https://tracker.example.com/PAY-12" });
    await update({ notes: "", link: "" });
    expect("notes" in saved()!).toBe(false);
    expect("link" in saved()!).toBe(false);
  });

  it("holds a create to the same rules", async () => {
    // The transport checks a create against its schema before the handler runs.
    const action = registry.get("workspace.story.create")!;
    const accepts = (entity: Record<string, unknown>) =>
      action.paramsSchema.safeParse({ entity }).success;
    expect(accepts({ title: "Refunds", status: "backlog", link: "data:text/html,x" })).toBe(false);
    expect(accepts({ title: "Refunds", status: "backlog", notes: "n".repeat(2001) })).toBe(false);
    expect(
      accepts({ title: "Refunds", status: "backlog", link: "https://tracker.example.com/PAY-13" })
    ).toBe(true);
    // And whatever reaches the handler is cleaned before it is saved.
    await action.handler(
      { entity: { title: "Refunds", status: "backlog", ticketKey: " PAY-13 ", link: "ftp://x" } },
      ctx()
    );
    const made = useWorkspaceStore.getState().stories.find((s) => s.title === "Refunds");
    expect(made?.ticketKey).toBe("PAY-13");
    expect(made && "link" in made).toBe(false);
  });

  it("validates and cleans on the MCP path too", async () => {
    rows.set("workspace:story/st1", story({ status: "todo" }));
    const mcp = registry.get("workspace.story.update")!.mcpHandler!;
    await expect(mcp({ id: "st1", patch: { link: "javascript:alert(1)" } }, ctx())).rejects.toThrow(
      /http or https/
    );
    await mcp({ id: "st1", patch: { notes: "  Card on file only  ", ticketKey: "" } }, ctx());
    const row = rows.get("workspace:story/st1") as Story;
    expect(row.notes).toBe("Card on file only");
    expect("ticketKey" in row).toBe(false);
  });
});

describe("share links", () => {
  // A share link carries a tool's Markdown, and is capped at 32 KB: the
  // four fields (up to 4,550 characters a story) stay out of it.
  const detailed = story({
    status: "todo",
    sprintId: "s2",
    points: 5,
    notes: "NOTES-MARKER card on file only",
    acceptanceCriteria: "CRITERIA-MARKER charged once",
    link: "https://tracker.example.com/LINK-MARKER",
    ticketKey: "KEY-MARKER",
  });
  const markers = ["NOTES-MARKER", "CRITERIA-MARKER", "LINK-MARKER", "KEY-MARKER"];

  it("Sprint Planning's Markdown leaves them out", () => {
    const md = planToMarkdown({
      sprint: {
        id: "s2",
        name: "Sprint 2",
        startDate: "2026-10-15",
        endDate: "2026-10-25",
        pointsPlanned: 0,
        status: "planned",
      },
      stories: [detailed],
      capacityHours: null,
      targetPoints: null,
      averageVelocity: null,
    });
    expect(md).toContain("| Pay with a saved card | 5 |");
    for (const marker of markers) expect(md).not.toContain(marker);
  });

  it("Refinement's Markdown leaves them out", () => {
    const md = refinementMarkdown(
      refinementSession([{ ...detailed, sprintId: undefined, status: "backlog" }]),
      [{ id: "c1", label: "Acceptance criteria defined" }],
      []
    );
    expect(md).toContain("| Pay with a saved card | 5 |");
    for (const marker of markers) expect(md).not.toContain(marker);
  });
});
