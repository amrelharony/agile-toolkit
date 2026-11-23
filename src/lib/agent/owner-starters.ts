/**
 * The owner's empty chat (chat/chat-empty): its narration line, told in the
 * third person, and its starters, written as the owner's own requests. None
 * has I, me or my in it: a first-person line in the chat would read as
 * Amr's (DNA-SPEC section 6, "Chat strip").
 *
 * Owner-only, apart from the visitor's (visitor-starters), so the visitor's
 * chat never carries these words (test/agent/bundle-boundary.test.ts).
 */

/** The owner's empty-chat line, and its one-line form for a short log. */
export const OWNER_EMPTY = {
  line: "Amr can drive any tool for you: planning, retros, canvas, OKRs.",
  short: "Amr can drive any tool for you.",
} as const;

/** Things Amr can do anywhere, after the page's own starter. */
const ANYWHERE = [
  "Create a sprint called Sprint 47 starting today for 2 weeks",
  "Add a sticky to the active board saying “flaky CI”",
  "Plan the next sprint at 30 points capacity",
] as const;

/** Up to three starters: one for the tool this page belongs to (`tool`), when it is one, first. */
export function ownerStarters(tool?: { name: string } | null): string[] {
  return [...(tool ? [`What can you do in ${tool.name}?`] : []), ...ANYWHERE].slice(0, 3);
}
