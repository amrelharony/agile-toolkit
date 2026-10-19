import type { ToolGuide } from "./types";

/** Guides for the "Quality, reliability & risk" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "tech-debt",
    summary:
      "A technical debt register lists the shortcuts and aging code that slow the team down. It scores each item by impact, effort and the “interest” it costs every sprint, and ranks what to pay down first.",
    whenToUse: [
      "When the team keeps saying “we should fix that” but nothing gets scheduled.",
      "Before sprint or quarterly planning, to choose which debt to pay down.",
      "When you need to show stakeholders what debt costs in lost velocity.",
    ],
    steps: [
      "Click New Debt for each item. Give it a short title, an Area (service or module) and an optional description.",
      "Set Impact (how much it hurts delivery or quality) and Effort (how big the fix is), each from 1 to 5.",
      "Enter the interest per sprint: roughly how many velocity points the debt costs each sprint it stays.",
      "The list ranks itself by score. Impact counts most, effort lowers the score, and interest adds more the longer an item stays.",
      "Use the Impact × Effort Heatmap: top-left cells (high impact, low effort) are the best paydown targets. Top Hotspot shows the area with the most impact points.",
      "Review the list at refinement each sprint, pull one or two items into the sprint, and remove items once they're paid down.",
    ],
    tips: [
      "Write each item as the problem it causes (“deploys take 40 minutes because…”), not just the code smell.",
      "Reserve a steady share of every sprint for paydown instead of waiting for a cleanup sprint.",
      "Debt that could cause an outage belongs in the Risk Register too.",
    ],
    scales: [
      {
        name: "Impact",
        values: [
          { value: "1–2", meaning: "annoying, but rarely slows work" },
          { value: "3", meaning: "regularly slows the team or causes bugs" },
          { value: "4–5", meaning: "blocks delivery or causes incidents" },
        ],
      },
      {
        name: "Effort",
        values: [
          { value: "1–2", meaning: "a day or two" },
          { value: "3", meaning: "about a sprint" },
          { value: "4–5", meaning: "several sprints; needs planning" },
        ],
      },
    ],
  },
  {
    toolId: "dod-builder",
    summary:
      "The Definition of Done (DoD) is the shared checklist every backlog item must meet before the team calls it done. This builder assembles the checklist by category and tracks how well the team kept to it each sprint.",
    whenToUse: [
      "Forming a new team, or when “done” means different things to different people.",
      "When bugs or rework keep coming back from work that was marked done.",
      "At a retro, to check whether the team is living up to its own quality bar.",
    ],
    steps: [
      "Start from the starter items and add your own under the tabs: Code, Testing, Docs, Performance, Security and Other.",
      "Mark each item Required or Optional. Only Required items count toward adherence.",
      "During the sprint, tick the done checkbox for each item the team actually met for its work.",
      "At sprint end, type the Sprint name and click Snapshot this sprint. This saves the score and clears the ticks for the next sprint.",
      "After four or more snapshots, watch the adherence chart. A point below the LCL line means the DoD slipped more than normal variation.",
    ],
    tips: [
      "Keep the Required list short enough that the team really meets it every time. Add items as the team's skills grow.",
      "The DoD applies to every item; acceptance criteria apply to one story. You need both.",
      "Pair it with the Refinement Checklist, which covers whether work is ready to start.",
    ],
  },
  {
    toolId: "dora-scorecard",
    summary:
      "DORA's four key metrics measure software delivery: two for speed (deployment frequency, lead time for changes) and two for stability (change failure rate, time to restore service). The scorecard bands each one Elite, High, Medium or Low and tracks them quarter by quarter.",
    whenToUse: [
      "Quarterly engineering reviews, to see whether delivery is getting faster and safer.",
      "Before and after a big change, such as a new CI/CD pipeline, to check its effect.",
    ],
    steps: [
      "Pull the four numbers for the quarter from your deploy pipeline and incident records.",
      "Under Log a quarterly sample, enter the Quarter (e.g. 2026-Q2), Deploys / week, Lead time (hours from commit to production), Change-fail rate (%) and MTTR (hours to restore service).",
      "Note what changed that quarter, such as a new pipeline or a major incident, then click Add sample.",
      "Read the KPI cards for the latest band on each metric, and the Trend across quarters chart for direction.",
      "Pick the weakest metric and agree one improvement to try next quarter.",
    ],
    tips: [
      "Read all four together. Shipping faster while change failures climb isn't progress.",
      "Keep definitions the same every quarter (e.g. what counts as a failed change), or the trend means nothing.",
      "Compare a team with its own past, not with other teams.",
    ],
    scales: [
      {
        name: "Bands (deploys · lead time · change-fail rate · MTTR)",
        values: [
          { value: "Elite", meaning: "14+ a week · up to 1 day · up to 15% · within 1 hour" },
          { value: "High", meaning: "1+ a week · up to 1 week · up to 30% · within 1 day" },
          { value: "Medium", meaning: "about monthly · up to 1 month · up to 45% · within 1 week" },
          { value: "Low", meaning: "anything slower or worse" },
        ],
      },
    ],
  },
  {
    toolId: "slo-builder",
    summary:
      "A service level objective (SLO) is a reliability target for something users care about, measured by a service level indicator (SLI). The error budget is the downtime the target allows. This tool works out each budget and how much is left.",
    whenToUse: [
      "Agreeing with product how reliable a service needs to be.",
      "Deciding whether to keep shipping features or slow down and fix reliability.",
      "After incidents, to see how much of the budget they used.",
    ],
    steps: [
      "Under Define an SLO, enter a Name and an SLI description, e.g. “Successful HTTP 2xx responses to /checkout”.",
      "Set the Target (%) and Window (days), then click Add SLO. The budget is the window's minutes × (100% − target).",
      "Whenever the SLI misses its target, use Log a burn event: pick the SLO, the Date and the Error minutes, then click Log burn.",
      "Check the SLO snapshot for Budget, minutes consumed and % Remaining in the rolling window.",
      "Agree in advance what happens when a budget is at risk or burned, such as pausing risky releases until it recovers.",
    ],
    tips: [
      "Start with a target slightly below what you achieve today. 100% is never the right target.",
      "A few SLOs on what users notice beat dozens on internal metrics.",
      "Record the cause of big burns in the Incident Commander or a Blameless Post-Mortem.",
    ],
    scales: [
      {
        name: "Error budget over a 30-day window",
        values: [
          { value: "99%", meaning: "about 432 minutes (7.2 hours)" },
          { value: "99.9%", meaning: "about 43 minutes" },
          { value: "99.99%", meaning: "about 4 minutes" },
        ],
      },
      {
        name: "Budget status",
        values: [
          { value: "Healthy", meaning: "50% or more of the budget left" },
          { value: "At risk", meaning: "less than 50% left" },
          { value: "Budget burned", meaning: "nothing left" },
        ],
      },
    ],
  },
  {
    toolId: "incident-commander",
    summary:
      "Incident command gives a live incident a clear structure: one commander makes decisions, a scribe keeps the timeline, and stakeholders get regular updates. The tool tracks each incident from declaration to resolution.",
    whenToUse: [
      "As soon as something user-facing breaks and more than one person is responding.",
      "To practice incident response in a drill or game day.",
    ],
    steps: [
      "Under Declare an incident, enter a Title, pick a Severity using the Severity matrix, name the Commander and Scribe, and describe the user-visible symptom. Click Declare incident.",
      "Copy the Slack template or Email template from the incident card to announce it, and send updates on a steady rhythm.",
      "The scribe logs each key event, decision and status change in the Timeline with an Author.",
      "Click Mark mitigated once users are no longer affected, and Mark resolved once it's fixed. MTTR is measured to resolution.",
      "Afterwards, run a Blameless Post-Mortem for every SEV-1 and SEV-2.",
    ],
    tips: [
      "The commander coordinates and decides. They shouldn't also be the one typing fixes.",
      "Declare early. Lowering the severity later is cheap; a late declaration costs time.",
      "Log the timeline as you go. Rebuilding it afterwards is slow and error-prone.",
    ],
    scales: [
      {
        name: "Severity matrix",
        values: [
          { value: "SEV-1", meaning: "full team paged, 24/7 response, exec comms" },
          { value: "SEV-2", meaning: "on-call paged, response within 30 minutes" },
          { value: "SEV-3", meaning: "business-hours response, comms in #incidents" },
          { value: "SEV-4", meaning: "goes to the backlog for the next sprint" },
        ],
      },
    ],
  },
  {
    toolId: "post-mortem",
    summary:
      "A blameless post-mortem looks back at an incident to understand how it happened and what will stop it happening again. It focuses on systems and decisions, not on who made a mistake.",
    whenToUse: [
      "Within a few days of any significant incident, while memories are fresh.",
      "After a near miss that could easily have been worse.",
    ],
    steps: [
      "Under Create a post-mortem, enter a Title, the Incident date and a one-line description, then click Create post-mortem.",
      "Write the Summary: what happened and how users were affected, in plain language.",
      "Rebuild the Timeline, one entry per significant event. Entries are stamped when you add them, so put the real event time in the text.",
      "Add Contributing factors. Aim for at least two or three; a single root cause usually hides part of the story.",
      "Add Action items with an owner and due date, and move each through Open, In progress and Done.",
      "Move the status from Draft to In review to Published, and check Overdue actions at every review.",
    ],
    tips: [
      "Ask “how did this make sense at the time?” rather than “who did this?”",
      "A few actions that get done beat a long list. Track bigger ones in the Risk Register or Technical Debt Tracker.",
      "If you used the Incident Commander, copy its timeline across as your starting point.",
    ],
    timebox: "60–90 minutes for the review meeting",
  },
  {
    toolId: "oncall-roster",
    summary:
      "An on-call roster shows who is on call and when. Logging every page against the shift shows how heavy the load is and who is at risk of burnout.",
    whenToUse: [
      "Running any rotation where people get paged out of hours.",
      "When on-call feels heavy and you want numbers to rebalance it or cut noisy alerts.",
    ],
    steps: [
      "Under Add shift, enter the Person, Start date and End date for each rotation slot, with handover notes if useful.",
      "Set Expected pages per week as the team's agreed baseline load.",
      "Each time someone is paged, use Log a page: pick the Severity and note what fired. The page goes to the shift covering today.",
      "Read the Rotation calendar (burnout heatmap): each shift is colored by its page count.",
      "Each month, review Per-person paging stats and the Paging frequency by week chart, then rebalance shifts or fix noisy alerts.",
    ],
    tips: [
      "Log pages when they happen. The tool can only assign a page to the shift covering today.",
      "Note false positives in the page description. They're the cheapest pages to remove.",
      "Every alert should point to a runbook; the Runbook Maturity Scorer shows which need work.",
    ],
    scales: [
      {
        name: "Pages per shift",
        values: [
          { value: "Green (under 3)", meaning: "sustainable" },
          { value: "Amber (3–5)", meaning: "heavy; keep an eye on it" },
          { value: "Red (over 5)", meaning: "burnout risk; act now" },
        ],
      },
    ],
  },
  {
    toolId: "runbook-scorer",
    summary:
      "A runbook tells the on-call engineer how to diagnose and fix a known problem. The scorer rates each runbook on freshness, completeness and recent testing, and combines them into a hygiene score out of 5.",
    whenToUse: [
      "Before a new rotation starts or new people join on-call.",
      "After an incident where a runbook was missing, wrong or out of date.",
      "As a quarterly check on operational readiness.",
    ],
    steps: [
      "Under Add a runbook, enter its Name and Owner, then click Add runbook.",
      "In Per-runbook detail, set Freshness (does it match the system today?) and Completeness (does it cover diagnosis, fix and escalation?) from 1 to 5.",
      "Turn on Tested recently only if someone has followed it in a drill or a real incident.",
      "Set Last reviewed to the date of the check. Hygiene averages Freshness, Completeness and Tested (5 if yes, 1 if not).",
      "Sort the Runbooks table by Hygiene, fix the lowest first, and re-score after each review.",
    ],
    tips: [
      "An untested runbook often fails halfway through. A short drill finds the gaps.",
      "Give every runbook an owner, or it will go stale.",
      "Link runbooks from alerts so the on-call engineer finds them fast.",
    ],
    scales: [
      {
        name: "Hygiene (out of 5)",
        values: [
          { value: "4–5", meaning: "healthy" },
          { value: "3–4", meaning: "usable; review soon" },
          { value: "2–3", meaning: "needs work" },
          { value: "Below 2", meaning: "unreliable in an incident" },
        ],
      },
    ],
  },
  {
    toolId: "platform-maturity",
    summary:
      "A self-assessment of how well your internal platform helps developers ship. You score eight areas from 1 to 5, see them on a radar and get next steps for the weakest.",
    whenToUse: [
      "Planning a platform team's roadmap for the next quarter or half year.",
      "Checking whether platform work is reducing friction for product teams.",
    ],
    steps: [
      "Get platform engineers and a few product engineers together, so both views shape the scores.",
      "Score each dimension from 1 to 5: Golden paths, Internal Developer Platform, Runbook hygiene, On-call maturity, Self-service provisioning, Observability defaults, Deployment automation and Cognitive load reduction.",
      "Add a short note with the evidence for each score.",
      "Check the Maturity radar for the overall shape, then read the Improvement roadmap. It lists every dimension below 3 with what the next level looks like.",
      "Pick one or two dimensions to lift, click Save snapshot to log the assessment, and reassess each quarter.",
    ],
    tips: [
      "Score what most teams experience today, not the best case or the plan.",
      "Ask product teams. The platform team's own view is often more generous.",
      "Run the DevEx Survey to hear developers' view of the same friction.",
    ],
    scales: [
      {
        name: "Maturity level",
        values: [
          { value: "1", meaning: "ad hoc or missing" },
          { value: "2", meaning: "exists, but varies between teams" },
          { value: "3", meaning: "standard for most teams" },
          { value: "4", meaning: "owned, measured and widely adopted" },
          { value: "5", meaning: "the default; exceptions are rare and tracked" },
        ],
      },
    ],
    timebox: "60–90 minutes",
  },
  {
    toolId: "test-pyramid",
    summary:
      "The test pyramid says most automated tests should be fast unit tests, with fewer integration tests and only a few end-to-end (E2E) tests. Enter your counts to see your suite's shape and a relative cost estimate.",
    whenToUse: [
      "When the test suite is slow or flaky and you want to see why.",
      "Planning test-automation work, or checking progress after it.",
    ],
    steps: [
      "Count the tests in each layer from your test runner or CI report.",
      "Enter Unit tests, Integration tests and E2E tests, and add the repo and date in the description.",
      "Read the Pyramid shape. A healthy suite is widest at the bottom; an Inverted pyramid alert appears when E2E tests outnumber unit tests.",
      "Check % unit (aim for 60–80%) and % e2e (above 20% is flagged).",
      "Use the Cost-of-quality figure to compare over time. It weights each test by how slow and costly it is to run and maintain.",
      "Update the counts each quarter and note the date.",
    ],
    tips: [
      "Push checks down the pyramid: if an E2E test checks business logic, cover that logic with unit tests instead.",
      "Speed and reliability matter more than raw counts. Track unstable tests in the Flaky Test Scoreboard.",
    ],
    scales: [
      {
        name: "Relative cost per test",
        values: [
          { value: "Unit = 1", meaning: "fast, isolated, in-process" },
          { value: "Integration = 5", meaning: "several components or services together" },
          { value: "E2E = 25", meaning: "full stack, real browser or API" },
        ],
      },
    ],
  },
  {
    toolId: "flaky-tests",
    summary:
      "A flaky test passes and fails on the same code. The scoreboard logs each one with its failure rate, owner and status, so the team can triage, quarantine and fix them instead of re-running builds.",
    whenToUse: [
      "When people re-run CI “until it goes green”.",
      "To run a weekly flaky-test triage.",
    ],
    steps: [
      "Under Log a flaky test, enter the Test name, Suite, Owner, Failure rate (%) and what seems to trigger it, then click Add test.",
      "Take the failure rate from CI history, e.g. failed runs ÷ total runs over the last two weeks.",
      "Set each test's status: Active (still flaking in the main suite), Quarantined (pulled out of the blocking suite until fixed) or Fixed.",
      "Use the Top 10 flakiest tests chart to pick what to fix first. Red bars fail more than 20% of the time.",
      "Review the list weekly: confirm owners, fix or delete quarantined tests, and watch New flakies per week for a rising trend.",
    ],
    tips: [
      "Quarantine is a holding pen, not a fix. Give every quarantined test an owner and a deadline.",
      "Common causes are timing, shared state between tests and test order. Look there first.",
      "Many flaky E2E tests? Check the shape of your suite in the Test Pyramid Analyzer.",
    ],
  },
  {
    toolId: "code-review-metrics",
    summary:
      "Code review metrics show how pull requests (PRs) move through review: how long they take to merge, how big they are and how much discussion they get. Use them to spot slow or overloaded review, not to rate people.",
    whenToUse: [
      "When PRs wait days for review and work piles up.",
      "To check whether smaller PRs really merge faster for your team.",
    ],
    steps: [
      "Under Log PR sample, enter the PR #, Author, Opened at, Merged at, Reviewers, Comments and Lines changed, then click Add PR. Leave Merged at blank if the PR is still open.",
      "To load many at once, paste rows into Bulk import (CSV) using the columns shown and click Parse & import.",
      "Read the cards: Cycle median and Cycle P85 (hours from open to merge), Avg review depth (comments per PR) and Avg PR size.",
      "Use the PR size vs. cycle hours chart to see whether big PRs are the slow ones.",
      "Add PRs every week or sprint and watch the Weekly cycle-time mean chart for a trend.",
    ],
    tips: [
      "Look at P85, not just the median. The slow tail is where people wait.",
      "Very few comments on a very large PR often means rubber-stamping, not quality.",
      "Never use these numbers to rank individuals; people will game them.",
    ],
  },
  {
    toolId: "quality-cost",
    summary:
      "Cost of quality (COQ) adds up what you spend preventing and finding defects and what defects cost when they get through. It shows whether money goes into building quality in or into fixing failures.",
    whenToUse: [
      "Making the case for more investment in testing, reviews or training.",
      "Quarterly or yearly quality reviews with leadership.",
    ],
    steps: [
      "Pick one period, such as last quarter, and use it for all four numbers.",
      "Enter Prevention costs (training, code review, design) and Detection costs (testing, inspection, audits).",
      "Enter Internal failure costs (rework caught before release) and External failure costs (fixes after release, refunds, support, lost customers).",
      "Compare Conformance (prevention + detection) with Non-conformance (internal + external failure), and check the External / Internal ratio.",
      "Agree where to shift spending, usually from failure toward prevention, and recalculate next period.",
    ],
    tips: [
      "Rough estimates are fine. Hours × a blended hourly rate is enough to see the balance.",
      "An External / Internal ratio above 1 means more defects reach customers than you catch. Look at detection first.",
      "Quality textbooks call detection “appraisal”. It's the same category.",
    ],
  },
  {
    toolId: "threat-model",
    summary:
      "Threat modeling asks “what could go wrong?” for each service, using the six STRIDE categories. The registry keeps every threat with its severity, mitigation and status, so security gaps stay visible.",
    whenToUse: [
      "Designing a new service or a significant change, ideally before you build it.",
      "Before a security review, audit or penetration test.",
      "Revisiting existing services once or twice a year.",
    ],
    steps: [
      "Sketch how data flows through the service and where it crosses trust boundaries, such as user to API or API to database.",
      "Walk through STRIDE: Spoofing (faking an identity), Tampering (changing data), Repudiation (denying an action), Information Disclosure (leaking data), Denial of Service (making it unavailable), Elevation of Privilege (gaining rights you shouldn't have).",
      "Under New threat, enter the Service, STRIDE category, Severity and Mitigation, then click Add threat.",
      "Move each threat through Open, Mitigating and Mitigated, or Accepted when the team consciously decides to live with it.",
      "Check the STRIDE coverage matrix. A dash means no threats recorded for that category; make sure that's real, not a gap.",
    ],
    tips: [
      "For accepted threats, write the reason and who accepted them in the description.",
      "Put high-severity mitigations on the backlog, not just in a note.",
      "Run it with the developers who know the code, not only security staff.",
    ],
    scales: [
      {
        name: "Severity",
        values: [
          { value: "1–2", meaning: "low impact or hard to exploit" },
          { value: "3", meaning: "moderate" },
          { value: "4–5", meaning: "critical; shown in the Critical (4-5) card, fix first" },
        ],
      },
    ],
    timebox: "60–90 minutes per service",
  },
  {
    toolId: "vuln-burndown",
    summary:
      "A vulnerability burn-down tracks open security vulnerabilities by severity over time and checks each one against a fix deadline (SLA). It shows whether the backlog is shrinking and which items are overdue.",
    whenToUse: [
      "Working through findings from a scanner, penetration test or bug bounty.",
      "Reporting security posture to leadership or auditors.",
    ],
    steps: [
      "Under Log a vulnerability, enter the CVE (if any), Severity, SLA target (days), Owner and a description, then click Add vuln. The SLA fills in from the severity.",
      "Log each vulnerability on the day you find it, because its age counts from the day it's added.",
      "Move each through Open, In Progress and Resolved. Use Accepted only for risks the team has formally chosen to live with.",
      "Watch SLA breaches. The list puts breaching items first and shows each item's age against its SLA.",
      "Check the Open vulns over time chart weekly. The line should trend down.",
    ],
    tips: [
      "Prioritize by exposure as well as severity: an internet-facing High can matter more than an internal Critical.",
      "Review Accepted items regularly. The tool flags any that are older than twice their SLA.",
      "Repeated findings in one area may need a design fix; add them to the Threat Model Registry.",
    ],
    scales: [
      {
        name: "Default SLA",
        values: [
          { value: "Critical", meaning: "fix within 7 days" },
          { value: "High", meaning: "within 30 days" },
          { value: "Medium", meaning: "within 60 days" },
          { value: "Low", meaning: "within 90 days" },
        ],
      },
    ],
  },
  {
    toolId: "control-map",
    summary:
      "A compliance control map lists the controls your team runs, ties each to a framework requirement such as SOC 2 or ISO 27001, and collects evidence that it works. It shows how close you are to being ready for audit.",
    whenToUse: [
      "Preparing for a SOC 2, ISO 27001, HIPAA or GDPR audit.",
      "Keeping evidence current between audits, so there's no scramble at the end.",
    ],
    steps: [
      "Under New control, enter the Control ID (e.g. CC6.1 or A.9.4.2), Framework, Title, Owner and Initial status, then click Add control.",
      "Add evidence links to each control: policies, tickets, screenshots, logs or runbooks that show it working.",
      "Move the status from Not Started through In Progress to Implemented, then to Verified once someone has checked the evidence.",
      "Use the Compliance dashboard for progress per framework, and Open gaps for what's left.",
      "Review monthly: refresh stale evidence and follow up with owners of open gaps.",
    ],
    tips: [
      "Every control needs a named owner. Auditors will ask who runs it.",
      "Evidence should show the control working over time, not just a policy saying it should.",
      "This is a planning aid, not legal advice. Confirm scope with your auditor.",
    ],
    scales: [
      {
        name: "Status",
        values: [
          { value: "Not Started", meaning: "no control in place yet" },
          { value: "In Progress", meaning: "being built or rolled out" },
          { value: "Implemented", meaning: "in place, evidence not yet checked" },
          { value: "Verified", meaning: "evidence reviewed; ready for the auditor" },
        ],
      },
    ],
  },
  {
    toolId: "a11y-tracker",
    summary:
      "An accessibility audit tracker logs each barrier found against the Web Content Accessibility Guidelines (WCAG), by component and severity, and shows open issues burning down over time.",
    whenToUse: [
      "After an accessibility audit, automated scan or testing with disabled users.",
      "Working toward a WCAG AA target or a legal accessibility requirement.",
    ],
    steps: [
      "Under Log a11y issue, enter the Component, the WCAG criterion (e.g. 1.4.3 for contrast), the Severity and a description with repro steps, then click Add issue.",
      "Log one issue per failure per component, so each fix can be tracked on its own.",
      "Set the status to In Progress when work starts and Resolved once the fix is checked.",
      "Use Per-component coverage to find the components with the worst open issues. Fix shared components first.",
      "Check Open issues over time (by severity) weekly, and re-test fixes with a keyboard and a screen reader.",
    ],
    tips: [
      "Automated scanners catch only some problems. Test with a keyboard and a screen reader too.",
      "Fixing a shared component fixes every page that uses it.",
      "Add an accessibility check to your Definition of Done Builder so new issues stop appearing.",
    ],
    scales: [
      {
        name: "Severity",
        values: [
          { value: "Critical", meaning: "blocks some users completely" },
          { value: "Serious", meaning: "major barrier; the workaround is hard" },
          { value: "Moderate", meaning: "causes difficulty; a workaround exists" },
          { value: "Minor", meaning: "an annoyance" },
        ],
      },
    ],
  },
];
