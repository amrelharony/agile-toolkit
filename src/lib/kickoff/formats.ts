/**
 * Kickoff's formats: six ways for a new team or a new piece of work to
 * start on the same page, each a sectioned document (lib/sectioned). A
 * section that holds one answer is `single`; the rest are lists.
 *
 * What a section adds to the kit's:
 *   - `owner`: each line has an owner column (a person from the team);
 *   - `ratings`: each line is rated how likely and how bad (1–5);
 *   - `coverTarget`: its lines are worries, which other lines can cover;
 *   - `covers`: its lines can cover a worry (`KickoffItem.covers`);
 *   - `routes`: where a line can be sent (a hand-off route);
 *   - `links`: tools the section points to (shown only when they exist).
 *
 * Four formats follow published canvases, named in their credit line; the
 * owner checks each source's terms before the phase goes live (Decision
 * D5). Every label, prompt, hint and starter line here is our own wording:
 * no published template's questions or card titles are copied.
 *
 * Pure and server-safe: no zod, no React, no "use client" imports.
 */

import type { SectionDef, SectionFormat } from "@/lib/sectioned/model";
import {
  KICKOFF_FORMATS,
  type HandoffRouteId,
  type KickoffFormat,
} from "@/lib/stores/workspace-types";

/** One section of a kickoff: the kit's section, with Kickoff's own marks. */
export interface KickoffSectionDef extends SectionDef {
  /** Each line has an owner: a person on the team. */
  owner?: true;
  /** The owner column's name ("Person" for the team's people; default "Owner"). */
  ownerLabel?: string;
  /** Each line is rated how likely it is and how bad it would be, 1–5. */
  ratings?: true;
  /** Its lines are worries: other sections' lines can cover them. */
  coverTarget?: true;
  /** Its lines can cover a worry; the words for one ("a commitment"). */
  covers?: string;
  /** Where its lines can be sent, in menu order. */
  routes?: readonly HandoffRouteId[];
  /** What "What's still open" says when this required section is empty. */
  emptyNote?: string;
}

/** A kickoff format: the kit's format, with its id and whether it orders trade-offs. */
export interface KickoffFormatDef extends SectionFormat<KickoffSectionDef> {
  id: KickoffFormat;
  /** It carries the trade-off sliders. */
  hasSliders: boolean;
}

/** The trade-offs every slider list starts with, holding firm first. */
export const DEFAULT_SLIDERS: readonly string[] = ["Scope", "Date", "Cost", "Quality"];

/** Extras a team can add to its sliders. */
export const SUGGESTED_SLIDERS: readonly string[] = [
  "Team stays the same",
  "Easy to use",
  "Tech we choose",
];

/** The hint for covering a worry, by what covers it. */
export const COVER_HINT = {
  commitment: "Who will watch for this?",
  resource: "What would we need so this can't happen?",
} as const;

const ALIGNMENT_MAP: KickoffFormatDef = {
  id: "alignment-map",
  name: "Team Alignment Map",
  useWhen: "A group has to agree who does what before the work starts, and what could stop it.",
  time: "About 45 minutes",
  lead: "mission",
  hasSliders: false,
  credit: { text: "After Stefano Mastrogiacomo's Team Alignment Map" },
  sections: [
    {
      id: "mission",
      label: "Our aim, and by when",
      prompt: "What we're setting out to do together, and the date we want it done by.",
      hint: "One sentence. A date makes it real.",
      kind: "single",
      max: 1,
      required: true,
      starter: "By [when], we will [what we'll have done].",
    },
    {
      id: "objectives",
      label: "What we'll have done together",
      prompt: "The results we can point to once the aim is met, one per line.",
      kind: "list",
      max: 12,
      required: true,
      starter: "[A result we can show]",
    },
    {
      id: "commitments",
      label: "Who carries which part",
      prompt: "Each part of the work, and the person who takes it on.",
      hint: "Pick the owner from the team.",
      kind: "list",
      max: 20,
      required: true,
      owner: true,
      covers: "a commitment",
      starter: "[The part of the work someone takes on]",
    },
    {
      id: "resources",
      label: "What we'll need",
      prompt: "People, time, money, tools or access the work depends on.",
      kind: "list",
      max: 20,
      required: false,
      covers: "a resource",
      starter: "[Something we need] by [when]",
    },
    {
      id: "risks",
      label: "What could trip us up",
      prompt: "What might stop us, one worry per line. Rate each one, then say what takes it away.",
      kind: "list",
      max: 20,
      required: true,
      ratings: true,
      coverTarget: true,
      routes: ["risk"],
      starter: "[Something that could go wrong]",
    },
  ],
};

const PROJECT_POSTER: KickoffFormatDef = {
  id: "project-poster",
  name: "Project Poster",
  useWhen:
    "New work needs one page that says what problem it solves and how you'll know it worked.",
  time: "About 40 minutes",
  lead: "problem",
  hasSliders: false,
  credit: { text: "After Atlassian's Team Playbook" },
  sections: [
    {
      id: "problem",
      label: "The problem, in one sentence",
      prompt: "Who has the problem and what it stops them doing, in plain words.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[Who] can't [do what] because [why].",
    },
    {
      id: "why-now",
      label: "Why this, and why now",
      prompt: "What makes this worth doing before anything else.",
      kind: "list",
      max: 8,
      required: false,
      starter: "[What changed, or what waiting would cost]",
    },
    {
      id: "solution",
      label: "Our best guess at a fix",
      prompt: "The shape of what you might build or change. It can still change.",
      kind: "single",
      max: 1,
      required: false,
      starter: "We think [what we'd build or change] would help.",
    },
    {
      id: "measures",
      label: "Signs it worked",
      prompt: "What you'd see or count once it's done, one sign per line.",
      kind: "list",
      max: 8,
      required: true,
      starter: "[What we'd see], from [today's number] to [the target]",
    },
    {
      id: "assumptions",
      label: "What we're betting on",
      prompt: "What has to be true for the fix to work. Test the riskiest first.",
      kind: "list",
      max: 12,
      required: false,
      routes: ["hypothesis"],
      starter: "We believe [something we haven't checked yet]",
    },
    {
      id: "questions",
      label: "Still to find out",
      prompt: "What you don't know yet and need to before you start.",
      kind: "list",
      max: 12,
      required: false,
      starter: "[A question we can't answer yet]",
    },
  ],
};

const TEAM_CANVAS: KickoffFormatDef = {
  id: "team-canvas",
  name: "Team Canvas",
  useWhen:
    "A team is new, or people joined or left, and you want to agree how you'll work together.",
  time: "About 90 minutes",
  lead: "purpose",
  hasSliders: false,
  credit: { text: "After Alex Ivanov's Team Canvas" },
  sections: [
    {
      id: "purpose",
      label: "Why we exist as a team",
      prompt: "The reason this team is here, in a sentence anyone could repeat.",
      kind: "single",
      max: 1,
      required: true,
      starter: "We're here to [what we do] for [whom].",
    },
    {
      id: "people",
      label: "Who's here and what they do",
      prompt: "Everyone on the team, with the role or skill they bring.",
      hint: "Filled from the Team page when you start. Type a name, a comma, then the role.",
      kind: "list",
      max: 30,
      required: true,
      owner: true,
      ownerLabel: "Person",
      starter: "[A name], [their role]",
    },
    {
      id: "goals",
      label: "What we're aiming for together",
      prompt: "The shared results the team works towards.",
      kind: "list",
      max: 12,
      required: true,
      starter: "[A result we want together]",
    },
    {
      id: "personal-goals",
      label: "What each of us wants out of it",
      prompt: "What each person hopes to learn or get from being on this team.",
      kind: "list",
      max: 30,
      required: false,
      owner: true,
      starter: "[What I want to learn or get]",
    },
    {
      id: "values",
      label: "What we hold to",
      prompt: "The few things the team won't give up, however busy it gets.",
      kind: "list",
      max: 10,
      required: false,
      starter: "[Something we won't give up]",
    },
    {
      id: "needs",
      label: "What I need from the rest of you",
      prompt: "What each person needs from the others to do their best work.",
      kind: "list",
      max: 30,
      required: false,
      owner: true,
      starter: "I need [what] from the team",
    },
    {
      id: "rules",
      label: "How we'll work",
      prompt:
        "Ground rules the whole team keeps. Send each one to the Working Agreement, where everyone consents to it.",
      kind: "list",
      max: 20,
      required: true,
      routes: ["agreement-rule"],
      starter: "We [do what] when [it happens]",
    },
    {
      id: "strengths",
      label: "What we're good at",
      prompt: "Skills and habits the team can lean on.",
      kind: "list",
      max: 12,
      required: false,
      links: ["skills-matrix"],
      starter: "[Something we do well]",
    },
    {
      id: "weaknesses",
      label: "Where we might struggle",
      prompt: "Gaps that could slow you down. Rate them to send the worst to the Risk Register.",
      kind: "list",
      max: 12,
      required: false,
      ratings: true,
      routes: ["risk"],
      starter: "[A gap or a habit that could slow us down]",
    },
  ],
};

const INCEPTION: KickoffFormatDef = {
  id: "inception",
  name: "Inception deck",
  useWhen:
    "Something big is starting, and everyone needs the same picture of why, what's in and out, and what could go wrong.",
  time: "2–4 hours, saved between sittings",
  lead: "why",
  hasSliders: true,
  credit: { text: "Inspired by Jonathan Rasmusson's Inception Deck (The Agile Samurai)" },
  sections: [
    {
      id: "why",
      label: "Why we're doing this",
      prompt: "The reasons this work exists, for the people it's for and for us.",
      kind: "list",
      max: 8,
      required: true,
      starter: "[Who] needs [what] because [why]",
    },
    {
      id: "pitch",
      label: "The idea in two sentences",
      prompt: "What it is and who it's for, short enough to say between two floors of a lift.",
      kind: "single",
      max: 1,
      required: true,
      starter: "For [who], [what it is] that [what it does for them].",
    },
    {
      id: "headline",
      label: "The launch-day headline we'd love to read",
      prompt: "Imagine it's out and it worked. What would the news say?",
      kind: "single",
      max: 1,
      required: false,
      starter: "[Who] can now [do what] in [how little time]",
    },
    {
      id: "in-scope",
      label: "Definitely in",
      prompt: "What this work will do. Each line can go to the backlog as a story.",
      kind: "list",
      max: 30,
      required: true,
      routes: ["backlog-story"],
      starter: "[Something we'll build or change]",
    },
    {
      id: "out-of-scope",
      label: "Definitely out",
      prompt: "What it won't do, so the team can say no without a debate.",
      kind: "list",
      max: 30,
      required: true,
      starter: "[Something we won't do this time]",
      emptyNote: "Nothing is out of scope yet. Saying what you won't do keeps the work small.",
    },
    {
      id: "unsure",
      label: "Not decided yet",
      prompt: "Things nobody has said yes or no to. Decide them before they surprise you.",
      kind: "list",
      max: 20,
      required: false,
      starter: "[Something we haven't decided]",
    },
    {
      id: "neighbours",
      label: "Who else this touches",
      prompt: "Teams, partners and people outside the team the work depends on or changes.",
      kind: "list",
      max: 20,
      required: false,
      links: ["stakeholder-map"],
      starter: "[A team or a person], for [what we need from them]",
    },
    {
      id: "solution",
      label: "A rough sketch of how it works",
      prompt:
        "The big parts and how they fit, in a sentence or two. Draw it on the whiteboard if that helps.",
      kind: "single",
      max: 1,
      required: false,
      links: ["canvas"],
      starter: "[The big parts] talk to [what] through [how]",
    },
    {
      id: "worries",
      label: "What worries us",
      prompt:
        "What keeps you up at night about this work. Rate each one, then say what you'd need so it can't happen.",
      kind: "list",
      max: 20,
      required: true,
      ratings: true,
      coverTarget: true,
      routes: ["risk"],
      links: ["premortem"],
      starter: "[Something that could go wrong]",
    },
    {
      id: "size",
      label: "Roughly how big",
      prompt: "A rough size in sprints, months or people. A guess is fine: say that it's a guess.",
      kind: "single",
      max: 1,
      required: false,
      links: ["release-planner"],
      starter: "About [how many] sprints, maybe",
    },
    {
      id: "needs",
      label: "People, time and money we'll need",
      prompt: "Who and what the work needs, and who on the team will get it.",
      kind: "list",
      max: 20,
      required: false,
      owner: true,
      covers: "a need",
      links: ["capacity-planner"],
      starter: "[Who or what we need] by [when]",
    },
  ],
};

const TRADE_OFFS: KickoffFormatDef = {
  id: "trade-offs",
  name: "Trade-off sliders",
  useWhen:
    "The team keeps arguing about scope, dates or quality, and needs to agree what gives way first.",
  time: "About 15 minutes",
  lead: "notes",
  hasSliders: true,
  sections: [
    {
      id: "notes",
      label: "What the order means for us",
      prompt: "What the order changes in practice: what you'd cut first, and what you'd protect.",
      kind: "list",
      max: 8,
      required: false,
      starter: "If we run late, we [cut what] before we [touch what]",
    },
  ],
};

const PROBLEM_FRAMING: KickoffFormatDef = {
  id: "problem-framing",
  name: "Problem framing",
  useWhen:
    "A problem keeps coming up but nobody can say it in one line, or the team jumps to fixes too soon.",
  time: "About 30 minutes",
  lead: "what",
  hasSliders: false,
  sections: [
    {
      id: "who",
      label: "Who has the problem",
      prompt: "The people it happens to. Be as exact as you can.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[Which people, in which situation]",
    },
    {
      id: "what",
      label: "What happens today",
      prompt: "What goes wrong for them now, as a fact, not a fix.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[What goes wrong for them]",
    },
    {
      id: "when-where",
      label: "When and where it happens",
      prompt: "The moment or the place it shows up.",
      kind: "single",
      max: 1,
      required: false,
      starter: "When [it happens], at [where]",
    },
    {
      id: "impact",
      label: "What it costs",
      prompt: "Time, money, trust or chances lost because of it.",
      kind: "single",
      max: 1,
      required: false,
      starter: "[What it costs], about [how much]",
    },
    {
      id: "evidence",
      label: "How we know",
      prompt: "Facts that show the problem is real: numbers, quotes, tickets.",
      kind: "list",
      max: 10,
      required: true,
      starter: "[A fact, a number or a quote]",
      emptyNote: "No evidence yet. Add what shows the problem is real before you fix it.",
    },
    {
      id: "not",
      label: "What it isn't",
      prompt: "Problems that look like this one but aren't, so nobody solves the wrong thing.",
      kind: "list",
      max: 10,
      required: false,
      starter: "It isn't [a problem people mix it up with]",
    },
    {
      id: "outcome",
      label: "What good looks like",
      prompt: "What's true for them once the problem is gone.",
      kind: "single",
      max: 1,
      required: true,
      starter: "[Who] can [do what] without [the trouble]",
      emptyNote: "Say what good looks like, so you'll know when it's solved.",
    },
    {
      id: "statement",
      label: "The problem statement",
      prompt:
        "The problem in one sentence, built from the answers above. Use the one the page writes, or your own.",
      kind: "single",
      max: 1,
      required: false,
      routes: ["opportunity", "root-cause"],
      starter: "For [who], [what happens] ([when]). That costs [what].",
    },
    {
      id: "hmw",
      label: "How might we…",
      prompt: "Questions that open up ideas, each one starting with How might we.",
      kind: "list",
      max: 8,
      required: false,
      starter: "How might we [help who] [do what]?",
    },
  ],
};

/** Every kickoff format, by id, in KICKOFF_FORMATS order. */
export const KICKOFF_FORMAT_DEFS: Readonly<Record<KickoffFormat, KickoffFormatDef>> = {
  "alignment-map": ALIGNMENT_MAP,
  "project-poster": PROJECT_POSTER,
  "team-canvas": TEAM_CANVAS,
  inception: INCEPTION,
  "trade-offs": TRADE_OFFS,
  "problem-framing": PROBLEM_FRAMING,
};

/** The formats, in the picker's order. */
export const KICKOFF_FORMAT_LIST: readonly KickoffFormatDef[] = KICKOFF_FORMATS.map(
  (id) => KICKOFF_FORMAT_DEFS[id]
);

/** Whether `id` is a kickoff format (never an inherited key like "constructor"). */
export function isKickoffFormat(id: unknown): id is KickoffFormat {
  return typeof id === "string" && (KICKOFF_FORMATS as readonly string[]).includes(id);
}

/** A format's catalog entry, or undefined for an unknown id. */
export function kickoffFormat(id: unknown): KickoffFormatDef | undefined {
  return isKickoffFormat(id) ? KICKOFF_FORMAT_DEFS[id] : undefined;
}

/** One section of a format, or undefined. */
export function kickoffSection(
  format: KickoffFormatDef,
  sectionId: string
): KickoffSectionDef | undefined {
  return format.sections.find((d) => d.id === sectionId);
}

/** The section the team's people go in (Team Canvas). */
export const PEOPLE_SECTION = "people";

/** Every route any section sends on. */
export const KICKOFF_SECTION_ROUTES: readonly HandoffRouteId[] = Array.from(
  new Set(KICKOFF_FORMAT_LIST.flatMap((f) => f.sections.flatMap((d) => d.routes ?? [])))
);
