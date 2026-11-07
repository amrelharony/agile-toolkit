import {
  Calculator,
  Target,
  Map,
  ArrowUpDown,
  BookOpen,
  Crosshair,
  TrendingUp,
  BarChart3,
  BarChart2,
  Activity,
  Layers,
  Clock,
  GitCompare,
  LayoutDashboard,
  MessageSquare,
  Mic,
  Presentation,
  Timer,
  CheckSquare,
  Sparkles,
  HeartPulse,
  Award,
  Grid3X3,
  Users,
  AlertTriangle,
  CalendarRange,
  Milestone,
  GitBranch,
  Lightbulb,
  Quote,
  Workflow,
  ShieldAlert,
  ScrollText,
  Wrench,
  Columns,
  Network,
  Waves,
  Flag,
  Smile,
  BarChart,
  FileText,
  ClipboardCheck,
  Compass,
  Siren,
  Phone,
  Rocket,
  Shield,
  Bug,
  ShieldCheck,
  Eye,
  Triangle,
  AlertOctagon,
  GitPullRequest,
  Handshake,
  AlertCircle,
  User,
  Mail,
  Coffee,
  Heart,
  UserPlus,
  PieChart,
  ArrowRight,
  ToggleLeft,
  Brain,
  Cpu,
  Bot,
  AlertOctagon as AlertOctagonIcon,
  CircuitBoard,
  Database,
  ShieldHalf,
  GitMerge,
  ScanSearch,
  IdCard,
  ListChecks,
  Hash,
  PercentCircle,
  PiSquare,
  Crown,
  CircleDollarSign,
  Vote,
  Square,
  Boxes,
  Atom,
  Repeat,
  PenLine,
  BookImage,
  Book,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import { navPathname } from "@/lib/comics/entry";

export type ToolCategory =
  // Reading material (the "Agile at Work" comic) — not interactive tools
  | "Library"
  | "Sprint Planning & Estimation"
  | "Metrics & Dashboards"
  | "Ceremonies"
  | "Team Health & Maturity"
  | "Portfolio & Scaling"
  | "Product Discovery"
  | "Risk & Governance"
  | "Flow & Delivery"
  | "Outcomes & Pulse"
  | "Engineering Excellence"
  | "Incidents & Reliability"
  | "Security & Compliance"
  | "Quality Engineering"
  | "Workshops & Facilitation"
  // Phase 19-39 expansion (21 new categories)
  | "AI / LLM Product Management"
  | "Prioritization Frameworks"
  | "Decision Frameworks"
  | "Root Cause Analysis"
  | "Continuous Improvement"
  | "Lean Startup & Validation"
  | "Customer Discovery"
  | "Design Thinking & UX"
  | "Spec Quality"
  | "Pricing & Monetization"
  | "Growth & PLG"
  | "Experimentation & A/B"
  | "Customer Success & Retention"
  | "People Ops & Hiring"
  | "Performance & Career"
  | "GTM, Marketing & Sales"
  | "Data & Analytics"
  | "Strategic Planning"
  | "Stakeholder Management"
  | "Coaching & 1:1 Frameworks"
  | "Change Management"
  // Phase 22 — Canvas
  | "Visual Collaboration";

/**
 * The statistics a tool runs on its data (documentation only, like
 * ToolSubscription). "trend" is a direction-of-travel test (Mann-Kendall);
 * "anomaly" flags unusual points or shifts (z-scores, CUSUM, control
 * limits); "survival" is Kaplan-Meier time to an event.
 */
export type AnalyticsFeature =
  | "forecast"
  | "trend"
  | "anomaly"
  | "survival"
  | "anti-pattern"
  | "monte-carlo";

export type ToolAudience = "coach" | "engineering-leader" | "both";

/**
 * Phase 15+ schema additions for ultra-advanced logic. Each is optional —
 * tools that don't opt in get the existing behaviour unchanged.
 */

/** Cross-tool signal subscriptions — declarative pub/sub.
 *
 * NOTE: these declarations are CURRENTLY DOCUMENTATION ONLY. The
 * derived-cache binding in signal-bridge.ts auto-invalidates cached
 * computations on every emitted signal (via INVALIDATION_MATRIX), so
 * tools that just need cached chart data to refresh are already
 * served. UI-level live updates (e.g. burndown re-rendering when a
 * sprint completes) flow through the Zustand store subscription
 * driven by the workspace mutation — not through this list.
 *
 * The intent was that `ToolPageWrapper` would auto-mount a
 * `subscribeSignals(kinds, …)` listener at mount time, but no such
 * mount exists yet (the canvas-client wires its own subscription
 * manually). Treat this list as a contract for future runtime
 * wiring + an audit trail of "which tool cares about what kind"
 * for cross-tool reasoning.
 */
export interface ToolSubscription {
  /** Signal kinds (matches `SignalKind` in src/lib/signals/signal-bus.ts). */
  kinds: string[];
  /** One-line rationale for the audit trail. */
  reason: string;
}

/** Smart-default predictions registered against (toolId, field) at boot. */
export interface PredictionSpec {
  field: string;
  /** Human label rendered in the SmartInput chip. */
  description: string;
}

/** Causal-annotation hints declared on the tool — drive chart overlays. */
export interface CausalAnnotationSpec {
  /** Where to source data from — paired with the cross-correlation engine. */
  source: string; // e.g., "impediments.raised"
  target: string; // e.g., "velocity.changed"
  /** Optional max lag in days for the cross-correlation lookup. */
  maxLagDays?: number;
}

export interface ToolDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  category: ToolCategory;
  path: string;
  icon: LucideIcon;
  badge?: "new" | "beta";
  requiresAuth: boolean;
  isRealtime: boolean;
  phase: number;
  usesWorkspace?: boolean;
  analyticsFeatures?: AnalyticsFeature[];
  /** Persona this tool primarily serves. Defaults to "both" if omitted. */
  audience?: ToolAudience;
  /** Tier 1 (full upgrade), 2 (targeted), 3 (lightweight). Defaults to 3. */
  analyticsTier?: 1 | 2 | 3;
  /** Smart-default fields backed by a registered predictor. */
  predictedDefaults?: PredictionSpec[];
  /** Cross-tool signal subscriptions. Currently documentation-only —
   * see the long-form note on {@link ToolSubscription}. */
  crossToolSubscriptions?: ToolSubscription[];
  /** Causal annotations to compute and overlay on this tool's charts. */
  causalAnnotations?: CausalAnnotationSpec[];
  /** "reading" marks content to read (the comic) rather than an interactive
   * tool: it still gets the sidebar, palette, favourites and recents, but
   * is left out of "N tools" counts. Defaults to "tool" if omitted. */
  kind?: "tool" | "reading";
  /** "more" shelves a tool built for a neighbouring audience (AI/LLM product
   * work, security, SRE and incident response, developer-experience surveys,
   * strategy frameworks). It keeps its route, guide, actions and sitemap
   * entry, but stays out of the home grid, sidebar and default search until a
   * visitor turns "Show all tools" on (lib/tools/catalog). */
  shelf?: "more";
  /** "vip" is a tool for readers of the printed book. VIP only ever adds tools:
   * no other tool is locked. Its page checks the access cookie on the server
   * (lib/vip/access) and it stays out of the sitemap, search and suggestions,
   * and out of menus and counts unless this browser holds the display hint
   * (lib/tools/catalog). */
  access?: "vip";
  /** Built and tested but not released: listed nowhere, for any visitor. For
   * Which Colleague Are You? this mirrors WHICH_COLLEAGUE_APPROVED, which can't
   * be read here because it sits with the questions in a server-only file. A
   * test fails if the two disagree. */
  pendingApproval?: true;
}

export const categories: ToolCategory[] = [
  // First so the comic heads the sidebar, command palette and home grid.
  "Library",
  "Sprint Planning & Estimation",
  "Metrics & Dashboards",
  "Ceremonies",
  "Team Health & Maturity",
  "Portfolio & Scaling",
  "Product Discovery",
  "Risk & Governance",
  "Flow & Delivery",
  "Outcomes & Pulse",
  "Engineering Excellence",
  "Incidents & Reliability",
  "Security & Compliance",
  "Quality Engineering",
  "Workshops & Facilitation",
  // Phase 19-39 expansion
  "AI / LLM Product Management",
  "Prioritization Frameworks",
  "Decision Frameworks",
  "Root Cause Analysis",
  "Continuous Improvement",
  "Lean Startup & Validation",
  "Customer Discovery",
  "Design Thinking & UX",
  "Spec Quality",
  "Pricing & Monetization",
  "Growth & PLG",
  "Experimentation & A/B",
  "Customer Success & Retention",
  "People Ops & Hiring",
  "Performance & Career",
  "GTM, Marketing & Sales",
  "Data & Analytics",
  "Strategic Planning",
  "Stakeholder Management",
  "Coaching & 1:1 Frameworks",
  "Change Management",
  // Phase 22 — Canvas
  "Visual Collaboration",
];

export const tools: ToolDefinition[] = [
  // Library — reading material. No action module, AI prompt or MCP entry:
  // the reader has no workspace data to act on.
  {
    id: "comics",
    code: "LB1",
    name: "Agile at Work",
    description:
      "Workplace comics: capable colleagues, familiar habits and small choices that make work better. A new story every week",
    category: "Library",
    path: "/comics",
    icon: BookImage,
    badge: "new",
    requiresAuth: false,
    isRealtime: false,
    phase: 34,
    usesWorkspace: false,
    audience: "both",
    analyticsTier: 3,
    kind: "reading",
  },
  {
    id: "book",
    code: "LB2",
    name: "The book",
    description:
      "The printed book: 26 workplace stories about working better together, and the page each one is on",
    category: "Library",
    path: "/book",
    icon: Book,
    requiresAuth: false,
    isRealtime: false,
    phase: 41,
    usesWorkspace: false,
    audience: "both",
    analyticsTier: 3,
    kind: "reading",
  },

  // For readers of the printed book. These descriptions reach every browser with
  // the rest of this list, so they stay general and hold nothing from the bible.
  {
    id: "squad-session",
    code: "VP1",
    name: "Squad Session Kit",
    description:
      "A timed 15-minute team session on one episode of the book: read the story, discuss its question and agree actions",
    category: "Workshops & Facilitation",
    path: "/squad-session",
    icon: Users,
    requiresAuth: false,
    isRealtime: false,
    phase: 40,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
    access: "vip",
  },
  {
    id: "meet-the-cast",
    code: "VP2",
    name: "Meet the Cast",
    description: "The colleagues of Agile at Work, and how they get along",
    category: "Library",
    path: "/meet-the-cast",
    icon: IdCard,
    requiresAuth: false,
    isRealtime: false,
    phase: 40,
    usesWorkspace: false,
    audience: "both",
    analyticsTier: 3,
    kind: "reading",
    access: "vip",
  },
  {
    id: "which-colleague",
    code: "VP3",
    name: "Which Colleague Are You?",
    description: "A short team game that starts a conversation about everyday work habits",
    category: "Team Health & Maturity",
    path: "/which-colleague",
    icon: Smile,
    requiresAuth: false,
    isRealtime: false,
    phase: 40,
    usesWorkspace: false,
    audience: "both",
    analyticsTier: 3,
    access: "vip",
  },

  // Category A: Sprint Planning & Estimation
  {
    id: "planning-poker",
    code: "A1",
    name: "Planning Poker",
    description:
      "Estimate stories with Fibonacci, T-shirt or custom decks, see how close the votes are, and keep the agreed points on the stories",
    category: "Sprint Planning & Estimation",
    path: "/planning-poker",
    icon: Target,
    requiresAuth: false,
    isRealtime: true,
    phase: 3,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "sprint-planning",
    code: "A14",
    name: "Sprint Planning",
    description:
      "Plan the sprint in one pass: check capacity and velocity, write the goal, pull stories from the backlog, size them and commit",
    category: "Sprint Planning & Estimation",
    path: "/sprint-planning",
    icon: ClipboardCheck,
    badge: "new",
    requiresAuth: false,
    isRealtime: false,
    phase: 40,
    usesWorkspace: true,
    analyticsTier: 2,
  },
  {
    id: "capacity-planner",
    code: "A2",
    name: "Sprint Capacity Planner",
    description:
      "Plan each sprint's capacity from availability, days off, team holidays and Scrum events, and turn it into a points suggestion",
    category: "Sprint Planning & Estimation",
    path: "/capacity-planner",
    icon: Calculator,
    requiresAuth: false,
    isRealtime: false,
    phase: 1,
    usesWorkspace: true,
    analyticsFeatures: ["monte-carlo"],
    analyticsTier: 1,
    predictedDefaults: [
      { field: "pointsCommitted", description: "Bayesian forecast across completed sprints" },
    ],
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "velocity.changed"],
        reason: "commitment recommendation refreshes on velocity changes",
      },
    ],
  },
  {
    id: "story-mapper",
    code: "A3",
    name: "User Story Mapper",
    description:
      "Map the user journey into release slices with point totals, then turn a slice into stories or a release forecast",
    category: "Sprint Planning & Estimation",
    path: "/story-mapper",
    icon: Map,
    requiresAuth: true,
    isRealtime: true,
    phase: 4,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "prioritizer",
    code: "A4",
    name: "Backlog Prioritizer",
    description:
      "Shared backlog: score items with MoSCoW, WSJF, RICE, Value vs Effort, ICE, Kano and Cost of Delay, compare the methods, and decide one order for Sprint Planning",
    category: "Sprint Planning & Estimation",
    path: "/prioritizer",
    icon: ArrowUpDown,
    requiresAuth: false,
    isRealtime: false,
    phase: 4,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "estimation-guide",
    code: "A5",
    name: "Estimation Reference Guide",
    description:
      "Your team's story-point reference: what each card means, with real done stories pinned as examples",
    category: "Sprint Planning & Estimation",
    path: "/estimation-guide",
    icon: BookOpen,
    requiresAuth: false,
    isRealtime: false,
    phase: 1,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "sprint-goal",
    code: "A6",
    name: "Sprint Goal Builder",
    description:
      "Write one SMART goal per sprint, with acceptance criteria and linked OKRs; it shows across the sprint tools",
    category: "Sprint Planning & Estimation",
    path: "/sprint-goal",
    icon: Crosshair,
    requiresAuth: false,
    isRealtime: false,
    phase: 1,
    usesWorkspace: true,
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "review goal performance after sprint completion" },
    ],
  },
  {
    id: "release-planner",
    code: "A7",
    name: "Release Planner",
    description:
      "Monte Carlo release forecast: when the remaining work or a story-map slice ships, and the chance of hitting a target date",
    category: "Sprint Planning & Estimation",
    path: "/release-planner",
    icon: TrendingUp,
    requiresAuth: false,
    isRealtime: false,
    phase: 4,
    usesWorkspace: true,
    analyticsFeatures: ["monte-carlo", "forecast"],
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "story.statusChanged"],
        reason: "release projection refreshes on velocity + scope changes",
      },
    ],
  },

  // Category B: Metrics & Dashboards
  {
    id: "burndown",
    code: "B1",
    name: "Burndown Generator",
    description:
      "Chart the points left each day against an ideal line on working days, read off the sprint board or a typed daily log",
    category: "Metrics & Dashboards",
    path: "/burndown",
    icon: BarChart3,
    requiresAuth: false,
    isRealtime: false,
    phase: 2,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    analyticsTier: 1,
    predictedDefaults: [
      { field: "idealSlope", description: "Mean burn-rate from prior completed sprints" },
    ],
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "sprint.started"],
        reason: "config refresh on sprint lifecycle",
      },
    ],
  },
  {
    id: "burnup",
    code: "B2",
    name: "Burnup Generator",
    description:
      "Watch the points done climb towards the scope, read off the sprint board or a typed log, with every scope addition and removal marked",
    category: "Metrics & Dashboards",
    path: "/burnup",
    icon: BarChart2,
    requiresAuth: false,
    isRealtime: false,
    phase: 2,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "sprint.started"],
        reason: "config refresh on sprint lifecycle",
      },
    ],
  },
  {
    id: "velocity",
    code: "B3",
    name: "Velocity Tracker",
    description:
      "Track velocity over the last three finished sprints, grade each on say/do, see points per person-day and plan the next sprint",
    category: "Metrics & Dashboards",
    path: "/velocity",
    icon: Activity,
    requiresAuth: false,
    isRealtime: false,
    phase: 2,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    analyticsTier: 1,
    predictedDefaults: [
      { field: "nextSprintPlan", description: "Bayesian forecast over completed sprints" },
    ],
    crossToolSubscriptions: [
      {
        kinds: ["impediment.raised", "impediment.resolved"],
        reason: "blockers correlate with velocity",
      },
    ],
  },
  {
    id: "cumulative-flow",
    code: "B4",
    name: "Cumulative Flow Diagram",
    description:
      "Stacked chart of items in each stage by day, from your Sprint or Flow board's moves, with WIP, throughput and a Little's Law lead time",
    category: "Metrics & Dashboards",
    path: "/cumulative-flow",
    icon: Layers,
    requiresAuth: false,
    isRealtime: false,
    phase: 2,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    analyticsTier: 1,
    crossToolSubscriptions: [
      { kinds: ["story.statusChanged"], reason: "CFD updates on story flow" },
    ],
  },
  {
    id: "cycle-time",
    code: "B5",
    name: "Cycle Time Analyzer",
    description:
      "Cycle times read from the Sprint and Flow boards or typed in: histogram, SLE by percentile, and ageing work in progress",
    category: "Metrics & Dashboards",
    path: "/cycle-time",
    icon: Clock,
    requiresAuth: false,
    isRealtime: false,
    phase: 2,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    analyticsTier: 1,
    predictedDefaults: [{ field: "sleTargetDays", description: "P85 of historical cycle times" }],
    crossToolSubscriptions: [
      { kinds: ["story.statusChanged"], reason: "refresh on story status flow" },
    ],
  },
  {
    id: "sprint-compare",
    code: "B6",
    name: "Sprint Comparison",
    description:
      "Up to five sprints side by side on six scores: four from each sprint's data, two suggested by Mood Tracker and the Squad Health Check",
    category: "Metrics & Dashboards",
    path: "/sprint-compare",
    icon: GitCompare,
    requiresAuth: false,
    isRealtime: false,
    phase: 2,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "auto-pin most-recent completed sprint" },
    ],
  },
  {
    id: "health-dashboard",
    code: "B7",
    name: "Team Dashboard",
    description:
      "Six team KPIs from sprints, health checks, impediments, standups and the boards, lit green, amber or red against your own thresholds",
    category: "Metrics & Dashboards",
    path: "/health-dashboard",
    icon: LayoutDashboard,
    requiresAuth: true,
    isRealtime: false,
    phase: 5,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly", "anti-pattern", "survival"],
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: [
          "sprint.completed",
          "impediment.raised",
          "incident.opened",
          "techDebt.added",
          "moodLogged",
          "okr.kr.updated",
        ],
        reason: "dashboard aggregates signals across the entire workspace",
      },
    ],
    causalAnnotations: [
      { source: "impediment.raised", target: "velocity.changed", maxLagDays: 7 },
      { source: "techDebt.added", target: "moodLogged", maxLagDays: 14 },
    ],
  },

  // Category C: Ceremonies
  {
    id: "retro",
    code: "C1",
    name: "Retro Board",
    description:
      "Run the sprint's retrospective in 8 formats, starting from that sprint's facts: write, dot-vote, discuss and agree actions with owners",
    category: "Ceremonies",
    path: "/retro",
    icon: MessageSquare,
    requiresAuth: false,
    isRealtime: true,
    phase: 3,
    usesWorkspace: true,
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "impediment.resolved"],
        reason: "retros surface insights from completed sprints and resolved blockers",
      },
    ],
  },
  {
    id: "retro-actions",
    code: "C12",
    name: "Retro Actions",
    description:
      "Follow up every action your retros agreed, with owner and due date, until it's done, and see each retro's follow-through",
    category: "Ceremonies",
    path: "/retro-actions",
    icon: ListChecks,
    badge: "new",
    requiresAuth: false,
    isRealtime: false,
    phase: 40,
    usesWorkspace: true,
    analyticsTier: 2,
  },
  {
    id: "standup",
    code: "C2",
    name: "Standup Tracker",
    description:
      "Daily Scrum over the sprint board: timed turns, last plans, blocker ages and impediment hand-off",
    category: "Ceremonies",
    path: "/standup",
    icon: Mic,
    requiresAuth: true,
    isRealtime: true,
    phase: 3,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["impediment.raised", "impediment.resolved"],
        reason: "blocker activity during standup window",
      },
    ],
  },
  {
    id: "sprint-review",
    code: "C3",
    name: "Sprint Review Kit",
    description:
      "Each sprint's review from its goal and done stories: demo script, stakeholder feedback, and checklist",
    category: "Ceremonies",
    path: "/sprint-review",
    icon: Presentation,
    requiresAuth: false,
    isRealtime: false,
    phase: 4,
    usesWorkspace: true,
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "review demo from completed sprints" },
    ],
  },
  {
    id: "ceremony-timer",
    code: "C4",
    name: "Ceremony Timer",
    description:
      "Ceremony agendas with a time-box per segment, fair speaker turns, and planned against actual at the end",
    category: "Ceremonies",
    path: "/ceremony-timer",
    icon: Timer,
    requiresAuth: false,
    isRealtime: false,
    phase: 1,
    analyticsTier: 3,
  },
  {
    id: "refinement",
    code: "C5",
    name: "Refinement Checklist",
    description:
      "Walk the backlog against your Definition of Ready, queue unsized stories for Planning Poker and mark the rest ready",
    category: "Ceremonies",
    path: "/refinement",
    icon: CheckSquare,
    requiresAuth: false,
    isRealtime: false,
    phase: 4,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "DoR pass-rate refreshes after sprint" },
    ],
  },
  {
    id: "icebreaker",
    code: "C6",
    name: "Ice Breaker Generator",
    description:
      "Icebreaker picker with 50+ activities: filter by people, time, energy and category, skip recent ones, and run it on the docked timer",
    category: "Ceremonies",
    path: "/icebreaker",
    icon: Sparkles,
    requiresAuth: false,
    isRealtime: false,
    phase: 1,
    analyticsTier: 3,
  },

  // Category D: Team Health & Maturity
  {
    id: "health-check",
    code: "D1",
    name: "Squad Health Check",
    description:
      "Traffic-light squad health check: rate each dimension green, yellow or red, by hand or by anonymous vote, with the trend since the last check and reds sent to the retro",
    category: "Team Health & Maturity",
    path: "/health-check",
    icon: HeartPulse,
    requiresAuth: true,
    isRealtime: true,
    phase: 3,
    usesWorkspace: true,
    analyticsFeatures: ["forecast"],
    analyticsTier: 3,
  },
  {
    id: "maturity",
    code: "D2",
    name: "Agile Maturity Assessment",
    description:
      "Score 8 dimensions on 5 levels as dated assessments, with a 0–100% trend and roadmap steps sent to retro actions",
    category: "Team Health & Maturity",
    path: "/maturity",
    icon: Award,
    requiresAuth: false,
    isRealtime: false,
    phase: 4,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "raci",
    code: "D3",
    name: "RACI Matrix Builder",
    description:
      "Who is Responsible, Accountable, Consulted and Informed for each activity, with teammates as columns and checks for one Accountable and overloaded roles",
    category: "Team Health & Maturity",
    path: "/raci",
    icon: Grid3X3,
    requiresAuth: false,
    isRealtime: false,
    phase: 1,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "skills-matrix",
    code: "D4",
    name: "Team Skills Matrix",
    description:
      "Rate the team's skills by level, spot gaps and single points of failure (bus factor), check each skill against its target, and plan cross-training",
    category: "Team Health & Maturity",
    path: "/skills-matrix",
    icon: Users,
    requiresAuth: false,
    isRealtime: false,
    phase: 4,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    analyticsTier: 3,
  },
  {
    id: "impediments",
    code: "D5",
    name: "Impediment Tracker",
    description:
      "Log, escalate, and resolve impediments with owners, due dates, age badges, and time-to-resolve metrics",
    category: "Team Health & Maturity",
    path: "/impediments",
    icon: AlertTriangle,
    requiresAuth: true,
    isRealtime: true,
    phase: 4,
    usesWorkspace: true,
    analyticsFeatures: ["survival", "anti-pattern"],
    analyticsTier: 1,
    predictedDefaults: [
      {
        field: "expectedResolutionDays",
        description: "Median across resolved impediments",
      },
    ],
    crossToolSubscriptions: [
      {
        kinds: ["sprint.started", "sprint.completed"],
        reason: "impediment patterns correlate with sprint lifecycle",
      },
    ],
  },

  // Category E: Portfolio & Scaling (NEW — Phase 6)
  {
    id: "pi-planning",
    code: "A8",
    name: "PI Planning Board",
    description:
      "SAFe Program Increment board: teams × iterations, PI objectives with business value, and dependencies on the Dependency Map",
    category: "Portfolio & Scaling",
    path: "/pi-planning",
    icon: CalendarRange,
    requiresAuth: false,
    isRealtime: true,
    phase: 6,
    usesWorkspace: true,
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "PI commitments roll forward as sprints complete" },
    ],
  },
  {
    id: "epic-roadmap",
    code: "A9",
    name: "Epic Roadmap",
    description: "Timeline of epics across quarters, with progress rolled up from their stories",
    category: "Portfolio & Scaling",
    path: "/epic-roadmap",
    icon: Milestone,
    requiresAuth: false,
    isRealtime: false,
    phase: 6,
    usesWorkspace: true,
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "okr.kr.updated"],
        reason: "epic progress depends on sprint outcomes + OKR shifts",
      },
    ],
  },
  {
    id: "scrum-of-scrums",
    code: "C7",
    name: "Scrum of Scrums Tracker",
    description:
      "Cross-team meeting agenda: blockers, dependencies and decisions, with open items carried to the next meeting",
    category: "Portfolio & Scaling",
    path: "/scrum-of-scrums",
    icon: GitBranch,
    requiresAuth: false,
    isRealtime: true,
    phase: 6,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    analyticsTier: 3,
  },

  // Category F: Product Discovery (NEW — Phase 7)
  {
    id: "hypothesis-tracker",
    code: "A10",
    name: "Hypothesis Tracker",
    description:
      "Lean-startup hypotheses with an optional numeric target: the measured result against it suggests a verdict you apply, and the validation rate counts only decisive results",
    category: "Product Discovery",
    path: "/hypothesis-tracker",
    icon: Lightbulb,
    requiresAuth: false,
    isRealtime: false,
    phase: 7,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "hypothesis validation cadence tied to sprints" },
    ],
  },
  {
    id: "user-interviews",
    code: "A11",
    name: "User Interview Log",
    description:
      "Research synthesis — interview quotes tagged by theme, each theme counted by the participants who raised it, anonymised exports, and a quote raised as an opportunity on the Opportunity Solution Tree",
    category: "Product Discovery",
    path: "/user-interviews",
    icon: Quote,
    requiresAuth: false,
    isRealtime: false,
    phase: 7,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "opportunity-tree",
    code: "A12",
    name: "Opportunity Solution Tree",
    description:
      "Outcome → opportunities, nested as deep as needed → solutions → experiments (Teresa Torres framework), with one target opportunity per outcome and experiments tested as hypotheses",
    category: "Product Discovery",
    path: "/opportunity-tree",
    icon: Workflow,
    requiresAuth: false,
    isRealtime: false,
    phase: 7,
    usesWorkspace: true,
    analyticsTier: 3,
  },

  // Category G: Risk & Governance (NEW — Phase 8 + 11)
  {
    id: "risk-register",
    code: "D6",
    name: "Risk Register",
    description:
      "Likelihood × impact matrix where each risk has an owner, a mitigation plan with overdue alerts and its residual risk after mitigation, and is raised as an impediment once it happens",
    category: "Risk & Governance",
    path: "/risk-register",
    icon: ShieldAlert,
    requiresAuth: false,
    isRealtime: true,
    phase: 8,
    usesWorkspace: true,
    analyticsFeatures: ["survival", "trend", "forecast", "anomaly", "anti-pattern"],
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["incident.opened", "techDebt.added"],
        reason: "risks correlate with incidents and growing tech debt",
      },
    ],
  },
  {
    id: "premortem",
    code: "C8",
    name: "Premortem Facilitator",
    description:
      '"Imagine this project failed" workshop: write causes silently, group and dot-vote them, then send the top 3 to the Risk Register with preventive actions',
    category: "Risk & Governance",
    path: "/premortem",
    icon: ScrollText,
    requiresAuth: false,
    isRealtime: true,
    phase: 8,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "tech-debt",
    code: "D7",
    name: "Technical Debt Tracker",
    description:
      "Debt items scored by impact × effort plus capped interest per sprint, with each one's age in sprints, a hotspot heatmap, and Add to backlog to schedule the paydown",
    category: "Risk & Governance",
    path: "/tech-debt",
    icon: Wrench,
    requiresAuth: false,
    isRealtime: false,
    phase: 8,
    usesWorkspace: true,
    analyticsFeatures: ["survival", "anti-pattern"],
    analyticsTier: 2,
    predictedDefaults: [
      { field: "interestRate", description: "Mean across prior tech-debt items" },
    ],
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "debt accumulation tracked per sprint" },
    ],
  },
  {
    id: "decision-log",
    code: "D12",
    name: "Decision Log (ADR)",
    description:
      "Architecture Decision Records, and decisions raised in the DACI or RAPID form, in one numbered log — context, options, outcome, consequences, status",
    category: "Risk & Governance",
    path: "/decision-log",
    icon: FileText,
    requiresAuth: false,
    isRealtime: true,
    phase: 11,
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "dod-builder",
    code: "C9",
    name: "Definition of Done Builder",
    description:
      "Write the team's Definition of Done, tick it on each Sprint board card, and track how many done stories meet it, sprint by sprint",
    category: "Risk & Governance",
    path: "/dod-builder",
    icon: ClipboardCheck,
    requiresAuth: false,
    isRealtime: false,
    phase: 11,
    usesWorkspace: true,
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "DoD adherence tied to sprint outcomes" },
    ],
  },

  // Category H: Flow & Delivery (NEW — Phase 9)
  {
    id: "kanban",
    code: "B8",
    name: "Kanban Board",
    description:
      "Run the sprint on a board of its stories, or keep a WIP-limited flow board with cycle time and throughput",
    category: "Flow & Delivery",
    path: "/kanban",
    icon: Columns,
    requiresAuth: false,
    isRealtime: true,
    phase: 9,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    analyticsTier: 1,
    predictedDefaults: [{ field: "wipLimit", description: "120% of current in-progress count" }],
    crossToolSubscriptions: [
      { kinds: ["story.statusChanged"], reason: "rebalance WIP recommendations on story flow" },
    ],
  },
  {
    id: "dependency-map",
    code: "D8",
    name: "Dependency Map",
    description:
      "Map dependencies between teams and work, with status, owners and due dates, and the longest blocking chain highlighted",
    category: "Flow & Delivery",
    path: "/dependency-map",
    icon: Network,
    requiresAuth: false,
    isRealtime: true,
    phase: 9,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["impediment.raised", "story.statusChanged"],
        reason: "dependencies surface when blockers + story flow change",
      },
    ],
  },
  {
    id: "value-stream",
    code: "B9",
    name: "Value Stream Map",
    description:
      "Map each stage's process time, lead time and %C/A to see flow efficiency, the bottleneck, and current vs future state",
    category: "Flow & Delivery",
    path: "/value-stream",
    icon: Waves,
    requiresAuth: false,
    isRealtime: false,
    phase: 9,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["story.statusChanged"],
        reason: "lead-time and flow-efficiency reflect story flow",
      },
    ],
  },
  {
    id: "sprint",
    code: "B11",
    name: "Sprint Cockpit",
    description:
      "Your current sprint on one page: ceremony status, burndown, open blockers, and close with carry-over",
    category: "Metrics & Dashboards",
    path: "/sprint",
    icon: Compass,
    badge: "new",
    requiresAuth: false,
    isRealtime: false,
    phase: 40,
    usesWorkspace: true,
    analyticsTier: 2,
  },
  {
    id: "sprint-metrics",
    code: "B10",
    name: "Sprint Metrics",
    description:
      "How your sprints went over time: say/do, carry-over and scope churn across the last finished sprints, with data checks and links into each sprint tool",
    category: "Metrics & Dashboards",
    path: "/sprint-metrics",
    icon: Gauge,
    requiresAuth: false,
    isRealtime: false,
    phase: 5,
    usesWorkspace: true,
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["sprint.completed", "sprint.started"],
        reason: "hub status refreshes on sprint lifecycle",
      },
    ],
  },

  // Category I: Outcomes & Pulse (NEW — Phase 10)
  {
    id: "okrs",
    code: "D9",
    name: "OKR Tracker",
    description:
      "Quarterly Objectives and Key Results, each measured from its baseline to a target up or down through dated check-ins, with a confidence trend and the sprint goals that move them",
    category: "Outcomes & Pulse",
    path: "/okrs",
    icon: Flag,
    requiresAuth: false,
    isRealtime: true,
    phase: 10,
    usesWorkspace: true,
    analyticsFeatures: ["trend"],
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["okr.kr.updated", "risk.opened"],
        reason: "OKR confidence shifts on KR updates and new risks",
      },
    ],
  },
  {
    id: "nps-csat",
    code: "D10",
    name: "NPS / CSAT Tracker",
    description:
      "Import or log Net Promoter Score (NPS) and CSAT survey answers and read them per week or month with the number of responses behind each, CSAT as % satisfied, and theme tags on the comments",
    category: "Outcomes & Pulse",
    path: "/nps-csat",
    icon: BarChart,
    requiresAuth: false,
    isRealtime: false,
    phase: 10,
    analyticsFeatures: ["trend", "anomaly"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["techDebt.added", "incident.opened"],
        reason: "NPS/CSAT swings link to product friction",
      },
    ],
  },
  {
    id: "mood-tracker",
    code: "D11",
    name: "Team Mood Tracker",
    description:
      "Daily mood check-ins, by name with a team heatmap or as anonymous pulses, with the trend and low-mood runs raised at the retro",
    category: "Outcomes & Pulse",
    path: "/mood-tracker",
    icon: Smile,
    requiresAuth: false,
    isRealtime: true,
    phase: 10,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    analyticsTier: 2,
    crossToolSubscriptions: [
      {
        kinds: ["impediment.raised", "sprint.completed"],
        reason: "mood tracks blockers + sprint outcomes",
      },
    ],
  },
  {
    id: "kudos",
    code: "D17",
    name: "Kudos Wall",
    description:
      "Kudos wall: send Agile at Work kudos cards, see who hasn't been thanked yet, and bring them to the retro as appreciations",
    category: "Outcomes & Pulse",
    path: "/kudos",
    icon: Award,
    badge: "new",
    requiresAuth: false,
    isRealtime: true,
    phase: 33,
    usesWorkspace: true,
    analyticsTier: 3,
  },

  // Category J: Engineering Excellence (NEW — Phase 12)
  {
    id: "dora-scorecard",
    code: "J1",
    name: "DORA Scorecard",
    description:
      "The 4 DORA keys per quarter, typed or filled from releases, boards and incidents, banded Elite to Low by the 2023 State of DevOps Report",
    category: "Engineering Excellence",
    path: "/dora-scorecard",
    icon: Activity,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    audience: "engineering-leader",
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["deploy.recorded", "incident.opened"],
        reason: "DORA metrics react to deploys + incidents",
      },
    ],
  },
  {
    id: "space-pulse",
    shelf: "more",
    code: "J2",
    name: "SPACE Pulse",
    description:
      "Quarterly self-rated SPACE survey across satisfaction, performance, activity, communication, efficiency",
    category: "Engineering Excellence",
    path: "/space-pulse",
    icon: Compass,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "devex-survey",
    shelf: "more",
    code: "J3",
    name: "DevEx Survey",
    description:
      "Lightweight developer-experience survey covering flow state, feedback loops, and cognitive load",
    category: "Engineering Excellence",
    path: "/devex-survey",
    icon: Smile,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "slo-builder",
    shelf: "more",
    code: "J4",
    name: "SLO & Error Budget Builder",
    description:
      "Define SLI/SLO targets and calculate error-budget burn rate over a rolling window",
    category: "Engineering Excellence",
    path: "/slo-builder",
    icon: Target,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 1,
    predictedDefaults: [{ field: "errorBudgetMinutes", description: "99.9% over 30 days" }],
    crossToolSubscriptions: [
      { kinds: ["incident.opened", "incident.resolved"], reason: "SLO burn driven by incidents" },
    ],
  },
  {
    id: "platform-maturity",
    shelf: "more",
    code: "J5",
    name: "Platform Engineering Maturity",
    description: "Self-assessment scorecard across golden paths, IDP, runbook hygiene, and on-call",
    category: "Engineering Excellence",
    path: "/platform-maturity",
    icon: Layers,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },

  // Category K: Incidents & Reliability (NEW — Phase 12)
  {
    id: "incident-commander",
    shelf: "more",
    code: "K1",
    name: "Incident Commander",
    description:
      "Live-incident scaffolding with severity matrix, comms templates, role assignments, and timeline log",
    category: "Incidents & Reliability",
    path: "/incident-commander",
    icon: Siren,
    requiresAuth: false,
    isRealtime: true,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["deploy.recorded"], reason: "incidents correlate with deploys" },
    ],
  },
  {
    id: "post-mortem",
    shelf: "more",
    code: "K2",
    name: "Blameless Post-Mortem",
    description:
      "Structured post-mortem with timeline, contributing factors, and action items — distinct from sprint retro",
    category: "Incidents & Reliability",
    path: "/post-mortem",
    icon: ScrollText,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    audience: "both",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["incident.resolved"], reason: "post-mortems triggered by resolved incidents" },
    ],
  },
  {
    id: "oncall-roster",
    shelf: "more",
    code: "K3",
    name: "On-Call Roster & Burnout",
    description: "Rotation schedule with paging-frequency tracking and burnout heatmap",
    category: "Incidents & Reliability",
    path: "/oncall-roster",
    icon: Phone,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 2,
    predictedDefaults: [{ field: "expectedPagesPerWeek", description: "Default oncall load" }],
    crossToolSubscriptions: [
      { kinds: ["incident.opened"], reason: "paging volume tied to incident frequency" },
    ],
  },
  {
    id: "release-readiness",
    code: "K4",
    name: "Release Readiness Checklist",
    description:
      "Your team's pre-release gates, with a feature flag check and an optional Definition of Done gate, dated ships and rollbacks, on-time rate and most-skipped gates",
    category: "Incidents & Reliability",
    path: "/release-readiness",
    icon: Rocket,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    audience: "both",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["incident.opened"], reason: "release readiness vs incidents recently shipped" },
    ],
  },
  {
    id: "runbook-scorer",
    shelf: "more",
    code: "K5",
    name: "Runbook Maturity Scorer",
    description:
      "Score each runbook on freshness, completeness, and tested-status with a team-wide hygiene index",
    category: "Incidents & Reliability",
    path: "/runbook-scorer",
    icon: BookOpen,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["incident.opened"], reason: "runbook freshness matters when incidents fire" },
    ],
  },

  // Category L: Security & Compliance (NEW — Phase 13)
  {
    id: "threat-model",
    shelf: "more",
    code: "L1",
    name: "Threat Model Registry",
    description: "STRIDE-based threat catalog per service with mitigation status",
    category: "Security & Compliance",
    path: "/threat-model",
    icon: Shield,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "vuln-burndown",
    shelf: "more",
    code: "L2",
    name: "Vulnerability Burn-Down",
    description: "Track open vulnerabilities by severity over time with SLA aging",
    category: "Security & Compliance",
    path: "/vuln-burndown",
    icon: Bug,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["survival", "anomaly"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["incident.opened"], reason: "vulns escalate when incidents fire" },
    ],
    predictedDefaults: [
      { field: "slaDaysCritical", description: "Standard SLA: 7 days for critical" },
    ],
  },
  {
    id: "control-map",
    shelf: "more",
    code: "L3",
    name: "Compliance Control Map",
    description: "Map team controls to SOC2/ISO 27001 lite categories with evidence links",
    category: "Security & Compliance",
    path: "/control-map",
    icon: ShieldCheck,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "a11y-tracker",
    shelf: "more",
    code: "L4",
    name: "Accessibility Audit Tracker",
    description: "WCAG issues by severity with fix burn-down and per-component coverage",
    category: "Security & Compliance",
    path: "/a11y-tracker",
    icon: Eye,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "both",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "a11y debt tracked alongside delivery" },
    ],
  },

  // Category M: Quality Engineering (NEW — Phase 13)
  {
    id: "test-pyramid",
    code: "M1",
    name: "Test Pyramid Analyzer",
    description:
      "Visualize the unit/integration/e2e split, name its shape (pyramid, ice-cream cone, hourglass, diamond), weigh it by test count or run time, and track it across dated snapshots",
    category: "Quality Engineering",
    path: "/test-pyramid",
    icon: Triangle,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["trend", "anti-pattern"],
    audience: "engineering-leader",
  },
  {
    id: "flaky-tests",
    code: "M2",
    name: "Flaky Test Scoreboard",
    description:
      "Log flaky tests with failed runs out of runs, owner and quarantine status — a failure rate weighted by runs, an alert for long quarantines, and the worst offenders to drive triage",
    category: "Quality Engineering",
    path: "/flaky-tests",
    icon: AlertOctagon,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["trend", "anomaly", "anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["sprint.completed"], reason: "flaky tests tracked per release/sprint" },
    ],
  },
  {
    id: "code-review-metrics",
    code: "M3",
    name: "Code Review Metrics",
    description:
      "Time to first review and PR cycle time in the team's working hours, from manual logs or pasted CSV, with a team view by PR size (no author ranking) and a weekly median",
    category: "Quality Engineering",
    path: "/code-review-metrics",
    icon: GitPullRequest,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    analyticsFeatures: ["trend", "anomaly", "anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["story.statusChanged"], reason: "PR cycle time tracks story flow" },
    ],
  },
  {
    id: "quality-cost",
    code: "M4",
    name: "Cost of Quality Calculator",
    description:
      "Prevention, detection and failure costs logged quarter by quarter, with the failure share of quality spend, its trend, and an hours × rate helper",
    category: "Quality Engineering",
    path: "/quality-cost",
    icon: BarChart,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    analyticsFeatures: ["trend"],
    audience: "both",
    analyticsTier: 3,
  },

  // Category N: Workshops & Facilitation (NEW — Phase 12)
  {
    id: "working-agreement",
    code: "N1",
    name: "Working Agreement Builder",
    description:
      "Team charter rules with each person's consent, dated check-in rounds with an adherence trend, and published versions to compare",
    category: "Workshops & Facilitation",
    path: "/working-agreement",
    icon: Handshake,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "liberating-structures",
    code: "N2",
    name: "Liberating Structures Picker",
    description:
      "Filterable catalog of 12 Liberating Structures: match by people, purpose, Scrum event and timing, then run a structure's steps on a step timer",
    category: "Workshops & Facilitation",
    path: "/liberating-structures",
    icon: Sparkles,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    audience: "coach",
    usesWorkspace: true,
    analyticsTier: 3,
  },
  {
    id: "design-sprint",
    code: "N3",
    name: "Design Sprint Tracker",
    description:
      "Five-day GV design sprint that works out today's day, keeps each day's output and sends Test-day findings on as hypotheses or backlog stories",
    category: "Workshops & Facilitation",
    path: "/design-sprint",
    icon: Lightbulb,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "riskiest-assumption",
    code: "N4",
    name: "Riskiest Assumption Canvas",
    description:
      "Lean canvas variant — list the assumptions behind a plan, rate risk and evidence (unrated until you do), rank by risk × (6 − evidence), and Test the riskiest as a linked hypothesis",
    category: "Workshops & Facilitation",
    path: "/riskiest-assumption",
    icon: AlertCircle,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "wardley-map",
    shelf: "more",
    code: "N5",
    name: "Wardley Map Canvas",
    description:
      "Map a value chain against evolution (Genesis → Commodity) and link its components",
    category: "Workshops & Facilitation",
    path: "/wardley-map",
    icon: Map,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 3,
  },

  // Additions to EXISTING categories (Phase 12-14)
  {
    id: "jtbd-mapper",
    code: "A13",
    name: "Job Story Mapper",
    description:
      '"When ___ I want ___ so I can ___" job stories with nested jobs, each one a source of user stories',
    category: "Sprint Planning & Estimation",
    path: "/jtbd-mapper",
    icon: User,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "async-standup",
    code: "C10",
    name: "Async Standup Digest",
    description:
      "Written standup updates with who hasn't posted, a blockers-first daily digest, and a 14-day history",
    category: "Ceremonies",
    path: "/async-standup",
    icon: Mail,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "both",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["impediment.raised"], reason: "blocker visibility in async digest" },
    ],
  },
  {
    id: "one-on-one",
    code: "C11",
    name: "1:1 Meeting Tracker",
    description:
      "Manager-IC 1:1 log with a rolling agenda, action items through to done, and a cadence alert per report",
    category: "Ceremonies",
    path: "/one-on-one",
    icon: Coffee,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    audience: "both",
    analyticsTier: 3,
  },
  {
    id: "psych-safety",
    code: "D13",
    name: "Psychological Safety Assessment",
    description:
      "Edmondson's seven-statement survey in anonymous rounds: a team score from five responses, compared round by round",
    category: "Team Health & Maturity",
    path: "/psych-safety",
    icon: Heart,
    requiresAuth: false,
    isRealtime: false,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "tech-radar",
    shelf: "more",
    code: "D14",
    name: "Tech Radar",
    description:
      "Thoughtworks-style adopt/trial/assess/hold quadrants for languages, frameworks, and tools",
    category: "Team Health & Maturity",
    path: "/tech-radar",
    icon: Compass,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "onboarding-tracker",
    code: "D15",
    name: "Onboarding Speed Tracker",
    description:
      "Each new joiner's milestones from an editable template, with time-to-first-PR, time-to-productivity and a ramp curve",
    category: "Team Health & Maturity",
    path: "/onboarding-tracker",
    icon: UserPlus,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "rfc-tracker",
    shelf: "more",
    code: "D16",
    name: "RFC Tracker",
    description: "Pre-decision RFC pipeline (draft → review → decided) that feeds the decision-log",
    category: "Risk & Governance",
    path: "/rfc-tracker",
    icon: FileText,
    requiresAuth: false,
    isRealtime: true,
    phase: 12,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "both",
    analyticsTier: 3,
  },
  {
    id: "stakeholder-map",
    code: "I4",
    name: "Stakeholder Map",
    description:
      "Place stakeholders on an Interest × Authority map, compare how they feel with how you need them to, and plan the next touch",
    category: "Outcomes & Pulse",
    path: "/stakeholder-map",
    icon: PieChart,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 3,
  },
  {
    id: "adkar",
    code: "I5",
    name: "ADKAR Change Tracker",
    description:
      "Move each change through Awareness, Desire, Knowledge, Ability and Reinforcement on dated moves, with each affected group's barrier point",
    category: "Outcomes & Pulse",
    path: "/adkar",
    icon: ArrowRight,
    requiresAuth: false,
    isRealtime: false,
    phase: 14,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "feature-flag-tracker",
    code: "H4",
    name: "Feature Flag Tracker",
    description:
      "Flags catalog with owner and removal date, stale alerts by purpose (kill switches never), dated retirement and the release each flag ships behind",
    category: "Flow & Delivery",
    path: "/feature-flag-tracker",
    icon: ToggleLeft,
    requiresAuth: false,
    isRealtime: false,
    phase: 13,
    usesWorkspace: true,
    analyticsFeatures: ["survival", "anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["deploy.recorded"], reason: "flag retirements often follow deploys" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // Phase 19 — AI / LLM Product Management (Cat 15) — 14 tools
  // ════════════════════════════════════════════════════════════════════
  {
    id: "llm-eval-tracker",
    shelf: "more",
    code: "AI1",
    name: "LLM Eval Tracker",
    description:
      "Time-series of eval scores across releases (accuracy, faithfulness, relevance) per prompt + dataset",
    category: "AI / LLM Product Management",
    path: "/llm-eval-tracker",
    icon: Brain,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    audience: "engineering-leader",
    analyticsTier: 1,
    predictedDefaults: [{ field: "passThreshold", description: "Mean of last 5 eval pass rates" }],
    crossToolSubscriptions: [
      { kinds: ["model.upgraded"], reason: "eval scores re-baseline on model upgrade" },
    ],
  },
  {
    id: "prompt-registry",
    shelf: "more",
    code: "AI2",
    name: "Prompt Registry",
    description: "Versioned prompt library: draft, publish and deprecate versions with notes",
    category: "AI / LLM Product Management",
    path: "/prompt-registry",
    icon: GitMerge,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["llmEval.recorded"], reason: "tag versions with eval scores when they land" },
    ],
  },
  {
    id: "ai-feature-spec",
    shelf: "more",
    code: "AI3",
    name: "AI Feature Spec",
    description:
      "PRD variant for AI features: model choice, eval criteria, fallback, latency budget, hallucination tolerance",
    category: "AI / LLM Product Management",
    path: "/ai-feature-spec",
    icon: FileText,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 3,
  },
  {
    id: "hallucination-log",
    shelf: "more",
    code: "AI4",
    name: "Hallucination Log",
    description:
      "Incident register: input, expected, actual, severity, root-cause (RAG/prompt/model), fix applied",
    category: "AI / LLM Product Management",
    path: "/hallucination-log",
    icon: AlertOctagonIcon,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["survival", "anomaly", "anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 1,
    crossToolSubscriptions: [
      {
        kinds: ["llmEval.regressionDetected", "model.upgraded"],
        reason: "regressions and upgrades correlate with new hallucinations",
      },
    ],
  },
  {
    id: "token-cost-tracker",
    shelf: "more",
    code: "AI5",
    name: "Token-Cost Tracker",
    description: "Per-feature token-spend rollup with a cost forecast and budget alerts",
    category: "AI / LLM Product Management",
    path: "/token-cost-tracker",
    icon: CircleDollarSign,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "monte-carlo"],
    audience: "engineering-leader",
    analyticsTier: 1,
    predictedDefaults: [{ field: "monthlyBudgetUsd", description: "1.2× rolling 30-day spend" }],
  },
  {
    id: "model-comparison",
    shelf: "more",
    code: "AI6",
    name: "Model Comparison Matrix",
    description:
      "Compare models side by side: cost per 1k tokens, latency p50/p95, context window, eval score, status",
    category: "AI / LLM Product Management",
    path: "/model-comparison",
    icon: Cpu,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 2,
  },
  {
    id: "ai-safety-checklist",
    shelf: "more",
    code: "AI7",
    name: "AI Safety Review Checklist",
    description:
      "Pre-launch checklist: data privacy, jailbreak tests, content-policy mapping, NIST RMF alignment",
    category: "AI / LLM Product Management",
    path: "/ai-safety-checklist",
    icon: ShieldHalf,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "model-migration",
    shelf: "more",
    code: "AI8",
    name: "Model Upgrade Migration Tracker",
    description:
      "Checklist + parity-test log when moving GPT-N → N+1 or Claude N → N+1 (eval delta, cost delta, behaviour diff)",
    category: "AI / LLM Product Management",
    path: "/model-migration",
    icon: Repeat,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    audience: "engineering-leader",
    analyticsTier: 2,
    crossToolSubscriptions: [
      { kinds: ["llmEval.recorded"], reason: "migration parity scored against eval baseline" },
    ],
  },
  {
    id: "agentic-workflow",
    shelf: "more",
    code: "AI9",
    name: "Agentic Workflow Designer",
    description:
      "Visual node list of agent steps, tools, fallbacks, and human-in-the-loop checkpoints",
    category: "AI / LLM Product Management",
    path: "/agentic-workflow",
    icon: Workflow,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 2,
  },
  {
    id: "ai-red-team",
    shelf: "more",
    code: "AI10",
    name: "AI Red-Team Session Log",
    description: "Adversarial-prompt session log: attack vector, success rate and resolution",
    category: "AI / LLM Product Management",
    path: "/ai-red-team",
    icon: ScanSearch,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "engineering-leader",
    analyticsTier: 2,
  },
  {
    id: "hitl-quality",
    shelf: "more",
    code: "AI11",
    name: "Human-in-the-Loop Quality Tracker",
    description: "Reviewer ratings, reviewer-model agreement and acceptance rate over time",
    category: "AI / LLM Product Management",
    path: "/hitl-quality",
    icon: Users,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    audience: "engineering-leader",
    analyticsTier: 1,
  },
  {
    id: "rlhf-log",
    shelf: "more",
    code: "AI12",
    name: "RLHF Feedback Log",
    description: "Pairwise comparisons + ratings dataset: prompt, A, B, winner, reviewer, reason",
    category: "AI / LLM Product Management",
    path: "/rlhf-log",
    icon: Bot,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 2,
  },
  {
    id: "vector-store-inventory",
    shelf: "more",
    code: "AI13",
    name: "Vector Store Inventory",
    description:
      "Catalog of embedding collections: model, dimensions, doc count, refresh cadence and owner",
    category: "AI / LLM Product Management",
    path: "/vector-store-inventory",
    icon: Database,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },
  {
    id: "model-card",
    shelf: "more",
    code: "AI14",
    name: "Model Card Builder",
    description:
      "Templated model documentation: intended use, training data, evaluation, biases/limitations, license",
    category: "AI / LLM Product Management",
    path: "/model-card",
    icon: IdCard,
    requiresAuth: false,
    isRealtime: false,
    phase: 19,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },

  // ════════════════════════════════════════════════════════════════════
  // Phase 20 — Prioritization Frameworks (Cat 16) — 11 tools
  // ════════════════════════════════════════════════════════════════════
  {
    id: "rice-scoring",
    code: "PR1",
    name: "RICE Scoring Calculator",
    description:
      "Score initiatives by Reach × Impact × Confidence ÷ Effort to rank a backlog economically",
    category: "Prioritization Frameworks",
    path: "/rice-scoring",
    icon: Calculator,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    audience: "both",
    analyticsTier: 1,
  },
  {
    id: "ice-score",
    code: "PR2",
    name: "ICE Score Card",
    description:
      "Lightweight Impact × Confidence × Ease score for fast prioritisation of growth experiments",
    category: "Prioritization Frameworks",
    path: "/ice-score",
    icon: Hash,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "moscow",
    code: "PR3",
    name: "MoSCoW Matrix",
    description:
      "Bucket scope into Must / Should / Could / Won't to align cross-functional teams on what's in vs out, with Musts kept to about 60% of the planned effort",
    category: "Prioritization Frameworks",
    path: "/moscow",
    icon: ListChecks,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "kano-model",
    code: "PR4",
    name: "Kano Model Builder",
    description:
      "Classify features as Must-be / Performance / Attractive / Indifferent / Reverse from a two-question customer survey, live or on paper, with Better and Worse scores",
    category: "Prioritization Frameworks",
    path: "/kano-model",
    icon: Heart,
    requiresAuth: false,
    isRealtime: true,
    phase: 20,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "both",
    analyticsTier: 1,
  },
  {
    id: "wsjf",
    code: "PR5",
    name: "WSJF Calculator",
    description:
      "SAFe's Weighted Shortest Job First: (Business Value + Time Criticality + RR/OE) ÷ Job Size",
    category: "Prioritization Frameworks",
    path: "/wsjf",
    icon: PiSquare,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "anomaly"],
    audience: "both",
    analyticsTier: 1,
  },
  {
    id: "cost-of-delay",
    code: "PR6",
    name: "Cost-of-Delay Tracker",
    description:
      "Order initiatives by CD3, cost of delay per week ÷ duration, in urgency lanes: expedite, fixed date by latest start, standard and intangible; pairs with WSJF",
    category: "Prioritization Frameworks",
    path: "/cost-of-delay",
    icon: Clock,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    analyticsFeatures: ["forecast", "monte-carlo"],
    audience: "both",
    analyticsTier: 1,
  },
  {
    id: "value-effort-matrix",
    code: "PR7",
    name: "Value vs Effort Matrix",
    description:
      "Draggable 2x2 matrix placing items by value and effort into Quick Wins / Big Bets / Fill-Ins / Time Wasters",
    category: "Prioritization Frameworks",
    path: "/value-effort-matrix",
    icon: Grid3X3,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "buy-a-feature",
    code: "PR8",
    name: "Buy-a-Feature Game",
    description:
      "Innovation game where stakeholders spend a limited budget of play money to 'buy' priced features, at the table or in anonymous rounds — surfaces tradeoffs",
    category: "Prioritization Frameworks",
    path: "/buy-a-feature",
    icon: CircleDollarSign,
    requiresAuth: false,
    isRealtime: true,
    phase: 20,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "hundred-dollar-test",
    code: "PR9",
    name: "$100 Test",
    description:
      "Cumulative voting: split $100 across competing items, as one agreed split or in anonymous team rounds, to see relative value",
    category: "Prioritization Frameworks",
    path: "/hundred-dollar-test",
    icon: Vote,
    requiresAuth: false,
    isRealtime: true,
    phase: 20,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "eisenhower",
    code: "PR10",
    name: "Eisenhower Matrix",
    description:
      "Answer urgent and important (plus a due date) for each task to sort it into Do / Schedule / Delegate / Delete",
    category: "Prioritization Frameworks",
    path: "/eisenhower",
    icon: Square,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "walking-skeleton",
    code: "PR11",
    name: "Walking Skeleton Builder",
    description:
      "Define the smallest end-to-end path that proves the architecture works (Cockburn), step by step across the layers",
    category: "Prioritization Frameworks",
    path: "/walking-skeleton",
    icon: Boxes,
    requiresAuth: false,
    isRealtime: false,
    phase: 20,
    usesWorkspace: true,
    audience: "engineering-leader",
    analyticsTier: 3,
  },

  // ════════════════════════════════════════════════════════════════════
  // Phase 21 — Decision Frameworks (Cat 17) — 8 tools
  // ════════════════════════════════════════════════════════════════════
  {
    id: "daci",
    code: "DC1",
    name: "DACI Decision Doc",
    description:
      "The same records as the Decision Log, raised in the DACI form: Driver / Approver / Contributors / Informed roles for each decision (Atlassian/Intuit)",
    category: "Decision Frameworks",
    path: "/daci",
    icon: Crown,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "rapid-decision",
    code: "DC2",
    name: "RAPID Decision Matrix",
    description:
      "The same records as the Decision Log, raised in the RAPID form: Bain's Recommend / Agree / Perform / Input / Decide for governance-heavy decisions",
    category: "Decision Frameworks",
    path: "/rapid-decision",
    icon: Users,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "weighted-decision",
    code: "DC3",
    name: "Weighted Decision Matrix",
    description:
      "Score options against weighted criteria (Pugh/MCDA) in named matrices — ties and weight sensitivity flagged, and the result can go to the Decision Log as a proposed record",
    category: "Decision Frameworks",
    path: "/weighted-decision",
    icon: PercentCircle,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    analyticsFeatures: ["anomaly"],
    audience: "both",
    analyticsTier: 1,
  },
  {
    id: "six-hats",
    code: "DC4",
    name: "Six Thinking Hats",
    description:
      "De Bono's six hats (facts, feelings, risks, benefits, new ideas, process) in timed rounds, ending in a Blue-hat summary for the Decision Log",
    category: "Decision Frameworks",
    path: "/six-hats",
    icon: Sparkles,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },
  {
    id: "ooda-loop",
    shelf: "more",
    code: "DC5",
    name: "OODA Loop Tracker",
    description: "Boyd's Observe-Orient-Decide-Act cycle for fast adaptation in chaotic conditions",
    category: "Decision Frameworks",
    path: "/ooda-loop",
    icon: Activity,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    analyticsFeatures: ["survival"],
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "cynefin",
    code: "DC6",
    name: "Cynefin Decision Picker",
    description:
      "Snowden's framework: guided questions suggest whether a problem is Clear / Complicated / Complex / Chaotic / Confused, the team confirms, and complex ones become hypotheses",
    category: "Decision Frameworks",
    path: "/cynefin",
    icon: Compass,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "stacey-matrix",
    shelf: "more",
    code: "DC7",
    name: "Stacey Matrix",
    description:
      "Plot work on Certainty (how) vs Agreement (what) → Simple / Complicated / Complex / Chaotic",
    category: "Decision Frameworks",
    path: "/stacey-matrix",
    icon: Atom,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    audience: "both",
    analyticsTier: 2,
  },
  {
    id: "polarity-map",
    shelf: "more",
    code: "DC8",
    name: "Polarity Map",
    description:
      "Barry Johnson's tool for managing chronic tensions (e.g. centralisation vs autonomy) instead of solving them",
    category: "Decision Frameworks",
    path: "/polarity-map",
    icon: CircuitBoard,
    requiresAuth: false,
    isRealtime: false,
    phase: 21,
    usesWorkspace: true,
    audience: "coach",
    analyticsTier: 3,
  },

  // ════════════════════════════════════════════════════════════════════
  // Phase 22 — Canvas (Miro-like collaborative whiteboard)
  // ════════════════════════════════════════════════════════════════════
  {
    id: "canvas",
    code: "WB1",
    name: "Canvas",
    description:
      "Infinite whiteboard — stickies, shapes, free-hand drawing, smart connectors, multiple boards, AI clustering, cross-tool import and live sprint and story map boards.",
    category: "Visual Collaboration",
    path: "/canvas",
    icon: PenLine,
    requiresAuth: false,
    isRealtime: true,
    phase: 22,
    usesWorkspace: true,
    analyticsFeatures: ["anti-pattern"],
    audience: "both",
    analyticsTier: 1,
    crossToolSubscriptions: [
      // Only reference SignalKinds that actually exist in
      // src/lib/signals/signal-bus.ts. "retro.cardAdded" was declared
      // here but never added to the signal-bus union; subscriptions to
      // unknown kinds are silent no-ops, so the prior list was an empty
      // promise. Real retro-tool signals can be added back here when
      // the retro tool starts emitting them.
      {
        kinds: ["story.statusChanged", "risk.opened", "okr.kr.updated", "decision.recorded"],
        reason: "imported cross-tool entities can update the board live",
      },
    ],
  },
];

export function getToolByPath(path: string): ToolDefinition | undefined {
  const current = navPathname(path);
  return tools.find((t) => t.path === current);
}

export function getToolById(id: string): ToolDefinition | undefined {
  return tools.find((t) => t.id === id);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return tools.filter((t) => t.category === category);
}

export function getToolsByAnalytics(feature: AnalyticsFeature): ToolDefinition[] {
  return tools.filter((t) => t.analyticsFeatures?.includes(feature));
}

export function getRealtimeTools(): ToolDefinition[] {
  return tools.filter((t) => t.isRealtime);
}

export function getWorkspaceTools(): ToolDefinition[] {
  return tools.filter((t) => t.usesWorkspace);
}

export function getToolsByAudience(audience: ToolAudience): ToolDefinition[] {
  return tools.filter((t) => {
    const a = t.audience ?? "both";
    return audience === "both" || a === "both" || a === audience;
  });
}
