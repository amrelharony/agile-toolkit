import type { ToolGuide } from "./types";

/** Guides for the "Outcomes & discovery" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "nps-csat",
    summary:
      "This tracker records Net Promoter Score (NPS) and Customer Satisfaction (CSAT) responses over time. NPS asks how likely someone is to recommend you; CSAT asks how satisfied they were with a specific experience.",
    whenToUse: [
      "Following customer sentiment across releases or service changes.",
      "Connecting survey comments to what the team builds next.",
    ],
    steps: [
      "Under Add response, choose NPS (0-10) or CSAT (1-5), set the date and score, and add the Respondent and Verbatim comment if you have them.",
      "Add every response, not just the notable ones, so the numbers stay honest.",
      "Read the cards. NPS is % promoters minus % detractors, from −100 to +100. CSAT is the average score out of 5.",
      "After each survey round, check the Score Trend chart. It plots NPS for each date on the left axis (−100 to +100) and the average CSAT for each date on the right axis (1 to 5).",
      "Read the verbatim comments for the reasons behind the scores, and review the trend monthly or after each release.",
    ],
    scales: [
      {
        name: "NPS (0–10)",
        values: [
          { value: "9–10", meaning: "promoter" },
          { value: "7–8", meaning: "passive (not counted in NPS)" },
          { value: "0–6", meaning: "detractor" },
        ],
      },
      {
        name: "CSAT (1–5)",
        values: [
          { value: "4–5", meaning: "satisfied" },
          { value: "3", meaning: "neutral" },
          { value: "1–2", meaning: "dissatisfied" },
        ],
      },
    ],
    tips: [
      "With few responses, one score can swing NPS a lot. Check the response count before reacting.",
      "Compare with your own past results; NPS benchmarks vary a lot between industries.",
      "Turn repeated complaints into testable bets in the Hypothesis Tracker.",
    ],
  },
  {
    toolId: "hypothesis-tracker",
    summary:
      "The Hypothesis Tracker turns product ideas into testable bets: what you believe, what you'll do and what you want to learn. Following each one to a result shows how often your bets hold up and how fast you learn.",
    whenToUse: [
      "Before building a feature whose value isn't proven yet.",
      "Discovery work where the team runs several experiments at once.",
    ],
    steps: [
      "Click New Hypothesis and fill in We believe, We will do and To learn.",
      "Add a Success metric with a clear threshold and time frame, and describe the Experiment design.",
      "Set the status to Running when the experiment starts.",
      "When results are in, set Validated, Invalidated or Inconclusive, then write the Outcome: what you learned and what you'll do next.",
      "Review open hypotheses weekly, and check Validation Rate and Median Time to Learn every month or quarter.",
    ],
    tips: [
      "Set the success metric before the experiment starts so nobody moves the goalposts.",
      "An invalidated hypothesis is a good result if it stopped you building the wrong thing.",
      "Not sure what to test first? Rank your assumptions in the Riskiest Assumption Canvas.",
    ],
  },
  {
    toolId: "user-interviews",
    summary:
      "The User Interview Log stores quotes from user interviews and tags them by theme. As interviews add up, Theme Frequency shows which topics come up most often.",
    whenToUse: [
      "During a round of discovery or usability interviews.",
      "Pulling findings from several interviews together before a product decision.",
    ],
    steps: [
      "Click New Interview and enter the participant (a pseudonym is fine), the date and the Context: their role, how they use the product and what you were exploring.",
      "Click Add Quote for each notable thing they said, in their own words.",
      "Tag each quote with short, comma-separated themes, such as onboarding or pricing. Reuse the same tags across interviews.",
      "After each interview, or weekly during a research round, check Theme Frequency for themes that keep coming up.",
      "Leave Anonymize on export switched on when you share the data.",
    ],
    tips: [
      "Write down what people actually said and did, not your interpretation of it.",
      "Remove names, employers and other personal details before saving; the data is stored unencrypted.",
      "Turn strong themes into opportunities in the Opportunity Solution Tree.",
    ],
  },
  {
    toolId: "opportunity-tree",
    summary:
      "An Opportunity Solution Tree (from Teresa Torres) links an outcome to the customer opportunities behind it, the solutions that could address them and the experiments that test those solutions. It keeps discovery tied to a goal.",
    whenToUse: [
      "Ongoing product discovery, alongside regular customer interviews.",
      "When the team jumps to solutions before agreeing on the problem.",
    ],
    steps: [
      "Click Add Outcome and write a measurable result you want to drive, such as “increase weekly active users by 10%”.",
      "Under the outcome, add opportunities: needs, pain points or desires you heard from customers. Note the Evidence for each.",
      "Under each opportunity, add several possible solutions so you can compare them.",
      "Under a solution, add experiments that test whether it will work, and record the Evidence they produce.",
      "Update the tree weekly as interviews and results come in, and remove branches that turn out to be dead ends.",
    ],
    tips: [
      "Phrase opportunities from the customer's view (“I can't tell if my order shipped”), not as features.",
      "Compare at least three solutions for an opportunity before picking one.",
      "Feed opportunities from the User Interview Log and track experiments in the Hypothesis Tracker.",
    ],
  },
  {
    toolId: "riskiest-assumption",
    summary:
      "The Riskiest Assumption Canvas lists the assumptions behind a plan and ranks them by how risky and how unproven they are, so you test the most dangerous ones before you invest in building.",
    whenToUse: [
      "Before starting a new product, feature or initiative.",
      "When a plan rests on beliefs about users, pricing or technology that nobody has checked.",
    ],
    steps: [
      "Write each assumption as a statement that could be proven wrong, such as “Users will pay $20/mo for the premium tier”. Add a Test idea if you have one.",
      "Rate Risk and Evidence from 1 to 5 using the scales below.",
      "Check the ranked list. Score = risk × (6 − evidence), so risky, unproven assumptions rise to the top and land in Test first.",
      "Click Generate test card on the top item. Use it to agree the cheapest test and the metric and threshold that would prove it wrong.",
      "Set the status to Testing, then Validated or Invalidated, and raise Evidence as you learn.",
    ],
    scales: [
      {
        name: "Risk",
        values: [
          { value: "1", meaning: "little harm if this is wrong" },
          { value: "5", meaning: "the plan fails if this is wrong" },
        ],
      },
      {
        name: "Evidence",
        values: [
          { value: "1", meaning: "a guess, no data yet" },
          { value: "5", meaning: "strong data from real users" },
        ],
      },
    ],
    tips: [
      "In the matrix, Risk 3 or more counts as high and Evidence 3 or less as low, so a pair of 3s lands in Test first.",
      "Track each test in the Hypothesis Tracker.",
      "An invalidated assumption is useful: change the plan, then re-rate the others.",
    ],
    timebox: "45–60 minutes for a first pass",
  },
  {
    toolId: "wardley-map",
    summary:
      "A Wardley Map (from Simon Wardley) plots the components needed to meet a user need: how visible each one is to the user, and how evolved it is, from Genesis to Commodity. It helps you decide what to build, buy or outsource.",
    whenToUse: [
      "Strategy or architecture discussions about where to invest.",
      "Build-versus-buy decisions.",
    ],
    steps: [
      "Start with the user need. Add it as a component with Visibility close to 1.",
      "Add the components that meet that need and the ones they depend on, with lower Visibility the further they are from the user.",
      "Set each component's Evolution from 0 to 1 by how mature and widely available it is in the market.",
      "Use Add link to connect each component to the ones it depends on, so the value chain shows on the map.",
      "Discuss the map: build what sets you apart in Genesis or Custom, and buy or rent what's already Product or Commodity.",
    ],
    scales: [
      {
        name: "Evolution",
        values: [
          { value: "Genesis (0–0.24)", meaning: "new, uncertain and poorly understood" },
          { value: "Custom (0.25–0.49)", meaning: "built for a specific need, still changing" },
          {
            value: "Product (0.50–0.74)",
            meaning: "offered by several suppliers, becoming standard",
          },
          { value: "Commodity (0.75–1)", meaning: "standard, cheap and widely available" },
        ],
      },
    ],
    tips: [
      "Place components by how evolved they are in the market, not inside your company.",
      "Components drift right over time. Revisit the map each quarter and update the evo values.",
      "Record the decisions you take from the map in the Decision Log (ADR).",
    ],
    timebox: "60–90 minutes for a first map",
  },
];
