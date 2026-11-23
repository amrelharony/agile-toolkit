/**
 * A visitor's empty chat (chat/chat-empty): its narration line, told in the
 * third person, and its starters, written as the visitor's own questions.
 * None has I, me or my in it: a first-person line in the chat would read as
 * Amr's (DNA-SPEC section 6, "Chat strip").
 *
 * Apart from the owner's (owner-starters), so the visitor's chat carries
 * only its own words (test/agent/bundle-boundary.test.ts).
 */

/** A visitor's empty-chat line, and its one-line form for a short log. */
export const VISITOR_EMPTY = {
  line: "Ask Amr about agile, or about the tool you're on.",
  short: "Ask Amr about agile.",
} as const;

/** Questions for any page, after the page's own starters. */
const ANYWHERE = [
  "What makes a good retro?",
  "Which tool helps prioritize a backlog?",
  "What makes a good sprint goal?",
] as const;

/**
 * Up to three starters for the tool this page belongs to (`tool`, one the
 * visitor may see), when it is one: how it works first, and on the retro a
 * change to try, except in a live room, where Amr changes nothing.
 */
export function visitorStarters(
  tool: { id: string; name: string } | null | undefined,
  liveRoom: boolean
): string[] {
  const page = tool ? [`How does ${tool.name} work?`] : [];
  if (tool?.id === "retro" && !liveRoom) page.push("Add a card “flaky CI” to this retro");
  return [...page, ...ANYWHERE].slice(0, 3);
}
