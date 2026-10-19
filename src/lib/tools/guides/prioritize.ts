import type { ToolGuide } from "./types";

/** Guides for the "Prioritize & decide" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "prioritizer",
    summary:
      "The Backlog Prioritizer scores one list of items four ways: MoSCoW, WSJF, RICE and Value vs. Effort. You see where the frameworks agree and where they don't.",
    whenToUse: [
      "Ordering a backlog when you want to compare several methods side by side.",
      "When stakeholders favor different frameworks and you want one shared set of inputs.",
    ],
    steps: [
      "Click Add Item for each backlog item and give it a name and an optional description.",
      "Pick its MoSCoW bucket, then score Value and Effort from 1 to 10. Value also counts as the WSJF business value.",
      "Fill in the WSJF inputs (Time Crit, Risk Red, Job Size, each 1–10) and the RICE inputs (Reach, Impact, Conf %, and RICE Eff in person-months).",
      "Open the MoSCoW, WSJF, RICE and Value vs Effort tabs to see the items grouped, ranked and plotted.",
      "Talk through items that rank high in one tab and low in another before you settle the order.",
    ],
    scales: [
      {
        name: "RICE Impact",
        values: [
          { value: "3 / 2", meaning: "massive / high" },
          { value: "1", meaning: "medium" },
          { value: "0.5 / 0.25", meaning: "low / minimal" },
        ],
      },
      {
        name: "Value vs Effort quadrants",
        values: [
          { value: "Quick Wins", meaning: "value above 5, effort 5 or less" },
          { value: "Major Projects", meaning: "value above 5, effort above 5" },
          { value: "Fill-ins", meaning: "value 5 or less, effort 5 or less" },
          { value: "Time Sinks", meaning: "value 5 or less, effort above 5" },
        ],
      },
    ],
    tips: [
      "Score one column at a time across all items. Relative scores are more honest than absolute ones.",
      "The frameworks feed a conversation, not a verdict. Agree up front which one breaks ties.",
      "To go deeper on one method, use the WSJF Calculator or the RICE Scoring Calculator.",
    ],
  },
  {
    toolId: "moscow",
    summary:
      "MoSCoW sorts scope into Must have, Should have, Could have and Won't have (this time), so everyone agrees what's in a release and what's out.",
    whenToUse: [
      "Agreeing the scope of a release, MVP or fixed-date project.",
      "When stakeholders treat everything as top priority.",
    ],
    steps: [
      "Agree the release or timebox you're scoping. MoSCoW only works against a deadline.",
      "Type each scope item, pick its bucket and click Add.",
      "Challenge every Must have: would the release fail without it? If not, move it down with its bucket menu.",
      "Check that the Musts fit well within capacity, leaving room for Shoulds and Coulds.",
      "Keep Won't have items on the board so leaving them out is an explicit decision, and revisit them next release.",
    ],
    scales: [
      {
        name: "Buckets",
        values: [
          { value: "Must have", meaning: "without it the release fails, is unsafe or not allowed" },
          { value: "Should have", meaning: "important, but there's a workaround" },
          { value: "Could have", meaning: "nice to have; first to drop if time runs short" },
          { value: "Won't have (this time)", meaning: "agreed out of scope for now" },
        ],
      },
    ],
    tips: [
      "A common rule of thumb: Musts take no more than about 60% of the effort, so Coulds can absorb surprises.",
      "Won't have means not this time, not never.",
      "To order items inside a bucket, score them in the WSJF Calculator or RICE Scoring Calculator.",
    ],
  },
  {
    toolId: "ice-score",
    summary:
      "ICE scores an idea by Impact × Confidence × Ease, each from 1 to 10. It's a quick way to rank growth experiments and small bets without a long analysis.",
    whenToUse: [
      "Choosing which growth or product experiments to run next.",
      "Triaging a long list of small ideas where RICE would be overkill.",
    ],
    steps: [
      "Type the idea's Title.",
      "Score Impact: how much it would move your goal if it works.",
      "Score Confidence: how much evidence you have that it will work.",
      "Score Ease: how quickly and cheaply you can try it. Then click Add & score.",
      "The list sorts by Score (up to 1,000). Run the top few, then re-score with what you learned.",
    ],
    scales: [
      {
        name: "Impact, Confidence and Ease",
        values: [
          { value: "1–3", meaning: "small effect, little evidence or hard to do" },
          { value: "4–7", meaning: "moderate" },
          { value: "8–10", meaning: "big effect, strong evidence or easy to do" },
        ],
      },
    ],
    tips: [
      "Agree what 1, 5 and 10 mean for your goal before scoring, or scores drift between people.",
      "Keep Confidence honest: an untested opinion is a 2 or 3, not an 8.",
      "All three scores are required. To re-score an idea, remove it and add it again.",
    ],
  },
  {
    toolId: "value-effort-matrix",
    summary:
      "A Value vs Effort matrix plots each item by the value it brings and the work it takes, sorting items into Quick Wins, Big Bets, Fill-Ins and Time Wasters.",
    whenToUse: [
      "Sorting a list of ideas or backlog items quickly in a workshop.",
      "Finding cheap, valuable work to start with.",
    ],
    steps: [
      "Type an Item title, score Value and Effort from 1 to 10, and click Plot.",
      "Score each item against the others, not in absolute terms.",
      "Read the Matrix: Value runs up, Effort runs across, and both split at 5.",
      "Start with Quick Wins, plan Big Bets deliberately, fit Fill-Ins into slack time and drop Time Wasters.",
    ],
    scales: [
      {
        name: "Quadrants",
        values: [
          { value: "Quick Wins", meaning: "value 5 or more, effort below 5" },
          { value: "Big Bets", meaning: "value 5 or more, effort 5 or more" },
          { value: "Fill-Ins", meaning: "value below 5, effort below 5" },
          { value: "Time Wasters", meaning: "value below 5, effort 5 or more" },
        ],
      },
    ],
    tips: [
      "Estimate effort with the people who will do the work.",
      "Lots of Big Bets? Split them; smaller pieces often turn into Quick Wins.",
      "Items can't be edited once plotted. Remove and re-plot them when estimates change.",
    ],
  },
  {
    toolId: "kano-model",
    summary:
      "The Kano model sorts features by how customers react to them: some are expected, some satisfy more the more you do, and some delight. It helps you balance the basics against what sets you apart.",
    whenToUse: [
      "Planning a release or roadmap and weighing basics against differentiators.",
      "After customer interviews or a Kano survey, to record what you learned.",
    ],
    steps: [
      "Type the Feature title.",
      "Find out how customers would feel if the feature were present, and if it were absent. A Kano survey asks both questions for each feature.",
      "Pick the Kano category that matches their answers.",
      "Optionally record Sat if present and Dissat if absent (0–5); they're kept with the feature and in the export. Click Add.",
      "Review the Categories: cover every Must-be first, invest in Performance and add a few Attractive features.",
    ],
    scales: [
      {
        name: "Kano categories",
        values: [
          { value: "Must-be", meaning: "expected; missing it causes dissatisfaction" },
          { value: "Performance", meaning: "the more you do, the happier customers are" },
          { value: "Attractive", meaning: "delights when present; not missed when absent" },
          { value: "Indifferent", meaning: "customers don't care either way" },
          { value: "Reverse", meaning: "some customers are put off when it's present" },
        ],
      },
    ],
    tips: [
      "Ask real customers. Team guesses tend to label too much as Attractive.",
      "Attractive features become Must-be over time as customers get used to them. Re-check every year or so.",
      "Keep interview notes in the User Interview Log.",
    ],
  },
  {
    toolId: "cost-of-delay",
    summary:
      "Cost of delay is the value you lose for each week an initiative isn't delivered. Putting a dollar figure on it makes waiting visible and helps you order work by its economic impact.",
    whenToUse: [
      "Making the case for doing one initiative before another.",
      "When work waits in queues and nobody sees what the wait costs.",
    ],
    steps: [
      "Type the Initiative.",
      "Estimate Cost per week ($): the revenue, savings or avoided risk you lose for each week it isn't live.",
      "Enter Weeks delayed: how long it will wait, or has waited, before delivery. Then click Add.",
      "Total = cost per week × weeks delayed. The Total CoD this period figure adds up all items.",
      "Use the Top 10 by total cost chart and the Items table to see where waiting hurts most. Update estimates as plans change.",
    ],
    tips: [
      "A rough range beats no number. Write down your assumptions so others can challenge them.",
      "To order work, divide cost per week by how long the work takes (CD3). The WSJF Calculator does a relative version of this.",
      "Some costs jump on a date, such as a regulation or a season. Note those deadlines next to the weekly figure.",
    ],
  },
  {
    toolId: "buy-a-feature",
    summary:
      "Buy-a-Feature is an innovation game: players get a limited budget of play money to spend on priced features. No one can afford everything, so they negotiate, and that shows what they value most.",
    whenToUse: [
      "Prioritizing with customers or stakeholders who all want different things.",
      "When ranking exercises keep ending in “everything is important”.",
    ],
    steps: [
      "Add each feature with a Price that reflects its rough cost, for example its size in weeks.",
      "Give each player a budget so the whole group can afford only about half of the total price. The tool doesn't track player budgets, so note them separately.",
      "Players discuss and pool money. Enter each purchase in the amount box on the feature and click Buy.",
      "Watch the Marketplace progress bars. A feature at 100% is funded.",
      "Ask buyers why they chose what they did. The reasons matter as much as the result.",
    ],
    tips: [
      "Price some features above any single player's budget, so people have to pool money.",
      "Purchases can't be undone, so check the amount before clicking Buy.",
      "For a quick vote by one person or group, use the $100 Test instead.",
    ],
    timebox: "45–90 minutes",
  },
  {
    toolId: "hundred-dollar-test",
    summary:
      "In the $100 Test (cumulative voting) you split $100 across competing items. Giving more to one item means giving less to another, so it shows how strongly you prefer each item, not just the order.",
    whenToUse: [
      "Comparing a short list of options, roughly 3 to 10, with stakeholders.",
      "When a simple ranking hides how much more one item matters than another.",
    ],
    steps: [
      "Add each Item to vote on.",
      "Type a dollar amount next to each item. The total can't go above $100.",
      "Keep going until Remaining shows $0. A banner warns you while money is left.",
      "The list sorts by amount. Discuss the big gaps and any item that got nothing.",
      "The tool holds one $100 budget. With a group, agree the split together, or run one round per person, export each and add them up.",
    ],
    tips: [
      "To move money between items, lower one first. An amount is capped at what's still unallocated, and a note under the item says so.",
      "Watch for people putting everything on their favorite, and ask why.",
      "For a long list, shortlist first with the MoSCoW Matrix.",
    ],
  },
  {
    toolId: "eisenhower",
    summary:
      "The Eisenhower Matrix sorts tasks by whether they're urgent and whether they're important. That gives four actions: Do, Schedule, Delegate or Delete.",
    whenToUse: [
      "Planning your own or the team's week when there's more to do than time.",
      "Clearing a pile of requests and interruptions.",
    ],
    steps: [
      "Type a Task.",
      "Ask two questions: is it important (does it move our goals)? Is it urgent (will waiting cause harm soon)?",
      "Pick the matching quadrant and click Add.",
      "Do the Do tasks now, put Schedule tasks in the calendar, hand Delegate tasks to someone better placed, and drop Delete tasks.",
      "Review weekly and move tasks with their quadrant menu as things change.",
    ],
    scales: [
      {
        name: "Quadrants",
        values: [
          { value: "Do", meaning: "urgent and important" },
          { value: "Schedule", meaning: "important, not urgent" },
          { value: "Delegate", meaning: "urgent, not important" },
          { value: "Delete", meaning: "neither" },
        ],
      },
    ],
    tips: [
      "Real progress mostly lives in Schedule. Protect time for it before it turns urgent.",
      "Many interruptions feel urgent but don't matter. Urgent isn't the same as important.",
      "Delegating means agreeing the hand-off with someone, not dumping work on them.",
    ],
  },
  {
    toolId: "decision-log",
    summary:
      "A decision log keeps Architecture Decision Records (ADRs): short notes on what was decided, why, and with what trade-offs. Future team members can read the reasoning instead of guessing it.",
    whenToUse: [
      "Decisions that are costly to reverse: architecture, tools, data or key product rules.",
      "When the team keeps reopening the same debate, or new joiners ask why things are the way they are.",
    ],
    steps: [
      "Click New ADR and give it a numbered Title, such as “ADR-0001: Use Postgres for event log”.",
      "Write the Context (problem and constraints), the Decision (“We will…”) and the Consequences (what gets easier or harder).",
      "List the Alternatives considered, one per line, with why each was rejected.",
      "Set the Status to proposed while it's discussed and accepted once agreed.",
      "Don't rewrite old ADRs. When a decision changes, add a new one and mark the old one deprecated or superseded.",
    ],
    scales: [
      {
        name: "Status",
        values: [
          { value: "proposed", meaning: "under discussion" },
          { value: "accepted", meaning: "agreed and in force" },
          { value: "deprecated", meaning: "no longer applies" },
          { value: "superseded", meaning: "replaced by a newer ADR" },
        ],
      },
    ],
    tips: [
      "Write the ADR when you decide, while the reasons are fresh. A few short paragraphs is enough.",
      "Review accepted ADRs every quarter or so and mark the ones that no longer hold.",
      "Run bigger proposals through the RFC Tracker first, then push the outcome here.",
    ],
  },
  {
    toolId: "daci",
    summary:
      "DACI gives each decision clear roles: one Driver who runs the process, one Approver who makes the call, Contributors who give input and Informed people who hear the outcome. Clear roles stop decisions stalling or being reopened.",
    whenToUse: [
      "Cross-team decisions where it's unclear who has the final say.",
      "When decisions drag on or get reversed after the fact.",
    ],
    steps: [
      "Under Draft new decision, enter a Decision title and the Context: why are we deciding this?",
      "Name one Driver and one Approver, then list the Contributors and Informed people, separated by commas.",
      "Add the Options considered (one per line) and the Driver's Recommendation, then click Add decision.",
      "When the Approver decides, click the tick to mark it decided.",
      "Set the status to implemented once it's done, or revisit if new facts appear.",
    ],
    tips: [
      "Exactly one Approver. If two people must both say yes, the decision isn't set up yet.",
      "Tell the Informed group as soon as it's decided. Surprises are what reopen decisions.",
      "Record the final call and its reasons in the Decision Log (ADR).",
    ],
  },
  {
    toolId: "rapid-decision",
    summary:
      "RAPID, from Bain & Company, assigns five decision roles: Recommend, Agree, Perform, Input and Decide. It makes clear who proposes, who can block, who advises, who has the final say and who carries it out.",
    whenToUse: [
      "Decisions that need sign-off from legal, compliance, finance or another function.",
      "Large organizations where many people assume they have a veto.",
    ],
    steps: [
      "Enter a Decision title and Context.",
      "Name the Recommend (R) owner, who gathers input and writes the proposal, and the one Decide (D) person with the final say.",
      "List the Agree (A), Perform (P) and Input (I) people, separated by commas, and click Add.",
      "The Recommender consults Input, gets Agree sign-off, then the Decider makes the call. Click the tick to mark it decided.",
      "Set the status to implemented once the Perform people have delivered it.",
    ],
    tips: [
      "Keep Agree for people with a real veto, such as legal or compliance. Every extra name slows the decision.",
      "Input is advice, not a vote. The Decider weighs it but isn't bound by it.",
      "For lighter decisions, the DACI Decision Doc is simpler.",
    ],
  },
  {
    toolId: "weighted-decision",
    summary:
      "A weighted decision matrix scores each option against the criteria that matter, with important criteria weighted higher. The totals turn a gut feeling into a choice you can explain.",
    whenToUse: [
      "Choosing between a few similar options, such as vendors, tools or designs.",
      "When a group needs to show how it reached a choice.",
    ],
    steps: [
      "Agree the criteria before discussing options. Add each with a weight. Weights are relative: a weight of 2 counts twice as much as 1, and each criterion shows its share of the total.",
      "Add each option.",
      "In the Scoring matrix, score every option against each criterion from 1 (poor) to 10 (excellent). A cell left empty counts as not scored.",
      "Total = the sum of score × weight. The top option is starred and the Total score chart shows the gaps.",
      "If the top two are close, treat it as a tie and discuss what the numbers miss.",
    ],
    tips: [
      "Define what a low and a high score mean for each criterion before scoring.",
      "Score one criterion across all options at a time to keep scores consistent.",
      "If the result feels wrong, a criterion is probably missing. Name it before overriding the numbers.",
    ],
  },
  {
    toolId: "six-hats",
    summary:
      "Six Thinking Hats (Edward de Bono) has a group look at a problem from one angle at a time, together: facts, feelings, risks, benefits, new ideas and process. It avoids debates where one side attacks and the other defends.",
    whenToUse: [
      "Discussing a proposal where people keep talking past each other.",
      "Workshops that need both critical and creative thinking without one drowning out the other.",
    ],
    steps: [
      "Start with the Blue hat: state the question and agree the order of the hats.",
      "Everyone wears the same hat at the same time. Pick it in the Hat menu and Log each thought.",
      "Work through the White, Red, Black, Yellow and Green hats in the agreed order, a few minutes each.",
      "Finish with the Blue hat: summarize what came up and agree next steps.",
      "Review the thoughts grouped by hat, and export them for the record.",
    ],
    tips: [
      "Keep the Red hat short: gut reactions, with no need to justify them.",
      "Don't open with the Black hat, or new ideas die early.",
      "Use the Ceremony Timer to timebox each hat.",
    ],
    timebox: "30–60 minutes",
  },
  {
    toolId: "cynefin",
    summary:
      "Cynefin (Dave Snowden) helps you work out what kind of situation you're in before deciding how to act. Each domain calls for a different way of deciding.",
    whenToUse: [
      "Before choosing whether to plan, analyze or experiment your way through a problem.",
      "When the team disagrees on whether something needs a detailed plan or a quick experiment.",
    ],
    steps: [
      "Type the Problem / decision.",
      "Ask how cause and effect work: obvious to anyone (Clear), knowable with expert analysis (Complicated), only clear in hindsight (Complex), or not visible at all (Chaotic).",
      "Pick the Cynefin domain, write your Rationale and click Classify. The recipe for that domain shows next to the menu.",
      "If you can't agree, choose Confused and break the problem into parts you can classify.",
      "Reclassify items with their domain menu as you learn more. Situations move between domains.",
    ],
    scales: [
      {
        name: "Domains",
        values: [
          { value: "Clear", meaning: "sense, categorize, respond: apply best practice" },
          { value: "Complicated", meaning: "sense, analyze, respond: bring in experts" },
          { value: "Complex", meaning: "probe, sense, respond: run safe-to-fail experiments" },
          { value: "Chaotic", meaning: "act, sense, respond: stabilize first, then learn" },
          { value: "Confused", meaning: "not yet known: split the problem into smaller parts" },
        ],
      },
    ],
    tips: [
      "The most common mistake is treating a Complex problem as Complicated and analyzing instead of experimenting.",
      "Most product work is Complex. Track your experiments in the Hypothesis Tracker.",
    ],
  },
  {
    toolId: "stacey-matrix",
    summary:
      "The Stacey Matrix places work on two axes: how much people agree on what is needed, and how certain you are about how to do it. Where it lands suggests whether to plan, analyze, iterate or stabilize first.",
    whenToUse: [
      "Deciding whether work suits a fixed plan or short iterations.",
      "Explaining to stakeholders why some work can't be planned in detail up front.",
    ],
    steps: [
      "Type the Item / problem.",
      "Score Agreement from 0 to 1: how much do stakeholders agree on what is needed? 1 is full agreement.",
      "Score Certainty from 0 to 1: how sure are you about how to build it? 1 means it's been done many times.",
      "Click Plot. The item appears on the Matrix and in its region list.",
      "Choose an approach for each region, and re-plot items as agreement and certainty change.",
    ],
    scales: [
      {
        name: "Regions",
        values: [
          { value: "Simple", meaning: "both 0.66 or more: plan and follow best practice" },
          {
            value: "Complicated",
            meaning: "one axis 0.66 or more, the other below 0.33: analyze or negotiate",
          },
          { value: "Complex", meaning: "everything in between: work in short, iterative cycles" },
          { value: "Chaotic", meaning: "both 0.33 or less: act to stabilize, then reassess" },
        ],
      },
    ],
    tips: [
      "Score with the people involved. One person's view hides disagreement.",
      "Most software work lands in Complex, which is why short iterations and feedback pay off.",
      "For another angle on the same question, try the Cynefin Decision Picker.",
    ],
  },
  {
    toolId: "ooda-loop",
    summary:
      "The OODA loop (John Boyd) is a fast cycle of Observe, Orient, Decide and Act. Teams that cycle faster than the situation changes keep the initiative instead of reacting late.",
    whenToUse: [
      "Fast-moving situations such as a competitor move or a launch going wrong.",
      "When a team keeps acting on stale information.",
    ],
    steps: [
      "Type the Topic / situation and click Start to open a cycle.",
      "Observe: write down what's happening, the facts and signals.",
      "Orient: what does it mean? Note the context, your assumptions and possible biases.",
      "Decide: write the call you're making. Act: record what you did and the outcome.",
      "Mark the cycle complete with the tick, then start a new cycle with what you learned.",
    ],
    tips: [
      "Orient is the heart of the loop. It's where you challenge your assumptions.",
      "Keep cycles short. A quick, good-enough decision beats a perfect late one.",
      "For a live production incident, use the Incident Commander.",
    ],
  },
  {
    toolId: "polarity-map",
    summary:
      "A polarity map (Barry Johnson) is for ongoing tensions you can't solve once, such as autonomy and standardization. Both poles have upsides and downsides; the aim is to get the best of both and notice when you lean too far.",
    whenToUse: [
      "A debate that keeps coming back because both sides are right, such as speed and quality.",
      "When fixing one problem keeps creating the opposite problem.",
    ],
    steps: [
      "Enter a Polarity title and name the Left pole and Right pole in neutral words, such as Autonomy and Standardization.",
      "Add the Greater purpose both poles serve and the Deeper fear if you get it wrong, then click Create polarity.",
      "For each pole, list Upsides (what goes well) and Downsides (what goes wrong when you over-focus on it), one per line.",
      "Look for the pattern: overdoing one pole lands you in its downsides, which pushes you toward the other pole.",
      "Agree how you'll keep both sets of upsides, and which early signs show you've drifted too far.",
    ],
    tips: [
      "Ask: is this a problem to solve or a polarity to manage? If both sides will still matter next year, it's a polarity.",
      "Fill in the map with people from both camps. Each side gets to see the other pole's upsides.",
      "Avoid loaded pole names like “Chaos” and “Bureaucracy”. They start a fight.",
    ],
  },
  {
    toolId: "rfc-tracker",
    summary:
      "An RFC (request for comments) is a written proposal that others review before a decision is made. The RFC Tracker follows each one from draft through review to a decision, and shows how long that takes.",
    whenToUse: [
      "Significant technical or process changes that affect more than one team.",
      "When decisions happen in side conversations and the people affected find out late.",
    ],
    steps: [
      "Enter a Title and Author, add the problem in Description, and click New RFC. It starts as Draft.",
      "Add Reviewers by name, then set the status to In review when the proposal is ready.",
      "Reviewers post Comments; the author answers them and updates the proposal.",
      "Set the status to Decided and write the Decision: what was decided and why. Use Withdrawn if it's dropped.",
      "Click Push to Decision Log to keep the outcome as an ADR.",
      "Review open RFCs weekly. The day count and Avg time-to-decide show when reviews drag.",
    ],
    tips: [
      "Set a review deadline when an RFC goes In review. Without an end date, reviews drift.",
      "Name a few reviewers who must respond, rather than asking everyone.",
      "Keep the full proposal in your docs and link it in the Description.",
    ],
  },
];
