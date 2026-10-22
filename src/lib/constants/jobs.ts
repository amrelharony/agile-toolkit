/**
 * The jobs people come to the toolkit to do, for the home page's launcher.
 *
 * With 110 tools in 18 categories, a first-time visitor had no way to go
 * from "I'm running a retro tomorrow" to the right tool. Each job names one
 * primary tool and a few alternatives, each with a one-line "pick this
 * when" so the choice is obvious.
 */

export interface JobAlternative {
  toolId: string;
  /** When to choose this tool over the primary one. */
  pickWhen: string;
}

export interface Job {
  id: string;
  /** Phrased as the visitor would say it. */
  title: string;
  /** One sentence on what they'll get. */
  description: string;
  primaryToolId: string;
  alternatives: JobAlternative[];
}

export const JOBS: Job[] = [
  {
    id: "run-retro",
    title: "Run a retrospective",
    description: "Collect what went well and what didn't, vote, and agree on actions.",
    primaryToolId: "retro",
    alternatives: [
      { toolId: "premortem", pickWhen: "you want to look ahead at a risky project instead" },
      { toolId: "icebreaker", pickWhen: "you need a warm-up to open the session" },
    ],
  },
  {
    id: "estimate",
    title: "Estimate stories",
    description: "Size the backlog together and agree on story points.",
    primaryToolId: "planning-poker",
    alternatives: [
      { toolId: "estimation-guide", pickWhen: "you want reference stories to calibrate sizes" },
      { toolId: "refinement", pickWhen: "stories aren't ready yet — check them first" },
    ],
  },
  {
    id: "prioritize",
    title: "Prioritize a backlog",
    description: "Rank work by value, urgency and effort with a proven method.",
    primaryToolId: "prioritizer",
    alternatives: [
      { toolId: "rice-scoring", pickWhen: "you know reach and impact for each idea" },
      { toolId: "wsjf", pickWhen: "you're in SAFe or want cost of delay over job size" },
      { toolId: "moscow", pickWhen: "you need a quick must/should/could cut for a release" },
    ],
  },
  {
    id: "plan-sprint",
    title: "Plan a sprint",
    description: "Work out real capacity, set a goal and fit the work to it.",
    primaryToolId: "capacity-planner",
    alternatives: [
      { toolId: "sprint-goal", pickWhen: "you want a clear, testable sprint goal" },
      { toolId: "story-mapper", pickWhen: "you're slicing a bigger feature into releases" },
    ],
  },
  {
    id: "track-delivery",
    title: "Track delivery",
    description: "See progress, flow and predictability across sprints.",
    primaryToolId: "sprint",
    alternatives: [
      { toolId: "burndown", pickWhen: "you want to log and chart the points left each day" },
      { toolId: "velocity", pickWhen: "you want sprint-over-sprint trends and forecasts" },
      { toolId: "kanban", pickWhen: "you work in flow rather than sprints" },
    ],
  },
  {
    id: "team-health",
    title: "Check team health",
    description: "Ask the team how things feel and spot trends early.",
    primaryToolId: "health-check",
    alternatives: [
      { toolId: "psych-safety", pickWhen: "you want to measure psychological safety" },
      { toolId: "mood-tracker", pickWhen: "you want a quick daily or weekly pulse" },
      { toolId: "working-agreement", pickWhen: "the team needs shared ground rules" },
    ],
  },
  {
    id: "daily",
    title: "Run the daily standup",
    description: "Keep updates short and surface blockers fast.",
    primaryToolId: "standup",
    alternatives: [
      { toolId: "async-standup", pickWhen: "the team is spread across time zones" },
      { toolId: "impediments", pickWhen: "you need to track blockers until they're cleared" },
      { toolId: "ceremony-timer", pickWhen: "you just need a fair timebox per speaker" },
    ],
  },
  {
    id: "decide",
    title: "Make a decision",
    description: "Decide with the right people and record why.",
    primaryToolId: "decision-log",
    alternatives: [
      { toolId: "daci", pickWhen: "you need to make roles clear before deciding" },
      { toolId: "weighted-decision", pickWhen: "you're comparing options against criteria" },
      { toolId: "cynefin", pickWhen: "you're not sure what kind of problem this is" },
    ],
  },
];
