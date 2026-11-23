/**
 * The bug id prefix on its own, so the "bug" hand-off route (which every
 * page with a Send to menu loads through lib/handoffs/registry) reads it
 * without pulling in the whole Bug Triage model. lib/bug-triage/model
 * re-exports it.
 */

/** Every bug's id starts with this (the CRUD's and the "bug" route's). */
export const BUG_ID_PREFIX = "bug_";
