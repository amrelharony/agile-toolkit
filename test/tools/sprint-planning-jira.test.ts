/**
 * Sprint Planning's Jira import, the logic (sprint-planning/jira.ts): what
 * a Jira Cloud CSV export would add to the backlog, which points it would
 * change on stories already here (matched by ticket key), what it leaves
 * out and why; the site address and the link it makes; the stories built;
 * and the words. The exports are written from Atlassian's documented format
 * (test/jira/fixtures.ts), not from a live site.
 */

import { describe, expect, it } from "vitest";
import type { Story } from "@/lib/stores/workspace-types";
import {
  JIRA_NOTES_MAX,
  jiraImportBytes,
  jiraImportLabel,
  jiraImportSummary,
  jiraImportToast,
  jiraIssueLink,
  jiraSiteFrom,
  jiraStories,
  planJiraImport,
  pointsChangeText,
  previewJiraImport,
  readJiraSite,
} from "@/app/(tools)/sprint-planning/jira";
import { readJiraCsv } from "@/lib/jira/csv-export";
import { ALL_FIELDS_EXPORT, CURRENT_FIELDS_EXPORT } from "../jira/fixtures";

const SITE = "https://your-team.atlassian.net";

describe("previewJiraImport: a first import", () => {
  const preview = previewJiraImport(ALL_FIELDS_EXPORT, { stories: [], site: SITE });

  it("makes a backlog story of every issue, with what each column becomes", () => {
    expect(preview.problem).toBeNull();
    expect(preview.errors).toEqual([]);
    expect(preview.add).toEqual([
      {
        line: 2,
        key: "PAY-12",
        title: "Pay with a saved card",
        points: 5,
        owner: "Sam Lee",
        notes:
          "As a returning customer, I want to pay with a saved card.\n\nThe card shows its last four digits.",
        link: "https://your-team.atlassian.net/browse/PAY-12",
      },
      {
        line: 5,
        key: "PAY-13",
        title: "Remove a saved card",
        points: 3,
        notes: "Short, with a comma",
        link: "https://your-team.atlassian.net/browse/PAY-13",
      },
      {
        line: 6,
        key: "PAY-14",
        title: 'Fraud "velocity" checks',
        points: 2.5,
        owner: "Bo Chen",
        link: "https://your-team.atlassian.net/browse/PAY-14",
      },
      {
        line: 7,
        key: "PAY-15",
        title: "Card nicknames",
        link: "https://your-team.atlassian.net/browse/PAY-15",
      },
    ]);
    expect(preview.update).toEqual([]);
    expect(preview.unchanged).toEqual([]);
  });

  it("lists the columns found and what each becomes, the ones left out, and the rest", () => {
    expect(preview.mapped).toEqual([
      { header: "Issue key", becomes: "the ticket key, and the link to the issue" },
      { header: "Summary", becomes: "the title" },
      {
        header: "Custom field (Story point estimate), Custom field (Story Points)",
        becomes: "the points, from the first one filled in on each row",
      },
      { header: "Assignee", becomes: "the owner" },
      { header: "Description", becomes: "the notes, its first 500 characters" },
    ]);
    expect(preview.unused).toEqual([
      { header: "Status", why: "not used, since every story lands in the backlog" },
      { header: "Priority", why: "not used, since the backlog keeps its own order" },
      { header: "Labels", why: "not used" },
      { header: "Due date", why: "not used" },
    ]);
    expect(preview.ignored).toEqual([
      "Issue id",
      "Issue Type",
      "Project key",
      "Reporter",
      "Created",
      "Sprint (2 columns)",
    ]);
  });

  it("names one points column plainly, and says which copy of any other column is read", () => {
    const p = previewJiraImport(
      "Issue key,Summary,Story Points,Key,Status,Status\nA-1,One,3,B-1,To Do,Done",
      { stories: [], site: null }
    );
    expect(p.mapped).toEqual([
      {
        header: "Issue key",
        becomes: "the ticket key. Add your site address below for a link to the issue.",
      },
      { header: "Summary", becomes: "the title" },
      { header: "Story Points", becomes: "the points" },
    ]);
    expect(p.unused).toEqual([
      { header: "Key", why: "not read, since Issue key comes first" },
      { header: "Status", why: "not used, since every story lands in the backlog" },
    ]);
    expect(p.add.map((r) => r.key)).toEqual(["A-1"]);
  });

  it("without a site address, no links, and the key's line says how to get them", () => {
    const bare = previewJiraImport(ALL_FIELDS_EXPORT, { stories: [], site: null });
    expect(bare.add.every((r) => r.link === undefined)).toBe(true);
    expect(bare.mapped[0].becomes).toBe(
      "the ticket key. Add your site address below for a link to the issue."
    );
  });

  it("keeps the first 500 characters of a description, and cuts a title to 200", () => {
    const long = "x".repeat(JIRA_NOTES_MAX + 40);
    const title = `T${"t".repeat(230)}`;
    const p = previewJiraImport(`Issue key,Summary,Description\nA-1,${title},${long}\nA-2,Short,`, {
      stories: [],
      site: null,
    });
    expect(p.add[0].notes).toHaveLength(JIRA_NOTES_MAX);
    expect(p.add[0].title).toHaveLength(200);
    expect(p.add[1]).toEqual({ line: 3, key: "A-2", title: "Short" });
    expect(p.titlesCut).toBe(1);
    expect(p.notesCut).toBe(1);
    expect(jiraImportSummary(p)).toBe(
      "2 stories to add to the backlog. 1 title is longer than 200 characters and will be cut. 1 description is longer than 500 characters: the notes keep the first 500."
    );
  });

  it("never cuts a character in half, so the saved text stays valid JSON for the database", () => {
    // "😀" is two UTF-16 units: these put one across character 500 and 200.
    const description = `${"x".repeat(JIRA_NOTES_MAX - 1)}😀 and more`;
    const summary = `${"t".repeat(199)}😀 more`;
    const p = previewJiraImport(`Issue key,Summary,Description\nA-1,${summary},${description}`, {
      stories: [],
      site: null,
    });
    expect(p.add[0].notes).toBe("x".repeat(JIRA_NOTES_MAX - 1));
    expect(p.add[0].title).toBe("t".repeat(199));
    expect(JSON.stringify(p.add[0])).not.toMatch(/\\ud8/i);
    expect(p.notesCut).toBe(1);
    expect(p.titlesCut).toBe(1);
  });

  it("refuses a key longer than a story's ticket key can be, with the rest of the reader's errors", () => {
    const key = `A-${"9".repeat(60)}`;
    const p = previewJiraImport(`Issue key,Summary\n,None\n${key},Long key\nA-3,Fine`, {
      stories: [],
      site: null,
    });
    expect(p.errors).toEqual([
      { line: 2, reason: "no issue key" },
      { line: 3, reason: "the issue key “A-999999999999999999999…” is longer than 50 characters" },
    ]);
    expect(p.add.map((r) => r.key)).toEqual(["A-3"]);
  });

  it("passes the reader's problem through, with the columns it did find", () => {
    const p = previewJiraImport("Summary,Status\nOne,To Do", { stories: [], site: null });
    expect(p.problem).toMatch(/^No issue key column found\./);
    expect(p.add).toEqual([]);
    expect(p.mapped).toEqual([{ header: "Summary", becomes: "the title" }]);
    expect(jiraImportSummary(p)).toBe("");
  });

  it("plans the same from an export read once, as the page does while the site is typed", () => {
    const read = readJiraCsv(ALL_FIELDS_EXPORT);
    for (const site of [SITE, null]) {
      expect(planJiraImport(read, { stories: [], site })).toEqual(
        previewJiraImport(ALL_FIELDS_EXPORT, { stories: [], site })
      );
    }
  });
});

describe("previewJiraImport: importing again", () => {
  const stories: Story[] = [
    {
      id: "s12",
      title: "Pay with a saved card",
      status: "todo",
      sprintId: "sp",
      points: 3,
      ticketKey: "PAY-12",
    },
    { id: "s13", title: "Remove a saved card", status: "backlog", points: 3, ticketKey: "pay-13" },
    {
      id: "s14",
      title: "Fraud checks",
      status: "done",
      sprintId: "old",
      points: 1,
      ticketKey: "PAY-14",
    },
    { id: "s15", title: "Card nicknames", status: "backlog", points: 2, ticketKey: "PAY-15" },
    { id: "x", title: "No key", status: "backlog" },
  ];
  const preview = previewJiraImport(ALL_FIELDS_EXPORT, { stories, site: SITE });

  it("adds nothing whose key is here, in any case, and changes points only", () => {
    expect(preview.add).toEqual([]);
    expect(preview.update).toEqual([
      { line: 2, key: "PAY-12", storyId: "s12", title: "Pay with a saved card", from: 3, to: 5 },
    ]);
    expect(preview.unchanged).toEqual([
      { line: 5, key: "PAY-13", title: "Remove a saved card", why: "same points" },
      {
        line: 6,
        key: "PAY-14",
        title: "Fraud checks",
        why: "done, so its points stay as its sprint counted them",
      },
      { line: 7, key: "PAY-15", title: "Card nicknames", why: "no points in the file" },
    ]);
    expect(jiraImportSummary(preview)).toBe(
      "No new stories. Points change on 1 story already here. 3 stories already here stay as they are."
    );
    expect(jiraImportLabel(preview)).toBe("Update points on 1 story");
  });

  it("sizes a story that had no points, and adds the issues that are new", () => {
    const p = previewJiraImport(CURRENT_FIELDS_EXPORT, {
      stories: [{ id: "s12", title: "Pay", status: "backlog", ticketKey: "PAY-12" }],
      site: null,
    });
    expect(p.update).toEqual([{ line: 2, key: "PAY-12", storyId: "s12", title: "Pay", to: 8 }]);
    expect(pointsChangeText(p.update[0])).toBe("PAY-12 “Pay”: not sized to 8 points");
    expect(p.add.map((r) => r.key)).toEqual(["PAY-16"]);
    expect(jiraImportLabel(p)).toBe("Import 1 story, update 1");
    expect(jiraImportSummary(p)).toBe(
      "1 story to add to the backlog. Points change on 1 story already here."
    );
  });
});

describe("the site address", () => {
  it("takes a bare host, an https address, or any page of the site", () => {
    expect(readJiraSite("")).toEqual({ ok: true, site: null });
    expect(readJiraSite("  ")).toEqual({ ok: true, site: null });
    expect(readJiraSite("your-team.atlassian.net")).toEqual({ ok: true, site: SITE });
    expect(readJiraSite(" https://your-team.atlassian.net/ ")).toEqual({ ok: true, site: SITE });
    expect(
      readJiraSite("https://your-team.atlassian.net/jira/software/projects/PAY/boards/1")
    ).toEqual({ ok: true, site: SITE });
    expect(readJiraSite("HTTPS://Your-Team.Atlassian.net/browse/PAY-12")).toEqual({
      ok: true,
      site: SITE,
    });
  });

  it("refuses http, other schemes and what isn't an address", () => {
    const https = {
      ok: false,
      error: "Use the site's https address, such as your-team.atlassian.net.",
    };
    const what = {
      ok: false,
      error: "Enter your Jira site's address, such as your-team.atlassian.net.",
    };
    expect(readJiraSite("http://your-team.atlassian.net")).toEqual(https);
    expect(readJiraSite("ftp://your-team.atlassian.net")).toEqual(https);
    expect(readJiraSite("javascript:alert(1)")).toEqual(what);
    expect(readJiraSite("your-team")).toEqual(what);
    expect(readJiraSite("your team.atlassian.net")).toEqual(what);
    expect(readJiraSite("https://me:secret@your-team.atlassian.net")).toEqual(what);
  });

  it("links an issue as https://<site>/browse/<KEY>", () => {
    expect(jiraIssueLink(SITE, "PAY-12")).toBe(`${SITE}/browse/PAY-12`);
    expect(jiraIssueLink(SITE, "A B")).toBe(`${SITE}/browse/A%20B`);
  });

  it("finds the site an earlier import linked to, as it would be typed", () => {
    expect(jiraSiteFrom([])).toBe("");
    expect(
      jiraSiteFrom([
        {
          id: "a",
          title: "A",
          status: "backlog",
          ticketKey: "PAY-1",
          link: `${SITE}/browse/PAY-1`,
        },
        { id: "b", title: "B", status: "backlog", ticketKey: "X-1", link: "https://example.com/x" },
        { id: "c", title: "C", status: "backlog", link: `${SITE}/browse/PAY-2` },
      ])
    ).toBe("your-team.atlassian.net");
    expect(
      jiraSiteFrom([
        {
          id: "a",
          title: "A",
          status: "backlog",
          ticketKey: "X-1",
          link: "http://old.example.com/browse/X-1",
        },
      ])
    ).toBe("");
  });
});

describe("the stories it builds", () => {
  it("each in the backlog, with its key, where it came from, and only the fields it has", () => {
    const p = previewJiraImport(ALL_FIELDS_EXPORT, { stories: [], site: SITE });
    let n = 0;
    const built = jiraStories(p.add, () => `story_${++n}`);
    expect(built[0]).toEqual({
      id: "story_1",
      title: "Pay with a saved card",
      status: "backlog",
      ticketKey: "PAY-12",
      sourceRef: { tool: "jira", id: "PAY-12" },
      points: 5,
      owner: "Sam Lee",
      notes:
        "As a returning customer, I want to pay with a saved card.\n\nThe card shows its last four digits.",
      link: `${SITE}/browse/PAY-12`,
    });
    expect(built[3]).toEqual({
      id: "story_4",
      title: "Card nicknames",
      status: "backlog",
      ticketKey: "PAY-15",
      sourceRef: { tool: "jira", id: "PAY-15" },
      link: `${SITE}/browse/PAY-15`,
    });
  });

  it("counts what they add to storage, as the store saves them", () => {
    expect(jiraImportBytes({ add: [] })).toBe(0);
    const small = jiraImportBytes({ add: [{ line: 2, key: "A-1", title: "One" }] });
    const big = jiraImportBytes({
      add: [{ line: 2, key: "A-1", title: "One", notes: "n".repeat(500) }],
    });
    expect(small).toBeGreaterThan(100);
    expect(big - small).toBe(1000 + 2 * '"notes":"",'.length);
  });
});

describe("the words", () => {
  it("names the import button by what it does", () => {
    const row = { line: 2, key: "A", title: "A" };
    const change = { line: 3, key: "B", storyId: "b", title: "B", to: 2 };
    expect(jiraImportLabel({ add: [], update: [] })).toBe("Import");
    expect(jiraImportLabel({ add: [row], update: [] })).toBe("Import 1 story");
    expect(jiraImportLabel({ add: [row, row], update: [change] })).toBe(
      "Import 2 stories, update 1"
    );
  });

  it("says what the Undo toast covers", () => {
    expect(jiraImportToast(3, 0)).toEqual({
      label: "Added 3 stories to the backlog from the Jira CSV",
    });
    expect(jiraImportToast(1, 2)).toEqual({
      label: "Added 1 story to the backlog from the Jira CSV",
      description: "Points changed on 2 stories already here.",
    });
    expect(jiraImportToast(0, 1)).toEqual({ label: "Updated points on 1 story from the Jira CSV" });
  });

  it("an export with a header and no rows, and rows that all fail", () => {
    expect(
      jiraImportSummary(previewJiraImport("Issue key,Summary", { stories: [], site: null }))
    ).toBe("No issues under the header row yet.");
    expect(
      jiraImportSummary(previewJiraImport("Issue key,Summary\n,x\n,y", { stories: [], site: null }))
    ).toBe("No new stories. 2 rows can't be imported.");
  });
});
