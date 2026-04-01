export interface MaturityLevel {
  level: number;
  label: string;
  description: string;
}

export interface MaturityDimension {
  id: string;
  name: string;
  levels: MaturityLevel[];
}

export const MATURITY_DIMENSIONS: MaturityDimension[] = [
  {
    id: "scrum-practices",
    name: "Scrum Practices",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "Ceremonies are ad hoc or skipped; roles are unclear; no consistent use of artifacts like backlogs or definition of done.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Most ceremonies happen regularly but are often too long or off-track; the Scrum Master role exists but is not fully understood; basic backlog present.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "All Scrum ceremonies run timeboxed and purposeful; PO, SM, and Dev Team roles are clearly separated; Definition of Done is documented and followed.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "Ceremonies are facilitated with clear agendas, measurable outcomes, and action follow-up; artifacts are kept updated and visible to all stakeholders.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "The team continuously experiments with ceremony format and cadence to maximize value; artifacts are real-time and drive strategic decisions.",
      },
    ],
  },
  {
    id: "team-collaboration",
    name: "Team Collaboration",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "Work is siloed; individuals own tasks with no cross-skilling; team depends on a manager to coordinate; conflict is avoided rather than resolved.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Some pairing and knowledge sharing occurs; team has basic shared goals but still relies heavily on leads; self-organization is emerging.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "Team regularly pair-programs and mob-solves; decisions are made collectively; members cover for each other across disciplines when needed.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "Cross-functional work is the default; the team collectively owns the sprint outcome; interpersonal dynamics are actively managed and healthy.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "The team is fully self-organizing, adapts structure to challenges, mentors other teams, and co-creates a high-trust collaborative culture.",
      },
    ],
  },
  {
    id: "technical-excellence",
    name: "Technical Excellence",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "No automated tests; deployments are manual and infrequent; code quality depends on individual effort; technical debt is unmanaged.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Some unit tests exist; there is a CI pipeline but it is often broken; code reviews happen inconsistently; tech debt is acknowledged but rarely addressed.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "CI/CD pipeline is stable with automated tests; code reviews are mandatory; tech debt backlog exists and stories are regularly allocated to address it.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "High test coverage including integration and e2e; trunk-based development with feature flags; quality metrics are tracked and feed retrospectives.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "Continuous deployment to production multiple times per day; zero-downtime releases; team drives engineering standards adopted org-wide.",
      },
    ],
  },
  {
    id: "product-management",
    name: "Product Management",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "Backlog is a dumping ground of features; no clear prioritization; PO is not empowered; team builds what they are told with no understanding of business value.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Backlog is partially groomed; some use of prioritization criteria; PO attends ceremonies but struggles to say no or articulate value.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "Backlog is groomed two sprints ahead; user stories include acceptance criteria and value statements; a clear prioritization framework (e.g. WSJF or MoSCoW) is applied consistently.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "Product roadmap is outcome-driven; OKRs or KPIs are tied to backlog items; PO actively negotiates scope with stakeholders based on ROI.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "Team co-creates product strategy; continuous discovery loops feed the backlog; hypotheses are validated with data before major investment.",
      },
    ],
  },
  {
    id: "metrics-transparency",
    name: "Metrics & Transparency",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "No metrics tracked; progress is reported subjectively; stakeholders have no visibility into team performance or impediments.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Velocity is tracked but not well understood; burndown chart exists but is rarely consulted; information radiators are present but stale.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "Velocity, burndown, and cycle time are tracked and reviewed each sprint; information radiators are up-to-date; impediment log is visible.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "A suite of Agile metrics (throughput, lead time, predictability) drives planning decisions; OKR progress is visible to the whole organization.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "Metrics drive continuous improvement experiments; team contributes to org-level benchmarks; dashboards are self-service and real-time.",
      },
    ],
  },
  {
    id: "continuous-improvement",
    name: "Continuous Improvement",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "No retrospectives held; problems recur without resolution; blame culture discourages surfacing issues.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Retrospectives happen but produce few actionable outcomes; the same issues are raised repeatedly; improvements are not tracked.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "Retrospectives produce a prioritized action list with owners; improvements are tracked sprint-over-sprint and reviewed for effectiveness.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "Multiple improvement formats (kaizen events, process experiments) are used; psychological safety enables honest dialogue; trends are measured.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "The team runs structured experiments to improve delivery; improvements are documented and shared with other teams; kaizen is embedded in culture.",
      },
    ],
  },
  {
    id: "stakeholder-engagement",
    name: "Stakeholder Engagement",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "Stakeholders receive updates only at project milestones; no regular demos; feedback loops are absent or very slow.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Sprint reviews occur but attendance is low; feedback is gathered inconsistently; stakeholders often surprised by what gets delivered.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "Sprint reviews are well-attended with structured demos; stakeholder feedback is captured and fed into the backlog within one sprint.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "Stakeholders are embedded in the process, participating in refinement and discovery; feedback loops are continuous and measurable.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "Stakeholders co-create roadmaps and priorities; real user feedback from production drives backlog decisions; NPS or CES metrics are tracked.",
      },
    ],
  },
  {
    id: "agile-culture",
    name: "Agile Culture",
    levels: [
      {
        level: 1,
        label: "Initial",
        description:
          "Command-and-control management; Agile is imposed from above; team members are resistant or confused; psychological safety is low.",
      },
      {
        level: 2,
        label: "Developing",
        description:
          "Agile values are acknowledged but not consistently modeled by leaders; some team members embrace the mindset while others do not.",
      },
      {
        level: 3,
        label: "Defined",
        description:
          "Leadership demonstrates servant leadership; failure is treated as a learning opportunity; team openly shares concerns and ideas.",
      },
      {
        level: 4,
        label: "Managed",
        description:
          "Psychological safety is actively nurtured; diversity of thought is valued; Agile mindset is reflected in how decisions are made at all levels.",
      },
      {
        level: 5,
        label: "Optimizing",
        description:
          "The organization is truly learning-oriented; teams experiment boldly; Agile culture influences hiring, performance reviews, and organizational design.",
      },
    ],
  },
];

export const MATURITY_LEVEL_LABELS: Record<number, string> = {
  1: "Initial",
  2: "Developing",
  3: "Defined",
  4: "Managed",
  5: "Optimizing",
};

export interface MaturityScore {
  percentage: number;
  label: string;
  color: string;
}

export function getMaturityScore(averageLevel: number): MaturityScore {
  const percentage = Math.round((averageLevel / 5) * 100);
  if (percentage < 30)
    return { percentage, label: "Ad-hoc", color: "#ef4444" };
  if (percentage < 50)
    return { percentage, label: "Emerging", color: "#f97316" };
  if (percentage < 65)
    return { percentage, label: "Developing", color: "#eab308" };
  if (percentage < 80)
    return { percentage, label: "Proficient", color: "#22c55e" };
  return { percentage, label: "Optimizing", color: "#00f0ff" };
}
