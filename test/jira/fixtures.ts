/**
 * Jira Cloud CSV exports for the tests.
 *
 * Written by hand from the CSV export format Atlassian documents for Jira
 * Cloud, not exported from a live site: none was available when the import
 * was built. What they copy from that format: the first row names the
 * columns; an "all fields" export names custom fields "Custom field (…)"
 * and repeats the column of a field with several values ("Labels",
 * "Sprint"), one value in each; a "current fields" export names the columns
 * as the issue search shows them ("Key", "Story point estimate") and puts
 * several labels in one cell, separated by spaces; cells holding a comma, a
 * quote or a line break are quoted, with a quote doubled; dates are written
 * in the exporting user's format.
 */

/** An "all fields" export (shortened: a real one has many more columns), comma-separated. */
export const ALL_FIELDS_EXPORT = [
  "Summary,Issue key,Issue id,Issue Type,Status,Project key,Priority,Assignee,Reporter,Created,Due date,Labels,Labels,Description,Custom field (Story point estimate),Custom field (Story Points),Sprint,Sprint",
  'Pay with a saved card,PAY-12,10012,Story,To Do,PAY,Medium,Sam Lee,Ana Diaz,03/Nov/26 9:12 AM,20/Nov/26,checkout,cards,"As a returning customer, I want to pay with a saved card.',
  "",
  'The card shows its last four digits.",5,,Sprint 7,',
  'Remove a saved card,PAY-13,10013,Story,In Progress,PAY,Low,,Ana Diaz,03/Nov/26 9:20 AM,,cards,,"Short, with a comma",,3,Sprint 7,Sprint 8',
  '"Fraud ""velocity"" checks",PAY-14,10014,Story,Done,PAY,High,Bo Chen,Ana Diaz,04/Nov/26 2:05 PM,,,,,2.5,,,',
  "Card nicknames,PAY-15,10015,Story,To Do,PAY,Medium,,Ana Diaz,04/Nov/26 3:00 PM,,,,,,,,",
].join("\r\n");

/** A "current fields" export: the columns as the issue search shows them. */
export const CURRENT_FIELDS_EXPORT = [
  "Issue Type,Key,Summary,Assignee,Reporter,Priority,Status,Created,Updated,Due date,Story point estimate,Labels",
  "Story,PAY-12,Pay with a saved card,Sam Lee,Ana Diaz,Medium,To Do,03/Nov/26 9:12 AM,05/Nov/26 10:00 AM,20/Nov/26,8,checkout cards",
  "Story,PAY-16,Split a payment,,Ana Diaz,Medium,To Do,05/Nov/26 9:00 AM,05/Nov/26 9:00 AM,,,",
].join("\n");

/** The same kind of export saved again by a spreadsheet in a European locale: semicolons, a decimal comma, a byte-order mark. */
export const SEMICOLON_EXPORT = [
  "﻿Issue key;Summary;Status;Assignee;Story Points;Description",
  "PAY-20;Gift cards;To Do;Sam Lee;2,5;Sell gift cards, then redeem them",
  'PAY-21;"Refunds; partial";To Do;;;',
].join("\r\n");
