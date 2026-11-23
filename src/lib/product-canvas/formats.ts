/**
 * Product Canvas's formats: each one a sectioned document (lib/sectioned)
 * with its own boxes, in our own words. A box that holds one line is a
 * `single` section, a paragraph box a `long` one, and the rest are lists.
 *
 * All seven format ids the entity knows: the Vision Board, the Value
 * Proposition, the idea inbox (each idea a canvas of its own, with its
 * intake), the Lean UX canvas, the PR/FAQ, the lean business case (with its
 * decision) and the Shape Up pitch (with its appetite and its bet). The
 * page, the AI tasks and Amr's verbs offer only the formats this catalog
 * holds.
 *
 * Most formats follow a published method, named in its credit; the idea
 * inbox follows none and has no credit, and the business case's credit
 * names no framework (Decision D5). Every label, prompt, hint, starter
 * line, hard question and word list here is our own wording.
 *
 * Pure and server-safe: no zod, no React, no "use client" imports.
 */

import type { SectionDef, SectionFormat } from "@/lib/sectioned/model";
import {
  PRODUCT_CANVAS_FORMATS,
  TOOL_LIST_MAX,
  type ProductCanvasFormat,
} from "@/lib/stores/workspace-types";

/** How a format's page lays its boxes out. */
export type ProductLayout = "board" | "two-sides" | "document" | "inbox";

/** What a box can start from on the Product Goal page: its fields, the vision, or the backlog's common word. */
export type ProductGoalSource = "statement" | "why" | "measures" | "vision" | "theme";

/** One box of a product canvas: the kit's section, with Product Canvas's own marks. */
export interface ProductSectionDef extends SectionDef {
  /** Its lines are marked a fact or a guess. */
  evidence?: true;
  /** Its lines link to lines in these sections (an eased pain, a hypothesis's picks). */
  linksTo?: readonly string[];
  /** Its lines are questions, with the answer in `detail`. */
  qa?: true;
  /** Its lines may name the hard question they ask (`promptId`). */
  hardQuestions?: true;
  /** Its lines may be marked nice to have (a Shape Up scope). */
  niceToHave?: true;
  /** What an empty box can start from, with no AI. */
  fromGoal?: ProductGoalSource;
  /** Only the team writes it (a date): a draft, AI or not, never offers words for it. */
  typedOnly?: true;
  /** The group it sits in on the page: a side, the pitch, the press release. */
  group?: string;
}

/** A product canvas format: the kit's format, with its id, layout and boxes. */
export interface ProductFormat extends SectionFormat<ProductSectionDef> {
  id: ProductCanvasFormat;
  layout: ProductLayout;
  /** The start button's words, when "Start a {name}" doesn't read well ("Log an idea"). */
  startLabel?: string;
}

/** The words that start a canvas in `format`. */
export const startLabelOf = (format: ProductFormat) =>
  format.startLabel ?? `Start a ${format.name}`;

/** The box every format ends with. */
export const QUESTIONS_SECTION = "questions";

const questions: ProductSectionDef = {
  id: QUESTIONS_SECTION,
  label: "Open questions",
  prompt: "What you still need to find out before you trust this canvas.",
  kind: "list",
  max: 20,
  required: false,
  starter: "[What we don't know yet]",
};

const VISION_BOARD: ProductFormat = {
  id: "vision-board",
  name: "Vision Board",
  useWhen: "You're starting a product, or the team can't say in one breath what it's for.",
  time: "About 30 minutes",
  layout: "board",
  lead: "vision",
  credit: { text: "After Roman Pichler's Product Vision Board" },
  sections: [
    {
      id: "vision",
      label: "The vision",
      prompt: "The change you want to see for people, in one sentence. No features.",
      kind: "single",
      max: 1,
      required: true,
      fromGoal: "vision",
      starter: "[Who] can [do what] without [what holds them back today].",
    },
    {
      id: "who",
      label: "Who it's for",
      prompt: "The groups of people the product serves, the main one first.",
      hint: "Three groups at most keeps the product focused.",
      kind: "list",
      max: 8,
      required: true,
      evidence: true,
      starter: "[A group of people] who [are in what situation]",
    },
    {
      id: "needs",
      label: "What they need",
      prompt: "The problem it solves for them, or the job it gets done.",
      kind: "list",
      max: 10,
      required: true,
      evidence: true,
      starter: "They need to [do what] when [situation]",
    },
    {
      id: "product",
      label: "What it is",
      prompt: "The few things that make the product stand out. Keep to what matters most.",
      kind: "list",
      max: 10,
      required: false,
      fromGoal: "theme",
      starter: "[One thing the product does well]",
    },
    {
      id: "gains",
      label: "What we get from it",
      prompt: "How it helps the business, with a number where you can.",
      kind: "list",
      max: 8,
      required: false,
      evidence: true,
      fromGoal: "measures",
      starter: "[Measure] goes from [today] to [target]",
    },
    {
      id: "pitch-name",
      label: "Product name",
      prompt: "What people will call it.",
      kind: "single",
      max: 1,
      required: false,
      group: "pitch",
    },
    {
      id: "pitch-who",
      label: "Who the pitch is for",
      prompt: "The one group the pitch speaks to.",
      kind: "single",
      max: 1,
      required: false,
      group: "pitch",
    },
    {
      id: "pitch-need",
      label: "What they're trying to do",
      prompt: "The moment they need it, in their words.",
      kind: "single",
      max: 1,
      required: false,
      group: "pitch",
    },
    {
      id: "pitch-benefit",
      label: "What gets better for them",
      prompt: "What changes for them, said as an action: save an hour, get paid sooner.",
      kind: "single",
      max: 1,
      required: false,
      group: "pitch",
    },
    {
      id: "pitch-today",
      label: "What they use today",
      prompt: "How they get by now, without it.",
      kind: "single",
      max: 1,
      required: false,
      group: "pitch",
    },
    {
      id: "pitch-difference",
      label: "Why ours is different",
      prompt: "The one reason to pick ours over what they use today.",
      kind: "single",
      max: 1,
      required: false,
      group: "pitch",
    },
    questions,
  ],
};

const VALUE_PROPOSITION: ProductFormat = {
  id: "value-proposition",
  name: "Value Proposition",
  useWhen: "You want to check that what you offer matches what one customer group needs.",
  time: "About 40 minutes",
  layout: "two-sides",
  lead: "customer",
  credit: { text: "After Strategyzer's Value Proposition Canvas" },
  sections: [
    {
      id: "customer",
      label: "The customer group",
      prompt: "One customer group. Make another canvas for the next.",
      kind: "single",
      max: 1,
      required: true,
      group: "customer",
      starter: "[Who], when [situation]",
    },
    {
      id: "jobs",
      label: "Jobs they do",
      prompt: "What they are trying to get done, in their own words.",
      kind: "list",
      max: 10,
      required: true,
      evidence: true,
      group: "customer",
      starter: "Get [what] done before [when]",
    },
    {
      id: "pains",
      label: "What gets in the way",
      prompt: "What annoys them, costs them or stops them, before, during or after the job.",
      kind: "list",
      max: 10,
      required: true,
      evidence: true,
      group: "customer",
      starter: "[What goes wrong] when they [do what]",
    },
    {
      id: "gains",
      label: "What they hope for",
      prompt: "The results they want, and what would delight them.",
      kind: "list",
      max: 10,
      required: false,
      evidence: true,
      group: "customer",
      starter: "[A result they would be glad of]",
    },
    {
      id: "offer",
      label: "What we offer",
      prompt: "The products and services this proposition is built on.",
      kind: "list",
      max: 10,
      required: true,
      group: "offer",
      starter: "[A product or service we offer]",
    },
    {
      id: "eases",
      label: "Eases a pain",
      prompt: "How the offer takes a pain away. Link each line to the pain it eases.",
      kind: "list",
      max: 10,
      required: false,
      linksTo: ["pains"],
      group: "offer",
      starter: "[How we take a pain away]",
    },
    {
      id: "adds",
      label: "Adds a gain",
      prompt: "How the offer brings a result they want. Link each line to the gain it adds.",
      kind: "list",
      max: 10,
      required: false,
      linksTo: ["gains"],
      group: "offer",
      starter: "[How we bring a result they want]",
    },
    questions,
  ],
};

const LEAN_UX: ProductFormat = {
  id: "lean-ux",
  name: "Lean UX canvas",
  useWhen: "You have a business problem and want hypotheses to test, not a feature list.",
  time: "About 45 minutes",
  layout: "board",
  lead: "problem",
  credit: { text: "After Jeff Gothelf's Lean UX Canvas" },
  sections: [
    {
      id: "problem",
      label: "Business problem",
      prompt: "What is changing or not working for the business, and why it matters now.",
      kind: "long",
      max: 1,
      required: true,
      fromGoal: "why",
      starter: "[What is going wrong for the business] since [when], which costs us [what].",
    },
    {
      id: "outcomes",
      label: "Business outcomes",
      prompt: "What you'd see people do differently, and the numbers it would move.",
      kind: "list",
      max: 8,
      required: true,
      fromGoal: "measures",
      starter: "[Measure] moves from [today] to [target]",
    },
    {
      id: "users",
      label: "Users",
      prompt: "Who to focus on first, and what sets them apart.",
      kind: "list",
      max: 8,
      required: true,
      evidence: true,
      starter: "[A group of people] who [are in what situation]",
    },
    {
      id: "benefits",
      label: "What users get",
      prompt: "What they gain or avoid by using it: why they would care.",
      kind: "list",
      max: 8,
      required: true,
      evidence: true,
      starter: "[get what done] without [what bothers them]",
    },
    {
      id: "solutions",
      label: "Solutions",
      prompt: "Things you could make or change that might bring those outcomes.",
      kind: "list",
      max: 10,
      required: true,
      starter: "[Something we could make or change]",
    },
    {
      id: "hypotheses",
      label: "Hypotheses",
      prompt: "Build each one below from one outcome, one user, one benefit and one solution.",
      kind: "list",
      max: 10,
      required: false,
      linksTo: ["outcomes", "users", "benefits", "solutions"],
      group: "tests",
    },
    {
      id: "learn-first",
      label: "Learn first",
      prompt: "The riskiest thing to find out first, linked to its hypothesis.",
      kind: "list",
      max: 10,
      required: false,
      linksTo: ["hypotheses"],
      group: "tests",
      starter: "Whether [people] really [do what]",
    },
    {
      id: "smallest-test",
      label: "Smallest test",
      prompt: "The least work that would tell you whether a hypothesis holds, linked to it.",
      kind: "list",
      max: 10,
      required: false,
      linksTo: ["hypotheses"],
      group: "tests",
      starter: "[Show or try what] with [how many people] for [how long]",
    },
    questions,
  ],
};

const PR_FAQ: ProductFormat = {
  id: "pr-faq",
  name: "PR/FAQ",
  useWhen: "You want to write the launch news before building, to see whether it's worth it.",
  time: "About 45 minutes for a first draft",
  layout: "document",
  lead: "headline",
  credit: { text: "After Amazon's working-backwards PR/FAQ" },
  sections: [
    {
      id: "headline",
      label: "Headline",
      prompt: "What launched and for whom, in a dozen words or fewer.",
      kind: "single",
      max: 1,
      required: true,
      group: "release",
      starter: "[Product] lets [who] [do what]",
    },
    {
      id: "subheading",
      label: "Subheading",
      prompt: "Who it is for and what they get, in one sentence.",
      kind: "single",
      max: 1,
      required: false,
      group: "release",
    },
    {
      id: "launch-date",
      label: "Launch date",
      prompt: "The day it reaches customers, as YYYY-MM-DD.",
      hint: "A day still ahead. The check flags one that has passed.",
      kind: "single",
      max: 1,
      required: false,
      typedOnly: true,
      group: "release",
    },
    {
      id: "summary",
      label: "Summary",
      prompt: "The opening paragraph: what it is, who it helps and why now.",
      kind: "long",
      max: 1,
      required: true,
      fromGoal: "statement",
      group: "release",
    },
    {
      id: "problem",
      label: "The problem",
      prompt: "What customers struggle with today, as they would say it.",
      kind: "long",
      max: 1,
      required: true,
      group: "release",
    },
    {
      id: "solution",
      label: "How it solves it",
      prompt: "How the product takes that problem away, simply put.",
      kind: "long",
      max: 1,
      required: true,
      group: "release",
    },
    {
      id: "our-quote",
      label: "A quote from us",
      prompt: "Why the team built it, as one of you would say it.",
      kind: "long",
      max: 1,
      required: false,
      group: "release",
    },
    {
      id: "how-to-start",
      label: "How to start",
      prompt: "How a customer gets going, step by step.",
      kind: "long",
      max: 1,
      required: false,
      group: "release",
    },
    {
      id: "customer-quote",
      label: "A customer's words",
      prompt: "What a customer would say after using it. Make it sound like a person.",
      kind: "long",
      max: 1,
      required: false,
      group: "release",
    },
    {
      id: "call-to-action",
      label: "What to do next",
      prompt: "Where to go, or what to try first.",
      kind: "long",
      max: 1,
      required: false,
      group: "release",
    },
    {
      id: "customer-faq",
      label: "Customer questions",
      prompt: "What customers will ask, each with our answer.",
      kind: "list",
      max: 15,
      required: false,
      qa: true,
      group: "faq",
      starter: "Does it work when [situation]?",
    },
    {
      id: "internal-faq",
      label: "Internal questions",
      prompt: "What the team and the business will ask, each with our answer.",
      hint: "Add the hard questions below: cost, people, risk and more.",
      kind: "list",
      max: 15,
      required: false,
      qa: true,
      hardQuestions: true,
      group: "faq",
    },
    questions,
  ],
};

/**
 * One idea in the inbox, and the check of whether it is worth doing. The
 * inbox itself is every idea canvas, by status and demand; each idea's
 * intake (who asked, where from, how many) lives beside its boxes.
 */
const IDEA: ProductFormat = {
  id: "idea",
  name: "Idea intake",
  startLabel: "Log an idea",
  useWhen:
    "Ideas and requests pile up, and you want to see which keep coming back and which to look at first.",
  time: "A minute to log one, about 15 to check it",
  layout: "inbox",
  lead: "problem",
  sections: [
    {
      id: "problem",
      label: "The problem",
      prompt: "What goes wrong for people today, as they would say it. Not the fix.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[Who] can't [do what] when [situation]",
    },
    {
      id: "idea",
      label: "Our idea",
      prompt: "What we might do about it, in a sentence.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[What we could make or change]",
    },
    {
      id: "who",
      label: "Who has it",
      prompt: "The people who run into this problem, and roughly how many.",
      kind: "list",
      max: 8,
      required: false,
      evidence: true,
      starter: "[A group of people] who [are in what situation]",
    },
    {
      id: "today",
      label: "How they cope today",
      prompt: "What they do instead now: a workaround, another product, or nothing.",
      kind: "list",
      max: 8,
      required: false,
      evidence: true,
      starter: "They [do what] instead",
    },
    {
      id: "gain",
      label: "What they'd gain",
      prompt: "What gets better for them if we solve it.",
      kind: "list",
      max: 8,
      required: false,
      evidence: true,
      starter: "[What gets better] for [who]",
    },
    {
      id: "signal",
      label: "How we'd know it worked",
      prompt: "What we would see people do, and the number that would move.",
      kind: "list",
      max: 6,
      required: false,
      evidence: true,
      starter: "[Measure] goes from [today] to [target]",
    },
    {
      id: "why-us",
      label: "Why it matters to us",
      prompt: "How it serves the Product Goal or the business.",
      kind: "list",
      max: 6,
      required: false,
      evidence: true,
      starter: "It helps us [reach what]",
    },
    {
      id: "cost",
      label: "What it might cost",
      prompt: "A rough size: people, weeks, money, or what we would stop doing.",
      kind: "list",
      max: 6,
      required: false,
      evidence: true,
      starter: "About [how many people] for [how long]",
    },
    questions,
  ],
};

const BUSINESS_CASE: ProductFormat = {
  id: "business-case",
  name: "Business case",
  useWhen:
    "A big piece of work needs a go or a no-go, and you want to test it small before betting on all of it.",
  time: "About 45 minutes",
  layout: "document",
  lead: "epic",
  // Decision D5: a generic idea, so the credit names no framework.
  credit: { text: "A lean business case" },
  sections: [
    {
      id: "epic",
      label: "The epic",
      prompt: "The big piece of work this case is for, in a line.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[What we would build] for [who]",
    },
    {
      id: "expect",
      label: "What we expect",
      prompt: "What changes for customers and for the business if it goes ahead.",
      kind: "long",
      max: 1,
      required: true,
      fromGoal: "statement",
      starter: "If we build [what], [who] will [do what], and we'll see [what change].",
    },
    {
      id: "signs",
      label: "Early signs it's working",
      prompt: "What you'd see in the first weeks if it works: what people do, and a number.",
      kind: "list",
      max: 8,
      required: false,
      starter: "[Who] starts to [do what] within [how long]",
    },
    {
      id: "outcomes",
      label: "Business outcomes",
      prompt: "The results that would make it worth it, with a number where you can.",
      kind: "list",
      max: 8,
      required: false,
      fromGoal: "measures",
      starter: "[Measure] moves from [today] to [target]",
    },
    {
      id: "must-be-true",
      label: "Must also be true",
      prompt: "What else has to hold for this to work: a partner, a rule, a skill.",
      kind: "list",
      max: 8,
      required: false,
      starter: "[Something outside the work] stays [how]",
    },
    {
      id: "in-scope",
      label: "In scope",
      prompt: "What the work covers.",
      kind: "list",
      max: 10,
      required: false,
      group: "scope",
      starter: "[A part the work covers]",
    },
    {
      id: "out-of-scope",
      label: "Out of scope",
      prompt: "What it leaves out on purpose.",
      kind: "list",
      max: 10,
      required: false,
      group: "scope",
      starter: "[A part we leave out]",
    },
    {
      id: "mvp",
      label: "Smallest version to test it",
      prompt: "The least you could build to see whether what you expect comes true.",
      kind: "long",
      max: 1,
      required: false,
      group: "costs",
      starter: "[A small version] for [how many people] over [how long]",
    },
    {
      id: "mvp-cost",
      label: "Cost of that version",
      prompt: "What the small version takes: people, weeks and money.",
      kind: "long",
      max: 1,
      required: false,
      group: "costs",
      starter: "About [how many people] for [how many weeks], and [how much money]",
    },
    {
      id: "full-cost",
      label: "Cost if it all goes ahead",
      prompt: "A rough size for the whole epic, so the go is made with eyes open.",
      kind: "long",
      max: 1,
      required: false,
      group: "costs",
      starter: "About [how many people] for [how many months], and [how much money]",
    },
    {
      id: "risks",
      label: "Risks",
      prompt: "What could go wrong, and how you'd find out early.",
      kind: "list",
      max: 10,
      required: false,
      starter: "[What could go wrong], found out by [how]",
    },
    {
      id: "options",
      label: "Other ways we considered",
      prompt: "Other ways to get the same result, doing nothing among them.",
      kind: "list",
      max: 8,
      required: false,
      starter: "[Another way], set aside because [why]",
    },
    questions,
  ],
};

const SHAPE_UP: ProductFormat = {
  id: "shape-up",
  name: "Shape Up pitch",
  useWhen:
    "You have a problem worth solving and want to shape it into a pitch with a fixed time budget, ready to bet on.",
  time: "About 45 minutes to shape, then the betting table",
  layout: "document",
  lead: "problem",
  credit: { text: "After Basecamp's Shape Up" },
  sections: [
    {
      id: "problem",
      label: "The problem",
      prompt: "What goes wrong today, and for whom, told as a short story. Why now?",
      kind: "long",
      max: 1,
      required: true,
      group: "problem",
      starter: "[Who] has to [do what] because [what's missing], which costs [what].",
    },
    {
      id: "solution",
      label: "The solution",
      prompt:
        "Rough as a sketch: the main parts and how they connect. Leave the details to the team.",
      kind: "long",
      max: 1,
      required: true,
      group: "solution",
      starter: "[The main parts], so that [who] can [do what].",
    },
    {
      id: "rabbit-holes",
      label: "Rabbit holes",
      prompt: "Parts that could swallow the time, and how the pitch steers round them.",
      kind: "list",
      max: 8,
      required: false,
      group: "limits",
      starter: "[A risky part]: we'll [how we steer round it]",
    },
    {
      id: "no-gos",
      label: "No-gos",
      prompt: "What this pitch leaves out on purpose, so the time holds.",
      kind: "list",
      max: 8,
      required: false,
      group: "limits",
      starter: "No [what we won't do] this time",
    },
    {
      id: "scopes",
      label: "Scopes",
      prompt:
        "The pieces of work to build, each one able to ship on its own. Mark the nice-to-haves.",
      kind: "list",
      max: 12,
      required: false,
      niceToHave: true,
      group: "scopes",
      starter: "[A piece of work that can ship on its own]",
    },
    questions,
  ],
};

/** Every format this build offers, by id: all seven of the entity's. */
export const PRODUCT_FORMATS: Readonly<Partial<Record<ProductCanvasFormat, ProductFormat>>> = {
  "vision-board": VISION_BOARD,
  "value-proposition": VALUE_PROPOSITION,
  idea: IDEA,
  "lean-ux": LEAN_UX,
  "pr-faq": PR_FAQ,
  "business-case": BUSINESS_CASE,
  "shape-up": SHAPE_UP,
};

/** The formats on offer, in the entity's order. */
export const BUILT_FORMATS: readonly ProductCanvasFormat[] = PRODUCT_CANVAS_FORMATS.filter((id) =>
  Object.prototype.hasOwnProperty.call(PRODUCT_FORMATS, id)
);

/** A format by id, or null for one this build doesn't offer (or isn't a format). */
export function productFormat(id: unknown): ProductFormat | null {
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(PRODUCT_FORMATS, id)) {
    return null;
  }
  return PRODUCT_FORMATS[id as ProductCanvasFormat] ?? null;
}

/** A box of a format by id, or null. */
export function sectionDef(format: ProductFormat, sectionId: string): ProductSectionDef | null {
  return format.sections.find((d) => d.id === sectionId) ?? null;
}

/** A canvas never holds more items than this, all boxes together. */
export const CANVAS_ITEMS_MAX = TOOL_LIST_MAX.canvasItems;

/* ── Word lists, all our own ──────────────────────────────────────── */

/** Hard questions a PR/FAQ's internal questions should answer: our own eight. */
export interface HardQuestion {
  id: string;
  text: string;
}

export const HARD_QUESTIONS: readonly HardQuestion[] = [
  { id: "hq-cost", text: "What will it cost to build, and to keep running?" },
  { id: "hq-people", text: "Who builds it, and what stops while they do?" },
  { id: "hq-measure", text: "How will we know it worked, and by when?" },
  { id: "hq-risk", text: "What is the biggest risk, and how do we find out early?" },
  { id: "hq-switch", text: "Why would customers leave what they use today?" },
  { id: "hq-data", text: "What data does it need, and how does that data stay safe?" },
  { id: "hq-not-building", text: "What happens if we don't build it?" },
  { id: "hq-smallest", text: "What is the smallest version we could launch?" },
];

/** Whether `id` is one of the hard questions. */
export function isHardQuestionId(id: unknown): id is string {
  return typeof id === "string" && HARD_QUESTIONS.some((q) => q.id === id);
}

/** Words that sound good and say little: the pitch's jargon note looks for them. */
export const JARGON_WORDS: readonly string[] = [
  "seamless",
  "seamlessly",
  "best-in-class",
  "world-class",
  "synergy",
  "frictionless",
  "cutting-edge",
  "game-changing",
  "game changer",
  "revolutionary",
  "next-generation",
  "leverage",
  "robust",
  "disruptive",
  "innovative",
  "holistic",
  "end-to-end",
  "state-of-the-art",
  "paradigm",
  "empower",
  "one-stop",
];

/** Words that name a feature, not a change for people: a vision should leave them out. */
export const FEATURE_WORDS: readonly string[] = [
  "app",
  "screen",
  "button",
  "dashboard",
  "login",
  "page",
  "menu",
  "feature",
  "tab",
  "form",
  "notification",
  "website",
  "api",
  "database",
  "integration",
];

/** The press release's boxes, in order: the word count reads them. */
export const PRESS_RELEASE_SECTIONS: readonly string[] = [
  "headline",
  "subheading",
  "summary",
  "problem",
  "solution",
  "our-quote",
  "how-to-start",
  "customer-quote",
  "call-to-action",
];

/** About this many words makes a press release worth reading; past the note, it says so. */
export const RELEASE_WORDS_AIM = 500;
export const RELEASE_WORDS_NOTE = 600;
/** A headline this many words or fewer. */
export const HEADLINE_WORDS_MAX = 12;
/** A vision this many words or fewer. */
export const VISION_WORDS_MAX = 25;
/** "Who it's for" names this many groups or fewer before the check speaks. */
export const VISION_GROUPS_MAX = 3;
