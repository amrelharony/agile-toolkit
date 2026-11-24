// @vitest-environment node
/**
 * lib/stories/kind: a story is a fix, a change or something new, read from
 * its tags, where it came from and how its title starts. Release notes and
 * Flow Insights both class stories with it.
 */

import { describe, expect, it } from "vitest";
import { BUG_TAG, storyKind } from "@/lib/stories/kind";
import type { Story } from "@/lib/stores/workspace-types";

const story = (patch: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Search the catalogue",
  status: "todo",
  ...patch,
});

describe("storyKind", () => {
  it("tags a Bug Triage story with the bug tag", () => {
    expect(BUG_TAG).toBe("bug");
    expect(storyKind(story({ tags: [BUG_TAG] }))).toBe("fix");
  });

  it("reads a bug or fix tag, in any case, as a fix", () => {
    expect(storyKind(story({ tags: ["checkout", "Bug"] }))).toBe("fix");
    expect(storyKind(story({ tags: ["FIX"] }))).toBe("fix");
    expect(storyKind(story({ tags: [" fix "] }))).toBe("fix");
    // Only the whole tag counts.
    expect(storyKind(story({ tags: ["debug", "prefix", "bugs-team"] }))).toBe("new");
  });

  it("reads a story sent from Bug Triage as a fix", () => {
    expect(storyKind(story({ sourceRef: { tool: "bug-triage", id: "bug_1" } }))).toBe("fix");
    expect(storyKind(story({ sourceRef: { tool: "retro", id: "c1" } }))).toBe("new");
  });

  it("reads a title starting with Fix or Bug as a fix", () => {
    expect(storyKind(story({ title: "Fix the login timeout" }))).toBe("fix");
    expect(storyKind(story({ title: "Bug: totals round wrong" }))).toBe("fix");
    expect(storyKind(story({ title: "fixes for the export" }))).toBe("fix");
    expect(storyKind(story({ title: "  Bugfix in search" }))).toBe("fix");
  });

  it("reads a title starting with Change, Update, Improve, Rename or Remove as a change", () => {
    for (const title of [
      "Change the default currency",
      "Update the pricing page",
      "Improve search speed",
      "Rename teams to squads",
      "Remove the old export",
      "updates to the footer",
    ]) {
      expect(storyKind(story({ title })), title).toBe("change");
    }
  });

  it("reads anything else as new", () => {
    expect(storyKind(story())).toBe("new");
    expect(storyKind(story({ title: "Add a dark theme", tags: ["ui"] }))).toBe("new");
    // A word in the middle doesn't count.
    expect(storyKind(story({ title: "Login bug and update" }))).toBe("new");
  });

  it("puts a fix ahead of a change", () => {
    expect(storyKind(story({ title: "Update the login", tags: ["bug"] }))).toBe("fix");
    expect(
      storyKind(story({ title: "Improve errors", sourceRef: { tool: "bug-triage", id: "b" } }))
    ).toBe("fix");
  });

  it("reads a hand-edited row as far as it can", () => {
    const odd = { id: "x", title: 42, tags: "bug", status: "todo" } as unknown as Story;
    expect(storyKind(odd)).toBe("new");
    expect(storyKind({ ...odd, tags: [null, "Fix"] } as unknown as Story)).toBe("fix");
  });
});
