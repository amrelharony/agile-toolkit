import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";

interface ReleasePlannerData {
  config: { backlogSize: number; velocityInput: string; scopeBuffer: number; sprintLengthDays: number; startDate: string };
  results: { p50: number; p75: number; p85: number; p95: number } | null;
}

export function generateReleasePlannerPrompts(data: ReleasePlannerData): PromptDefinition[] {
  const velocities = data.config.velocityInput
    .split(/[,\n]+/)
    .map((v) => parseFloat(v.trim()))
    .filter((v) => !isNaN(v));

  if (velocities.length === 0) return [];

  const avgVel = Math.round((velocities.reduce((a, b) => a + b, 0) / velocities.length) * 10) / 10;
  const ctx = [
    `Backlog Size: ${data.config.backlogSize} story points`,
    `Historical Velocities: ${velocities.join(", ")} pts/sprint`,
    `Average Velocity: ${avgVel} pts/sprint`,
    `Scope Buffer: ${data.config.scopeBuffer}%`,
    `Sprint Length: ${data.config.sprintLengthDays} days`,
    `Start Date: ${data.config.startDate}`,
  ].join("\n");

  const forecastBlock = data.results
    ? [
        `50th percentile: ${data.results.p50} sprints`,
        `75th percentile: ${data.results.p75} sprints`,
        `85th percentile: ${data.results.p85} sprints`,
        `95th percentile: ${data.results.p95} sprints`,
      ].join("\n")
    : "No simulation results available yet.";

  return [
    {
      id: "release-risk",
      title: "Release Risk Assessment",
      description: "Interpret Monte Carlo forecasts and recommend a target release date.",
      prompt: buildPreamble("Release Planner", "It uses Monte Carlo simulation with historical velocity to forecast release dates.") +
        `## Inputs\n\n${ctx}\n\n## Forecast Results\n\n${forecastBlock}\n\n## Questions\n\n1. Which confidence level should the team commit to externally? Why?\n2. What are the top 3 risks to meeting the forecast?\n3. How does the velocity variability (${velocities.join(", ")}) affect forecast reliability?\n4. What contingency plans should the team have if velocity drops?\n5. How should the team communicate this forecast to stakeholders in a way that sets appropriate expectations?`,
    },
    {
      id: "release-scenarios",
      title: "Velocity Improvement Scenarios",
      description: "Explore what-if scenarios for improving release timelines.",
      prompt: buildPreamble("Release Planner", "Explore scenarios to improve the release forecast.") +
        `## Current Inputs\n\n${ctx}\n\n## Current Forecast\n\n${forecastBlock}\n\n## Questions\n\n1. If the team improves velocity by 10%, 20%, or 30%, how would the forecast change?\n2. What scope reduction (removing lowest-priority items) would bring the release forward by 2 sprints?\n3. What is the minimum viable scope that could ship at the 85th percentile within [X] sprints?\n4. Would adding a team member help? What's the typical impact on velocity?\n5. Create a decision matrix: scope reduction vs. velocity improvement vs. timeline extension.`,
    },
  ];
}
