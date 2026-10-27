import type { ToolGuide } from "./types";

/** Guides for the "Outcomes & discovery" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "nps-csat",
    summary:
      "Collect Net Promoter Score (NPS) and Customer Satisfaction (CSAT) answers, import survey exports, and read the scores per week or month with the number of answers behind each.",
    whenToUse: [
      "Following customer sentiment across releases or service changes.",
      "Connecting survey comments to what the team builds next.",
    ],
    steps: [
      "Under Add a response, pick the Survey (NPS 0–10 or CSAT 1–5) and the Score the customer gave, check the Day, and add the Respondent, Tags and Verbatim if you have them. Press Add response.",
      "Or press Import CSV: choose a file or paste rows, header row first (date and score; kind, respondent, verbatim and tags are optional). With no kind column, pick NPS or CSAT for the whole file, check the preview, then press Import.",
      "Read the cards: NPS and CSAT satisfied for the latest month (or week) with at least 10 answers, all-time in the small print.",
      "In Score trend, switch Group by between Month and Week. A hollow dot or a warning means fewer than 10 answers, where one answer moves the score a lot.",
      "Press a tag under Themes to filter everything to it; the table shows which themes collect the unhappy answers.",
      "Edit or delete a response in the list (Undo in the toast); Clear all asks first and can be undone.",
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
      "Re-importing the same file adds nothing: answers already saved are skipped and listed.",
      "Compare with your own past results; NPS benchmarks vary a lot between industries.",
      "Turn the most complained-about theme into a testable bet in the Hypothesis Tracker.",
    ],
  },
  {
    toolId: "hypothesis-tracker",
    summary:
      "The Hypothesis Tracker frames product bets as testable hypotheses (we believe, we will, to learn, success looks like) with an optional numeric target. A measured result suggests a verdict you apply, and the validation rate counts only decisive results.",
    whenToUse: [
      "Before building a feature whose value isn't proven yet.",
      "Discovery work where the team runs several experiments at once.",
    ],
    steps: [
      "Click New hypothesis and fill We believe, We will, To learn and Success looks like; Add hypothesis saves it (Enter works too). Move Raised on back if the test started earlier.",
      "Optionally set a Numeric target: The number should Rise to at least or Fall to at most a Target, with a Unit and the Baseline where it stands now.",
      "Set the Status on the card as the test runs. A hypothesis sent from another tool (Riskiest Assumption, the Opportunity Tree, Cynefin) arrives Drafted, often with Needs detail: use Edit or Add the detail to fill what you'll do and the success metric before it can run.",
      "When the result is in, type it in Measured result. The card says whether the target was met and offers Mark validated or Mark invalidated; nothing changes until you click it. Set Result on to the day the test ended and note What we learned.",
      "Use Show to filter by Open, a result or Needs detail. Validation rate is validated ÷ (validated + invalidated); Advanced analysis shows how long tests take once five have a result.",
    ],
    tips: [
      "Set the success metric before the experiment starts so nobody moves the goalposts.",
      "Inconclusive results don't count either way in the validation rate; it reads “—” until a test is validated or invalidated.",
      "Deleting a hypothesis offers Undo, and the item that sent it links to it again. Its From … link goes back to that item.",
    ],
  },
  {
    toolId: "user-interviews",
    summary:
      "The User Interview Log stores quotes from user interviews, tagged by theme. Themes count the participants who raised them, not the quotes, so one talkative person doesn't outweigh four quiet ones.",
    whenToUse: [
      "During a round of discovery or usability interviews.",
      "Pulling findings from several interviews together before a product decision.",
    ],
    steps: [
      "Click New interview and enter the Participant (a pseudonym is fine), the day it took place (Interviewed on) and the Context; Add interview saves it and opens it.",
      "In the interview, type a quote under New quote and its Tags (comma-separated, such as onboarding, pricing), then press Enter or Add quote. Edit or delete a quote from its card.",
      "Check Themes: each reads “pricing · 3 of 5 people”. Click a theme to see the quotes behind it across interviews, and Open the interview from there.",
      "On a quote that matters, click Raise as an opportunity, pick where it goes in Put it under (an outcome or an opportunity on the tree) and press Add to the tree.",
      "Leave Anonymise on when you export or use the AI prompt: participants become Participant 1, 2… and emails, phone numbers and their names are taken out of the context and quotes.",
    ],
    tips: [
      "Write down what people actually said, not your interpretation of it.",
      "Reuse the same tags across interviews so themes add up.",
      "With fewer than three participants, the summary calls the top theme a hunch.",
    ],
  },
  {
    toolId: "opportunity-tree",
    summary:
      "An Opportunity Solution Tree (from Teresa Torres) links an outcome to the customer opportunities behind it, the solutions that could address them and the experiments that test those solutions. Pick one target opportunity per outcome and test experiments as hypotheses.",
    whenToUse: [
      "Ongoing product discovery, alongside regular customer interviews.",
      "When the team jumps to solutions before agreeing on the problem.",
    ],
    steps: [
      "Click Add outcome and write a measurable result you want to move, such as “increase weekly active users by 10%”.",
      "On the outcome, click Add opportunity for each need or pain you heard; on an opportunity, Add sub-opportunity splits it and Add solution adds an idea to address it. Note the Evidence.",
      "Mark the opportunity you'll pursue with Target: one per outcome, so a second Target replaces the first.",
      "Under a solution, Add experiment, then click Test as a hypothesis to send it to the Hypothesis Tracker; the experiment then shows whether it is being tested or what the test found.",
      "Use Edit to rename a node. Deleting a node with anything under it asks first, and Undo brings the whole branch back.",
    ],
    tips: [
      "Phrase opportunities from the customer's view (“I can't tell if my order shipped”), not as features.",
      "Compare at least three solutions for an opportunity before picking one.",
      "Quotes raised from the User Interview Log arrive as opportunities with a From user interviews link.",
    ],
  },
  {
    toolId: "riskiest-assumption",
    summary:
      "The Riskiest Assumption Canvas lists the beliefs behind a plan, ranks them by risk × (6 − evidence) and tests the riskiest, least-proven one first as a hypothesis.",
    whenToUse: [
      "Before starting a new product, feature or initiative.",
      "When a plan rests on beliefs about users, pricing or technology that nobody has checked.",
    ],
    steps: [
      "Under Add an assumption, write a statement that could be proven wrong, such as “Users will pay $20/mo for the premium tier”, and a Test idea if you have one. Pick Risk and Evidence from 1 to 5, or leave them blank and it waits under Not rated. Click Add assumption.",
      "Rate or re-rate on each card. The Ranked list holds still while you do, and Re-sort puts it back in order. The matrix places rated assumptions only.",
      "On the top assumption click Test: it becomes a hypothesis in the Hypothesis Tracker, where you add the success metric and run it.",
      "When its hypothesis is validated or invalidated, the assumption moves to Tested and offers Mark validated or Mark invalidated; an inconclusive test keeps it ranked to test again.",
      "Change the Status on a card yourself at any time. Edit changes the words, and delete offers Undo.",
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
      "An unrated assumption is never ranked, so nothing lands in Test first by a default.",
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
