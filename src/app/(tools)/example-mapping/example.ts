import type { ExampleMap } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

/**
 * The example: one story, "Pay with a saved card", mapped in a session.
 * Three rules, seven examples (four of them as Given/When/Then), one open
 * question with an owner and one answered. No verdict yet. Example maps are
 * never sent to a story or split.
 */
export function buildExample(now: Date): ExampleMap {
  const at = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const rule = (k: string) => exampleId(`rule-${k}`);
  return {
    id: exampleId("map-saved-card"),
    title: "Pay with a saved card",
    rules: [
      { id: rule("expired"), text: "An expired card is refused" },
      { id: rule("holder"), text: "Only the card holder can save a card" },
      { id: rule("cvc"), text: "The CVC is asked once per session" },
    ],
    examples: [
      {
        id: exampleId("ex-1"),
        ruleId: rule("expired"),
        text: "Maria's card expired in October: she is asked for another card",
        given: "Maria's saved card expired in October",
        when: "she pays for her order in November",
        then: "the card is refused and she is asked for another one",
      },
      {
        id: exampleId("ex-2"),
        ruleId: rule("expired"),
        text: "Tom's card expires today: it still works",
        given: "Tom's saved card expires at the end of this month",
        when: "he pays on the last day of the month",
        then: "the payment goes through",
      },
      {
        id: exampleId("ex-3"),
        ruleId: rule("holder"),
        text: "Ana saves her own card from her account page",
        given: "Ana is signed in as herself",
        when: "she saves a card in her own name",
        then: "the card is on her account",
      },
      {
        id: exampleId("ex-4"),
        ruleId: rule("holder"),
        text: "Ana tries to save her partner's card: she is asked to sign in as him",
      },
      {
        id: exampleId("ex-5"),
        ruleId: rule("cvc"),
        text: "Raj pays twice in ten minutes: the CVC is asked only the first time",
        given: "Raj paid with his saved card ten minutes ago",
        when: "he pays again in the same session",
        then: "he is not asked for the CVC",
      },
      {
        id: exampleId("ex-6"),
        ruleId: rule("cvc"),
        text: "Raj signs out and back in: the CVC is asked again",
      },
      {
        id: exampleId("ex-7"),
        ruleId: rule("cvc"),
        text: "A session left open overnight asks for the CVC in the morning",
      },
    ],
    questions: [
      {
        id: exampleId("q-business"),
        text: "Can a business account save a card for the whole team?",
        ruleId: rule("holder"),
        owner: "Priya",
        status: "open",
      },
      {
        id: exampleId("q-session"),
        text: "How long is a session?",
        ruleId: rule("cvc"),
        status: "answered",
        answer: "Until sign-out, or 12 hours, whichever comes first.",
      },
    ],
    timeboxMinutes: 25,
    createdAt: at,
    updatedAt: at,
  };
}
