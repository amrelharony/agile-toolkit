import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface KPI {
  name: string;
  value: string | number;
  unit: string;
  status: "green" | "amber" | "red";
  trend: "up" | "down" | "same";
  sourceName: string;
  description: string;
}

interface HealthDashboardData {
  kpis: KPI[];
}

export function generateHealthDashboardPrompts(data: HealthDashboardData): PromptDefinition[] {
  if (data.kpis.length === 0) return [];

  const table = formatTable(
    ["KPI", "Value", "Status", "Trend", "Source"],
    data.kpis.map((k) => [k.name, `${k.value} ${k.unit}`, k.status.toUpperCase(), k.trend === "up" ? "↑" : k.trend === "down" ? "↓" : "→", k.sourceName])
  );

  const reds = data.kpis.filter((k) => k.status === "red");
  const ambers = data.kpis.filter((k) => k.status === "amber");

  return [
    {
      id: "dashboard-summary",
      title: "Executive Health Summary",
      description: "Generate a stakeholder-ready summary of team health KPIs.",
      prompt: buildPreamble("Health Dashboard", "It aggregates key performance indicators from multiple agile tools into a single view.") +
        `## KPI Overview\n\n${table}\n\n🔴 Red KPIs: ${reds.length > 0 ? reds.map((k) => k.name).join(", ") : "None"}\n🟠 Amber KPIs: ${ambers.length > 0 ? ambers.map((k) => k.name).join(", ") : "None"}\n\n## Questions\n\n1. Write a 3-paragraph executive summary of the team's current health for leadership.\n2. What are the top 3 most concerning KPIs and what do they signal?\n3. Are there correlations between KPIs (e.g., low velocity + high cycle time + many impediments)?\n4. What is the single most impactful improvement the team could make right now?\n5. Draft 3 bullet points for a status report that honestly conveys both strengths and risks.`,
    },
    {
      id: "dashboard-roadmap",
      title: "Improvement Roadmap",
      description: "Create a prioritized improvement plan from red and amber KPIs.",
      prompt: buildPreamble("Health Dashboard", "Design an improvement plan based on the aggregated KPIs.") +
        `## KPI Overview\n\n${table}\n\n## Questions\n\n1. Rank the red/amber KPIs by impact — which improvement would create the biggest positive ripple effect?\n2. For each red KPI, suggest a 2-week improvement experiment with a clear hypothesis.\n3. What data sources are missing that would give a more complete health picture?\n4. How should the team balance fixing KPIs vs. delivering new features?\n5. Design a monthly review cadence for these KPIs — who reviews, what triggers action, what thresholds matter?`,
    },
  ];
}
