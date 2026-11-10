/**
 * The one Jira reader (lib/jira/csv-export.ts): a Jira Cloud CSV export, in
 * the documented variants, read on the shared CSV parser into issues, with
 * the rows it can't read and the columns it found and ignored; and the
 * Canvas's Jira import reading through it. The fixtures are written from
 * Atlassian's documented export format (see ./fixtures.ts), not from a live
 * site.
 */

import { describe, expect, it } from "vitest";
import {
  JIRA_CSV_MAX_BYTES,
  JIRA_CSV_MAX_ROWS,
  jiraKeyMatch,
  readJiraCsv,
  utf8Bytes,
} from "@/lib/jira/csv-export";
import { issuesToCards, jiraSkippedText, parseJiraCsv } from "@/lib/whiteboard/jira-import";
import type { WhiteboardCard, WhiteboardObject } from "@/lib/stores/workspace-types";
import { ALL_FIELDS_EXPORT, CURRENT_FIELDS_EXPORT, SEMICOLON_EXPORT } from "./fixtures";

describe("readJiraCsv: an all-fields export", () => {
  const read = readJiraCsv(ALL_FIELDS_EXPORT);

  it("reads every issue, with the line its row starts on", () => {
    expect(read.problem).toBeNull();
    expect(read.errors).toEqual([]);
    expect(read.rows).toBe(4);
    expect(read.issues.map((i) => [i.line, i.key, i.summary])).toEqual([
      [2, "PAY-12", "Pay with a saved card"],
      // The description above spans three lines of the file.
      [5, "PAY-13", "Remove a saved card"],
      [6, "PAY-14", 'Fraud "velocity" checks'],
      [7, "PAY-15", "Card nicknames"],
    ]);
  });

  it("keeps a description's line breaks and commas, and the other fields as written", () => {
    expect(read.issues[0]).toEqual({
      line: 2,
      key: "PAY-12",
      summary: "Pay with a saved card",
      status: "To Do",
      assignee: "Sam Lee",
      priority: "Medium",
      storyPoints: 5,
      description:
        "As a returning customer, I want to pay with a saved card.\r\n\r\nThe card shows its last four digits.",
      labels: ["checkout", "cards"],
      dueDate: "20/Nov/26",
    });
    expect(read.issues[1].description).toBe("Short, with a comma");
    expect(read.issues[3]).toEqual({
      line: 7,
      key: "PAY-15",
      summary: "Card nicknames",
      status: "To Do",
      priority: "Medium",
    });
  });

  it("merges the repeated Labels columns, and takes a row's first filled points column", () => {
    expect(read.issues.map((i) => i.labels)).toEqual([
      ["checkout", "cards"],
      ["cards"],
      undefined,
      undefined,
    ]);
    // Team-managed "Story point estimate" on one row, company-managed
    // "Story Points" on another, a decimal on a third.
    expect(read.issues.map((i) => i.storyPoints)).toEqual([5, 3, 2.5, undefined]);
  });

  it("lists the columns it found, in its own order, and the ones it ignores", () => {
    const one = (column: string, header: string) => ({
      column,
      header,
      headers: [header],
      count: 1,
    });
    expect(read.found).toEqual([
      one("key", "Issue key"),
      one("summary", "Summary"),
      {
        column: "points",
        header: "Custom field (Story point estimate)",
        // Both names, since a row whose first one is blank reads the second.
        headers: ["Custom field (Story point estimate)", "Custom field (Story Points)"],
        count: 2,
      },
      one("assignee", "Assignee"),
      one("description", "Description"),
      one("status", "Status"),
      one("priority", "Priority"),
      // A repeated column is named once.
      { column: "labels", header: "Labels", headers: ["Labels"], count: 2 },
      one("dueDate", "Due date"),
    ]);
    expect(read.ignored).toEqual([
      { header: "Issue id", count: 1 },
      { header: "Issue Type", count: 1 },
      { header: "Project key", count: 1 },
      { header: "Reporter", count: 1 },
      { header: "Created", count: 1 },
      { header: "Sprint", count: 2 },
    ]);
  });
});

describe("readJiraCsv: the other documented variants", () => {
  it("a current-fields export: Key, Story point estimate, labels in one cell", () => {
    const read = readJiraCsv(CURRENT_FIELDS_EXPORT);
    expect(read.problem).toBeNull();
    expect(read.issues).toEqual([
      expect.objectContaining({
        key: "PAY-12",
        summary: "Pay with a saved card",
        storyPoints: 8,
        labels: ["checkout", "cards"],
      }),
      expect.objectContaining({ key: "PAY-16", summary: "Split a payment" }),
    ]);
    expect(read.issues[1].storyPoints).toBeUndefined();
    expect(read.found.map((f) => f.header)).toContain("Story point estimate");
  });

  it("semicolons, a decimal comma and a byte-order mark", () => {
    const read = readJiraCsv(SEMICOLON_EXPORT);
    expect(read.delimiter).toBe(";");
    expect(read.issues).toEqual([
      {
        line: 2,
        key: "PAY-20",
        summary: "Gift cards",
        status: "To Do",
        assignee: "Sam Lee",
        storyPoints: 2.5,
        description: "Sell gift cards, then redeem them",
      },
      { line: 3, key: "PAY-21", summary: "Refunds; partial", status: "To Do" },
    ]);
    expect(read.found[0]).toEqual({
      column: "key",
      header: "Issue key",
      headers: ["Issue key"],
      count: 1,
    });
  });

  it("matches headers whatever their case, and each points variant", () => {
    for (const header of [
      "Story Points",
      "story points",
      "Story point estimate",
      "Custom field (Story Points)",
      "CUSTOM FIELD (STORY POINT ESTIMATE)",
    ]) {
      const read = readJiraCsv(`ISSUE KEY,summary,${header}\nA-1,One,3`);
      expect(read.issues).toEqual([
        { line: 2, key: "A-1", summary: "One", status: "", storyPoints: 3 },
      ]);
    }
    expect(readJiraCsv("Key,Summary\nA-1,One").issues).toHaveLength(1);
  });
});

describe("readJiraCsv: rows it can't read", () => {
  it("names the line and the reason, and reads the rest", () => {
    const read = readJiraCsv(
      [
        "Issue key,Summary,Story Points",
        ",No key here,1",
        "A-2,,1",
        "A-3,Three,lots",
        "A-4,Four,-1",
        "A-5,Five,5",
        "a-5,Five again,5",
        "A-6,Six,1,extra",
        "A-7,Seven,",
      ].join("\n")
    );
    expect(read.errors).toEqual([
      { line: 2, reason: "no issue key" },
      { line: 3, reason: "A-2 has no summary" },
      { line: 4, reason: "the story points “lots” aren't a number, 0 or more" },
      { line: 5, reason: "the story points “-1” aren't a number, 0 or more" },
      { line: 7, reason: "a-5 is already on line 6" },
      {
        line: 8,
        reason: "it has 4 cells but the header names 3: put text that contains commas in quotes",
      },
    ]);
    expect(read.issues.map((i) => i.key)).toEqual(["A-5", "A-7"]);
    expect(read.rows).toBe(8);
  });

  it("refuses points too long to be a number, which would be saved as nothing", () => {
    const huge = "9".repeat(400);
    const read = readJiraCsv(`Issue key,Summary,Story Points\nA-1,One,${huge}\nA-2,Two,8`);
    expect(Number(huge)).toBe(Infinity);
    expect(read.errors).toEqual([
      { line: 2, reason: `the story points “${huge}” aren't a number, 0 or more` },
    ]);
    expect(read.issues.map((i) => [i.key, i.storyPoints])).toEqual([["A-2", 8]]);
  });

  it("needs an issue key and a summary column", () => {
    expect(readJiraCsv("Summary,Status\nOne,To Do").problem).toBe(
      "No issue key column found. The first row must name the columns, as a Jira Cloud CSV export does: “Issue key” (or “Key”) and “Summary” are needed."
    );
    expect(readJiraCsv("Title,Status\nOne,To Do").problem).toMatch(
      /^No issue key or summary column found\./
    );
    expect(readJiraCsv("Issue key\nA-1").problem).toMatch(/^No summary column found\./);
  });

  it("an empty text reads as nothing, with no problem", () => {
    expect(readJiraCsv("")).toMatchObject({ issues: [], problem: null, rows: 0 });
    expect(readJiraCsv(" \n ")).toMatchObject({ issues: [], problem: null, rows: 0 });
    expect(readJiraCsv("Issue key,Summary")).toMatchObject({ issues: [], problem: null, rows: 0 });
  });
});

describe("readJiraCsv: limits", () => {
  it(`reads the first ${JIRA_CSV_MAX_ROWS} rows and counts the rest`, () => {
    const rows = Array.from(
      { length: JIRA_CSV_MAX_ROWS + 5 },
      (_, i) => `A-${i + 1},Story ${i + 1}`
    );
    const read = readJiraCsv(["Issue key,Summary", ...rows].join("\n"));
    expect(read.issues).toHaveLength(JIRA_CSV_MAX_ROWS);
    expect(read.rows).toBe(JIRA_CSV_MAX_ROWS);
    expect(read.overCap).toBe(5);
    expect(read.issues.at(-1)?.key).toBe(`A-${JIRA_CSV_MAX_ROWS}`);
  });

  it("reads nothing of a text over 5 MB, and says what to do", () => {
    const big = `Issue key,Summary,Description\nA-1,One,"${"x".repeat(JIRA_CSV_MAX_BYTES)}"`;
    const read = readJiraCsv(big);
    expect(read.oversize).toBe(true);
    expect(read.issues).toEqual([]);
    expect(read.problem).toBe(
      "That is more than 5 MB. Export fewer issues at a time, such as one project or one sprint."
    );
  });

  it("counts the size as UTF-8", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
    expect(utf8Bytes("😀")).toBe(4);
    expect(utf8Bytes("")).toBe(0);
  });

  it("matches keys one-spaced and in upper case", () => {
    expect(jiraKeyMatch("  pay-12 ")).toBe("PAY-12");
    expect(jiraKeyMatch("PAY-12")).toBe(jiraKeyMatch("Pay-12"));
  });
});

describe("the Canvas's Jira import reads through it", () => {
  it("lays the issues out as cards by status, with labels and points", () => {
    const { issues, truncated, oversize } = parseJiraCsv(ALL_FIELDS_EXPORT);
    expect(truncated).toBe(false);
    expect(oversize).toBeUndefined();
    const objects = issuesToCards("b1", issues);
    const cards = objects.filter((o): o is WhiteboardCard => o.type === "card");
    expect(cards.map((c) => [c.title, c.status, c.points, c.tags])).toEqual([
      ["PAY-12: Pay with a saved card", "todo", 5, ["checkout", "cards"]],
      ["PAY-15: Card nicknames", "todo", undefined, undefined],
      ["PAY-13: Remove a saved card", "in_progress", 3, ["cards"]],
      ['PAY-14: Fraud "velocity" checks', "done", 2.5, undefined],
    ]);
    expect(cards[0].sourceRef).toEqual({ tool: "jira", entityId: "PAY-12" });
    expect(cards[0].assignee).toBe("Sam Lee");
    expect(cards[0].due).toBe("20/Nov/26");
  });

  it("a semicolon export reads there too, and pasting it again updates the same cards", () => {
    const first = issuesToCards("b1", parseJiraCsv(SEMICOLON_EXPORT).issues);
    const again = issuesToCards("b1", parseJiraCsv(SEMICOLON_EXPORT).issues, first);
    const cardIds = (objects: WhiteboardObject[]) =>
      objects.filter((o) => o.type === "card").map((o) => o.id);
    expect(cardIds(again)).toEqual(cardIds(first));
    expect(cardIds(first)).toHaveLength(2);
  });

  it("says when the file was cut or refused", () => {
    const rows = Array.from({ length: JIRA_CSV_MAX_ROWS + 1 }, (_, i) => `A-${i},S`);
    expect(parseJiraCsv(["Key,Summary", ...rows].join("\n")).truncated).toBe(true);
    const big = `Key,Summary\nA-1,"${"x".repeat(JIRA_CSV_MAX_BYTES)}"`;
    expect(parseJiraCsv(big)).toEqual({
      issues: [],
      skipped: [],
      problem:
        "That is more than 5 MB. Export fewer issues at a time, such as one project or one sprint.",
      truncated: false,
      oversize: true,
    });
  });

  it("lists the rows it leaves out, and says which and why under the box", () => {
    const result = parseJiraCsv(
      "Issue key,Summary,Story Points\nA-1,One,TBD\nA-2,,1\nA-3,Three,3\nA-4,Four,?\nA-5,Five,x"
    );
    expect(result.issues.map((i) => i.key)).toEqual(["A-3"]);
    expect(result.skipped.map((e) => e.line)).toEqual([2, 3, 5, 6]);
    expect(jiraSkippedText(result)).toBe(
      "4 rows can't be imported. Line 2: the story points “TBD” aren't a number, 0 or more. Line 3: A-2 has no summary. Line 5: the story points “?” aren't a number, 0 or more. And 1 more."
    );
    expect(jiraSkippedText(parseJiraCsv("Key,Summary\n,One\nA-2,Two"))).toBe(
      "1 row can't be imported. Line 2: no issue key."
    );
    expect(jiraSkippedText(parseJiraCsv(ALL_FIELDS_EXPORT))).toBeNull();
    expect(jiraSkippedText(parseJiraCsv("Title,Status\nOne,To Do"))).toMatch(
      /^No issue key or summary column found\./
    );
  });
});
