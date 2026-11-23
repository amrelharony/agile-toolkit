/**
 * "See an example workflow": a support team's Definition of Workflow on the
 * Flow board, held in memory while it is open (nothing is saved). It has
 * STATIK notes, Kanban cadences and two saved versions; the second cut
 * Review's WIP limit to 2 and expects that to cut cycle time.
 */

import { exampleId } from "@/components/tool-frame/example-data";
import { WORKFLOW_DEFINITION_ID, type WorkflowDefinition } from "@/lib/stores/workspace-types";
import type { WorkflowSnapshot } from "@/lib/stores/workspace-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number, now: Date) => new Date(now.getTime() - days * DAY_MS).toISOString();

const LIMITS_BEFORE = { backlog: 0, ready: 5, in_progress: 3, review: 3, done: 0 };
const LIMITS_AFTER = { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 };

export function buildWorkflowExample(now: Date = new Date()): WorkflowDefinition {
  const base: Omit<WorkflowSnapshot, "wipLimits"> = {
    board: "flow",
    workItem: "A support request that needs a change to the product",
    startPoint: "When a developer pulls the request into In progress",
    finishPoint: "When the fix is live and the customer has been told",
    policies: [
      {
        stage: "backlog",
        enter: "Support adds it with the customer's words and how many people it affects",
        exit: "It is understood well enough to start, at the weekly replenishment",
      },
      {
        stage: "ready",
        enter: "Picked at replenishment, five at most",
        exit: "Pulled by whoever finishes something first",
      },
      {
        stage: "in_progress",
        enter: "Pulled, never assigned",
        exit: "The fix works and has a test",
      },
      {
        stage: "review",
        enter: "A pull request is open",
        exit: "Someone other than the author has checked it and any fixes are in",
      },
    ],
    wipPolicy: "Finish before starting: when a column is full, help clear it",
    pullPolicy: "Expedite first, then fixed dates due soonest, then the oldest standard request",
    blockerPolicy: "Flag it the same day, say why, and raise it at the stand-up if it isn't moving",
    classPolicies: [
      { class: "expedite", policy: "A customer can't work: one at a time, it jumps every queue" },
      { class: "fixed_date", policy: "Started early enough to land a week before its date" },
    ],
    sle: { days: 8, pct: 85 },
    workTypes: [
      { type: "feature", meaning: "A change a customer asked for", targetPct: 40 },
      { type: "defect", meaning: "Something that broke for a customer", targetPct: 40 },
      { type: "debt", meaning: "Clean-up that makes the next fix faster", targetPct: 15 },
      { type: "risk", meaning: "Security or compliance work", targetPct: 5 },
    ],
  };
  return {
    id: WORKFLOW_DEFINITION_ID,
    ...base,
    statik: {
      inside: "Too many requests open at once; reviews sit for days.",
      outside: "Support can't tell customers when a fix will land.",
      demand: "About 12 requests a week from support, two of them urgent.",
      capability: "About 6 finished a week; 85% took 11 days or less.",
      workflow: "Request, triage, fix, review, release. Most waiting is in review.",
      classes: "Urgent customer problems, fixes promised for a date, everything else.",
      design: "Five columns; Review limited to 2 so reviews come first.",
      rollout: "Try it for four weeks, then compare cycle time before and after.",
    },
    cadences: [
      {
        id: exampleId("cadence-replenish"),
        name: "Replenishment",
        cadence: "weekly",
        minutes: 30,
        purpose: "Pick what moves into Ready",
      },
      {
        id: exampleId("cadence-standup"),
        name: "Kanban stand-up",
        cadence: "daily",
        minutes: 15,
        purpose: "Walk the board right to left",
      },
      {
        id: exampleId("cadence-review"),
        name: "Service delivery review",
        cadence: "fortnightly",
        minutes: 45,
        purpose: "Check the SLE and what blocked us",
      },
    ],
    versions: [
      {
        version: 1,
        savedAt: ago(42, now),
        note: "First written down",
        snapshot: { ...base, sle: { days: 11, pct: 85 }, wipLimits: LIMITS_BEFORE },
      },
      {
        version: 2,
        savedAt: ago(14, now),
        note: "Review WIP 2",
        expect: "Review WIP 2 will cut cycle time",
        snapshot: { ...base, wipLimits: LIMITS_AFTER },
      },
    ],
    createdAt: ago(42, now),
    updatedAt: ago(14, now),
  };
}
