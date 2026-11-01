/**
 * Labels for the stories' theme codes, generated once from
 * editorial.thematic_expansion_map in Agile_At_Work_Expanded_Canon.json. The
 * wording belongs to the comic's canon, so don't edit it here.
 */
export const THEME_LABELS: Readonly<Record<string, string>> = {
  T01: "Shared language and direct understanding",
  T02: "Incentives, credit and shared success",
  T03: "Forecasts, uncertainty and changing assumptions",
  T04: "Identity, status and a useful future role",
  T05: "Invisible coordination and uneven mental load",
  T06: "AI assistance, human judgement and consistent evidence",
  T07: "Practical authority, support and accessible leadership",
  T08: "Capability, onboarding and knowledge resilience",
  T09: "Evidence that survives preference and presentation",
  T10: "Questions, decisions and useful working memory",
  T11: "Professional humility and a method that fits the need",
  T12: "Purposeful controls, protected feedback and usable criteria",
};

/** The label for a code, or the code itself if a story carries an unknown one. */
export function themeLabel(code: string): string {
  return THEME_LABELS[code] ?? code;
}
