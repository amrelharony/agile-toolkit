/**
 * Bug Triage's AI task, the server half: the instructions and the bugs as
 * data. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { REACH_LABEL } from "@/lib/bug-triage/model";
import { SEVERITY_REASON_MAX, bugTriageSeverityTask } from "./bug-triage";

const yesNo = (v: boolean | undefined) => (v === undefined ? "not answered" : v ? "yes" : "no");

export const bugTriageSeverityPrompt = defineAiPrompt(bugTriageSeverityTask, {
  system: [
    "You help a software team triage new bugs.",
    "For each bug, suggest its severity (how bad it is) and its priority (how soon it needs fixing), keeping the two apart.",
    'Severity: "critical" loses or leaks data, opens a security or privacy hole, or stops people working with no way round it; "major" breaks a main path or gives a wrong result; "minor" is annoying but people can carry on; "cosmetic" is only how it looks or reads.',
    'Priority: "now" fixes it in the running sprint; "next" plans it for the next sprint; "later" plans it when there is room; "someday" only if nothing else needs doing.',
    "The team's quick checks, when answered, outweigh the wording.",
    `Give one suggestion per bug, with its id copied exactly as given, and a reason of one short sentence (at most ${SEVERITY_REASON_MAX} characters) in plain words.`,
    "When a bug clearly describes the same problem as another bug listed (one of the bugs to triage, or one of the other open bugs), give that other bug's id as duplicateOf; otherwise leave it out. Never use a bug's own id.",
    "Never invent bugs or ids.",
  ].join(" "),
  user: ({ bugs, open = [] }) =>
    [
      "Bugs to triage, oldest first:",
      ...bugs.map((b) =>
        [
          `- id: ${b.id}`,
          `  title: ${b.title}`,
          b.area ? `  area: ${b.area}` : "",
          b.details ? `  details: ${b.details}` : "",
          b.checks
            ? `  checks: loses or leaks data ${yesNo(b.checks.dataLoss)}; security hole ${yesNo(b.checks.security)}; people can get round it ${yesNo(b.checks.workaround)}; blocks a release ${yesNo(b.checks.blocksRelease)}; who hits it ${b.checks.reach ? REACH_LABEL[b.checks.reach].toLowerCase() : "not answered"}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      ),
      open.length > 0 ? "Other open bugs:" : "",
      ...open.map((o) => `- id: ${o.id}, title: ${o.title}`),
    ]
      .filter(Boolean)
      .join("\n"),
});
