import { cafeMoves } from "@/lib/team-mixer/cafe";
import { groupLabel } from "@/lib/team-mixer/model";
import { ruleText } from "@/lib/team-mixer/weights";
import type { MixerCafe, MixerRound, MixerState } from "@/lib/team-mixer/state";

/** "12 Nov 2026" from an ISO time. */
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Text safe inside a Markdown line: no line breaks, no table pipes. */
const line = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();

function roundMarkdown(r: MixerRound, number: number): string[] {
  const out: string[] = [];
  const unit = r.mode === "pairs" ? "pairs" : "groups";
  out.push(`## Round ${number}: ${r.groups.length} ${unit}${r.at ? ` (${day(r.at)})` : ""}`, "");
  if (r.title) out.push(line(r.title), "");
  r.groups.forEach((g, i) => {
    const label = groupLabel(r.mode, i);
    out.push(
      `- **${g.name ? `${line(g.name)} (${label})` : label}:** ${g.people.map(line).join(", ")}`
    );
  });
  if (r.sitOut.length > 0) out.push(`- **Sitting out:** ${r.sitOut.map(line).join(", ")}`);
  if (r.issues.length > 0) {
    out.push("", "Notes:");
    for (const issue of r.issues) out.push(`- ${line(issue.text)}`);
  }
  out.push("");
  return out;
}

function cafeMarkdown(cafe: MixerCafe): string[] {
  const out: string[] = ["## World Café", ""];
  if (cafe.title) out.push(line(cafe.title), "");
  const hosts = cafe.rounds[0].map((t) => t.host);
  out.push(
    `${hosts.length} tables over ${cafe.rounds.length} ${cafe.rounds.length === 1 ? "round" : "rounds"}. Hosts stay at their table; everyone else moves.`,
    ""
  );
  cafe.rounds.forEach((round, r) => {
    out.push(`### Round ${r + 1}`, "");
    round.forEach((t, i) => {
      const label = t.name ? `${line(t.name)} (${groupLabel("cafe", i)})` : groupLabel("cafe", i);
      out.push(
        `- **${label}**, host ${line(t.host)}: ${t.guests.map(line).join(", ") || "no guests"}`
      );
    });
    out.push("");
  });
  const moves = cafeMoves({ hosts, rounds: cafe.rounds });
  out.push("### Who goes where", "");
  out.push(`| Person | ${cafe.rounds.map((_, r) => `Round ${r + 1}`).join(" | ")} |`);
  out.push(`| --- | ${cafe.rounds.map(() => "---").join(" | ")} |`);
  for (const [name, tables] of Array.from(moves.entries())) {
    const host = hosts.includes(name) ? " (host)" : "";
    out.push(
      `| ${line(name)}${host} | ${tables.map((t) => (t >= 0 ? `Table ${t + 1}` : "-")).join(" | ")} |`
    );
  }
  out.push("");
  if (cafe.issues.length > 0) {
    out.push("Notes:");
    for (const issue of cafe.issues) out.push(`- ${line(issue.text)}`);
    out.push("");
  }
  return out;
}

/** The mix as Markdown: the World Café plan or the rounds (newest first), and the rules. */
export function toMarkdown(s: MixerState): string {
  const out: string[] = ["# Team Mixer", ""];
  if (s.title) out.push(`**For:** ${line(s.title)}`, "");
  out.push(
    `**In the mix (${s.people.length}):** ${s.people.map((p) => line(p.name)).join(", ") || "nobody yet"}`,
    ""
  );
  if (s.mode === "cafe" && s.cafe) out.push(...cafeMarkdown(s.cafe));
  const rounds = s.rounds.map((r, i) => ({ r, n: i + 1 })).reverse();
  for (const { r, n } of rounds) out.push(...roundMarkdown(r, n));
  if (s.mode !== "cafe" && s.cafe) out.push(...cafeMarkdown(s.cafe));
  if (s.rules.length > 0) {
    out.push("## Rules", "");
    for (const r of s.rules) out.push(`- ${line(ruleText(r))}`);
    out.push("");
  }
  if (s.rounds.length === 0 && !s.cafe) out.push("_No groups mixed yet._", "");
  return out.join("\n").trimEnd() + "\n";
}
