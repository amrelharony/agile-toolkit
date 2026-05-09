import { PageHeader } from "@/components/shared/PageHeader";
import { ToolCard } from "@/components/shared/ToolCard";
import {
  Kanban,
  Timer,
  BarChart3,
  Users,
  Target,
  Layers,
  Zap,
  FileText,
  GitBranch,
} from "lucide-react";

const tools = [
  {
    href: "/board",
    icon: <Kanban className="w-5 h-5" />,
    title: "Kanban Board",
    description:
      "Visual workflow management with WIP limits, swimlanes, and cycle time tracking.",
    tags: ["kanban", "flow"],
  },
  {
    href: "/sprints",
    icon: <Timer className="w-5 h-5" />,
    title: "Sprint Planner",
    description:
      "Plan sprints with velocity forecasting, capacity planning, and backlog prioritization.",
    tags: ["scrum", "planning"],
  },
  {
    href: "/retro",
    icon: <Users className="w-5 h-5" />,
    title: "Retrospective Hub",
    description:
      "Run structured retros with templates, voting, action items, and trend analysis.",
    tags: ["team", "continuous improvement"],
  },
  {
    href: "/metrics",
    icon: <BarChart3 className="w-5 h-5" />,
    title: "Agile Metrics",
    description:
      "Track velocity, burndown, cumulative flow, lead time, and team health indicators.",
    tags: ["analytics", "data"],
  },
  {
    href: "/estimation",
    icon: <Target className="w-5 h-5" />,
    title: "Estimation Toolkit",
    description:
      "Planning poker, T-shirt sizing, and story point reference guides.",
    tags: ["estimation", "planning"],
  },
  {
    href: "/ceremonies",
    icon: <Layers className="w-5 h-5" />,
    title: "Ceremony Templates",
    description:
      "Structured agendas for stand-ups, reviews, refinements, and retrospectives.",
    tags: ["templates", "facilitation"],
  },
  {
    href: "/automation",
    icon: <Zap className="w-5 h-5" />,
    title: "Workflow Automation",
    description:
      "Automate status transitions, notifications, and recurring ceremony scheduling.",
    tags: ["automation", "efficiency"],
  },
  {
    href: "/docs",
    icon: <FileText className="w-5 h-5" />,
    title: "Playbook & Guides",
    description:
      "Comprehensive agile delivery playbook with frameworks, anti-patterns, and case studies.",
    tags: ["docs", "knowledge"],
  },
  {
    href: "/release",
    icon: <GitBranch className="w-5 h-5" />,
    title: "Release Tracker",
    description:
      "Track release trains, feature flags, deployment status, and rollback plans.",
    tags: ["release", "devops"],
  },
];

export default function DashboardPage() {
  return (
    <div>
      {/* Hero section — matches main site's reveal animation stagger */}
      <PageHeader
        label="Dashboard"
        title="Agile Toolkit"
        subtitle="Curated tools, frameworks, and templates for modern delivery teams."
        gradient
      />

      {/* Impact metrics — matches main site's .imp pattern */}
      <div className="flex flex-wrap gap-6 md:gap-10 mb-10">
        {[
          { value: "9", label: "Tools" },
          { value: "24+", label: "Templates" },
          { value: "5", label: "Frameworks" },
        ].map((metric, i) => (
          <div
            key={metric.label}
            className={`text-center stagger-item animate-slide-up delay-${i + 1}`}
          >
            <div className="font-mono text-h5 font-bold text-accent text-glow">
              {metric.value}
            </div>
            <div className="font-mono text-nano tracking-wider uppercase text-sub mt-0.5">
              {metric.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tool grid — responsive 1→2→3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tools.map((tool, i) => (
          <div
            key={tool.href}
            className={`stagger-item animate-slide-up delay-${Math.min(i + 1, 6)}`}
          >
            <ToolCard {...tool} />
          </div>
        ))}
      </div>

      {/* Scroll progress indicator */}
      <div className="scroll-progress" id="scrollProgress" />
    </div>
  );
}
