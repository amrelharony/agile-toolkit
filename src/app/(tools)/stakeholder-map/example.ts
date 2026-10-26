import { exampleId } from "@/components/tool-frame/example-data";
import { addDays } from "@/lib/flow/days";
import type { Stakeholder } from "./model";

/**
 * Seven stakeholders around a checkout redesign: four to manage closely
 * (two of them short of where they're needed, one a blocker you need as a
 * supporter), two others placed, and a new one not placed yet. Priya's
 * next touch was due three days ago; Omar's is this week.
 *
 * Everything has `example-` ids and stays in the page's memory: nothing is
 * saved, and Clear example leaves your own map as it was.
 */
export function buildExample(today: string): Stakeholder[] {
  const day = (n: number) => addDays(today, n) ?? today;
  const s = (key: string, over: Omit<Stakeholder, "id">): Stakeholder => ({
    id: exampleId(`stk-${key}`),
    ...over,
  });
  return [
    s("priya", {
      name: "Priya Shah",
      role: "VP of Marketing",
      interest: 8,
      authority: 9,
      currentSentiment: "skeptic",
      desiredSentiment: "supporter",
      strategy: "Fortnightly 1:1; preview each release's campaign hooks.",
      lastContactAt: day(-17),
      nextTouchAt: day(-3),
    }),
    s("marco", {
      name: "Marco Ruiz",
      role: "Head of Payments",
      interest: 7,
      authority: 8,
      currentSentiment: "blocker",
      desiredSentiment: "supporter",
      strategy: "Co-design the fraud checks with his team.",
      lastContactAt: day(-6),
      nextTouchAt: day(8),
    }),
    s("omar", {
      name: "Omar Haddad",
      role: "Product Director",
      interest: 9,
      authority: 7,
      currentSentiment: "champion",
      desiredSentiment: "champion",
      lastContactAt: day(-2),
      nextTouchAt: day(4),
    }),
    s("lena", {
      name: "Lena Berg",
      role: "CFO",
      interest: 5,
      authority: 10,
      currentSentiment: "supporter",
      desiredSentiment: "supporter",
      lastContactAt: day(-30),
    }),
    s("ken", {
      name: "Ken Ito",
      role: "Legal counsel",
      interest: 2,
      authority: 7,
      currentSentiment: "neutral",
      desiredSentiment: "neutral",
      strategy: "Short written brief before each release.",
    }),
    s("ana", {
      name: "Ana Costa",
      role: "Customer support lead",
      interest: 8,
      authority: 3,
      currentSentiment: "supporter",
      desiredSentiment: "champion",
    }),
    s("jo", {
      name: "Jo Park",
      role: "New data protection officer",
      interest: null,
      authority: null,
      currentSentiment: null,
      desiredSentiment: null,
    }),
  ];
}
