// @vitest-environment node
/**
 * Release notes from the stories a release ships: the stories to suggest
 * (done since the previous ship, up to this one's day, not linked
 * elsewhere), the template (New, Fixed, Changed; keys only for the team;
 * big releases within the caps), the check on an AI draft (no invented
 * story, every story covered), the text, the reopen line, the Markdown, and
 * the next step for a shipped release with no notes.
 */

import { describe, expect, it } from "vitest";
import {
  ALSO_SECTION,
  NOTES_ITEMS_MAX,
  NOTES_TEXT_MAX,
  checkedDraft,
  cleanTitle,
  draftReleaseNotes,
  draftText,
  linkedStoriesOf,
  notesOutdatedFor,
  notesStoryOf,
  previousShipDay,
  releaseNotesMarkdown,
  suggestReleaseStories,
  type NotesInput,
  type NotesStory,
} from "@/lib/releases/notes";
import { releaseNotesSteps } from "@/lib/releases/notes-steps";
import type { Release, ReleaseReadiness, Story } from "@/lib/stores/workspace-types";

const TODAY = "2026-11-23";
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();
const story = (id: string, doneDay: string | null, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  ...(doneDay ? { doneAt: at(doneDay) } : {}),
  ...over,
});
const release = (id: string, over: Partial<Release> = {}): Release => ({
  id,
  name: `Release ${id}`,
  plannedDate: TODAY,
  status: "planning",
  gates: {},
  ...over,
});
const docOf = (...releases: Release[]): ReleaseReadiness => ({ id: "rr", releases });

describe("suggestReleaseStories", () => {
  const shipped = release("r1", { status: "shipped", shippedDate: "2026-11-10" });
  const next = release("r2");
  const doc = docOf(next, shipped);
  const stories = [
    story("old", "2026-11-05"),
    story("onShipDay", "2026-11-10"),
    story("after1", "2026-11-12"),
    story("after2", "2026-11-20"),
    story("future", "2026-11-25"),
    story("undated", null),
    story("open", "2026-11-15", { status: "in_progress" }),
    story("example-s", "2026-11-15"),
  ];

  it("offers what was done after the previous ship, up to today, newest first, undated last", () => {
    expect(previousShipDay(doc, next, TODAY)).toBe("2026-11-10");
    expect(suggestReleaseStories(next, doc, stories, TODAY).map((s) => s.id)).toEqual([
      "after2",
      "after1",
      "undated",
    ]);
  });

  it("offers a shipped release what was done up to its ship day", () => {
    expect(suggestReleaseStories(shipped, doc, stories, TODAY).map((s) => s.id)).toEqual([
      "onShipDay",
      "old",
      "undated",
    ]);
  });

  it("leaves out stories this or another release links", () => {
    const linked = docOf(release("r2", { storyIds: ["after1"] }), {
      ...shipped,
      storyIds: ["after2"],
    });
    expect(
      suggestReleaseStories(linked.releases[0], linked, stories, TODAY).map((s) => s.id)
    ).toEqual(["undated"]);
  });

  it("splits a release's linked stories into done, not done and gone", () => {
    const r = release("r", { storyIds: ["after1", "open", "nope", "after1"] });
    const out = linkedStoriesOf(r, stories);
    expect(out.done.map((s) => s.id)).toEqual(["after1"]);
    expect(out.notDone.map((s) => s.id)).toEqual(["open"]);
    expect(out.missing).toEqual(["nope"]);
  });
});

describe("the template", () => {
  const ns = (
    id: string,
    kind: NotesStory["kind"],
    over: Partial<NotesStory> = {}
  ): NotesStory => ({
    id,
    title: `Title ${id}`,
    kind,
    ...over,
  });
  const input = (over: Partial<NotesInput> = {}): NotesInput => ({
    release: "v3.4",
    date: TODAY,
    audience: "customers",
    rolledBack: false,
    stories: [ns("a", "new"), ns("b", "fix"), ns("c", "change"), ns("d", "new")],
    ...over,
  });

  it("writes New, Fixed and Changed, with a headline and an intro", () => {
    const d = draftReleaseNotes(input());
    expect(d.headline).toBe("v3.4: what's new");
    expect(d.intro).toBe("Here is what's in v3.4: 2 new things, 1 fix, 1 change.");
    expect(d.sections).toEqual([
      {
        title: "New",
        items: [
          { text: "Title a", storyIds: ["a"] },
          { text: "Title d", storyIds: ["d"] },
        ],
      },
      { title: "Fixed", items: [{ text: "Title b", storyIds: ["b"] }] },
      { title: "Changed", items: [{ text: "Title c", storyIds: ["c"] }] },
    ]);
  });

  it("keeps ticket keys for the team only, and groups their stories by epic", () => {
    const stories = [
      ns("a", "new", { key: "K-1", epic: "Search" }),
      ns("b", "new", { key: "K-2" }),
      ns("c", "new", { key: "K-3", epic: "Basket" }),
    ];
    const team = draftReleaseNotes(input({ audience: "team", stories }));
    expect(team.sections[0].items.map((i) => i.text)).toEqual([
      "Title c (K-3)",
      "Title a (K-1)",
      "Title b (K-2)",
    ]);
    expect(team.intro).toMatch(/^v3\.4 ships 3 stories/);
  });

  it("says a rolled-back release was rolled back", () => {
    expect(draftReleaseNotes(input({ rolledBack: true })).intro).toMatch(/It was rolled back/);
  });

  it("fits forty stories of one kind in ten items", () => {
    const many = Array.from({ length: 40 }, (_, i) => ns(`s${i}`, "fix"));
    const d = draftReleaseNotes(input({ stories: many }));
    expect(d.sections[0].items).toHaveLength(NOTES_ITEMS_MAX);
    expect(d.sections[0].items.flatMap((i) => i.storyIds)).toHaveLength(40);
    expect(d.sections[0].items.every((i) => i.storyIds.length <= 5 && i.text.length <= 160)).toBe(
      true
    );
  });

  it("refuses a release with no stories", () => {
    expect(() => draftReleaseNotes(input({ stories: [] }))).toThrow();
  });

  it("reads a story for the notes: a cleaned title, its kind, notes only when asked, keys for the team", () => {
    const s: Story = {
      id: "s",
      title: "CHK-12: one-page checkout",
      status: "done",
      notes: "Behind checkout_v2",
      ticketKey: "CHK-12",
      tags: ["bug"],
    };
    expect(notesStoryOf(s, { audience: "customers", includeNotes: false })).toEqual({
      id: "s",
      title: "One-page checkout",
      kind: "fix",
    });
    expect(
      notesStoryOf(s, { audience: "team", includeNotes: true, epicTitle: "Checkout" })
    ).toEqual({
      id: "s",
      title: "One-page checkout",
      kind: "fix",
      notes: "Behind checkout_v2",
      epic: "Checkout",
      key: "CHK-12",
    });
    expect(cleanTitle("  [PAY-4] retry payments ")).toBe("Retry payments");
  });

  describe("checking an AI draft", () => {
    it("drops unknown stories and empty items, and puts back what it left out", () => {
      const checked = checkedDraft(
        {
          headline: "v3.4",
          intro: "Hello",
          sections: [
            { title: "Highlights", items: [{ text: "Search", storyIds: ["a", "ghost"] }] },
            { title: "Invented", items: [{ text: "Teleport", storyIds: ["ghost"] }] },
          ],
        },
        input()
      );
      expect(checked.sections.map((s) => s.title)).toEqual(["Highlights", ALSO_SECTION]);
      expect(checked.sections[0].items[0].storyIds).toEqual(["a"]);
      expect(checked.sections[1].items.flatMap((i) => i.storyIds)).toEqual(["b", "c", "d"]);
    });

    it("keeps a draft that covers every story as it is", () => {
      const d = draftReleaseNotes(input());
      expect(checkedDraft(d, input())).toEqual(d);
    });
  });

  it("makes the text: headline, intro, then each section's items, within the cap", () => {
    const text = draftText(draftReleaseNotes(input()));
    expect(text).toBe(
      "v3.4: what's new\n\nHere is what's in v3.4: 2 new things, 1 fix, 1 change.\n\nNew\n- Title a\n- Title d\n\nFixed\n- Title b\n\nChanged\n- Title c"
    );
    const long = draftText({ headline: "h", intro: "x".repeat(5000), sections: [] });
    expect(long.length).toBe(NOTES_TEXT_MAX);
  });
});

describe("after a reopen", () => {
  it("says which ship the notes were written for", () => {
    const notes = { audience: "customers" as const, text: "Notes", updatedAt: at("2026-11-01") };
    expect(
      notesOutdatedFor({ releaseNotes: notes, previousShips: [{ shippedDate: "2026-11-03" }] })
    ).toBe("2026-11-03");
    expect(
      notesOutdatedFor({
        releaseNotes: { ...notes, updatedAt: at("2026-11-10") },
        previousShips: [{ shippedDate: "2026-11-03" }],
      })
    ).toBeNull();
    expect(notesOutdatedFor({ releaseNotes: notes })).toBeNull();
  });
});

describe("the Markdown", () => {
  it("is one section with the audience, or nothing without notes", () => {
    expect(
      releaseNotesMarkdown({
        name: "v3.4",
        releaseNotes: { audience: "team", text: "Line one\n- a", updatedAt: "" },
      })
    ).toBe("## Release notes — v3.4\n\n_For the team._\n\nLine one\n- a\n");
    expect(releaseNotesMarkdown({ name: "v3.4" })).toBe("");
  });
});

describe("the next step", () => {
  const stories = [story("s1", "2026-11-10")];
  const shipped = (over: Partial<Release> = {}) =>
    release("r1", { status: "shipped", shippedDate: "2026-11-15", storyIds: ["s1"], ...over });

  it("asks for notes on a release that shipped in the last 14 days, links stories and has none", () => {
    expect(releaseNotesSteps({ doc: docOf(shipped()), stories, today: TODAY })).toEqual([
      {
        id: "release-notes",
        label: "Write the release notes for Release r1",
        detail: "It went out on 2026-11-15 with 1 story linked, and has no notes yet.",
        href: "/release-readiness",
      },
    ]);
  });

  it("stays quiet with notes, with no linked stories, for an old ship, a planning release or the example", () => {
    const quiet = (r: Release) => releaseNotesSteps({ doc: docOf(r), stories, today: TODAY });
    expect(
      quiet(shipped({ releaseNotes: { audience: "team", text: "x", updatedAt: "" } }))
    ).toEqual([]);
    expect(quiet(shipped({ storyIds: [] }))).toEqual([]);
    expect(quiet(shipped({ storyIds: ["gone"] }))).toEqual([]);
    expect(quiet(shipped({ shippedDate: "2026-11-08" }))).toEqual([]);
    expect(quiet(release("r1", { storyIds: ["s1"] }))).toEqual([]);
    expect(quiet(shipped({ id: "example-r" }))).toEqual([]);
    expect(releaseNotesSteps({ doc: undefined, stories, today: TODAY })).toEqual([]);
  });
});
