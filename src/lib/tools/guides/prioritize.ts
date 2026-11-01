import type { ToolGuide } from "./types";

/** Guides for the "Prioritize & decide" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "prioritizer",
    summary:
      "The shared backlog every prioritization method scores, and the one place the team decides its order. Sprint Planning imports the backlog in that order.",
    whenToUse: [
      "Ordering a backlog when you want to compare several methods side by side.",
      "When stakeholders favor different frameworks and you need one agreed order.",
    ],
    steps: [
      "Under Add an item, type the Item (a description is optional) and press Add item. Every method starts Not scored, and the item is Not ordered yet.",
      "In Backlog items, press an item's MoSCoW, WSJF, RICE or Value/Effort cell to score it in place, then Save. Clear all leaves that method Not scored.",
      "For ICE, Kano and Cost of Delay, open the All methods tab and follow a cell's Score with link: the method's tool opens with the item picked.",
      "Open Decide order. Read each method's place for every item, the Consensus, Scored in and Agreement (Methods disagree marks items to talk through). Turn a method's chip off to leave it out.",
      "Under 2. Your order, press Use the consensus. Then drag rows by their grip, or focus the grip and use the arrow keys (Home and End jump to the ends), Move up, Move down or the position menu. Add to the order brings in an item; the X takes one out.",
      "Press Save order (Undo is in the toast). Sprint Planning imports in this order, and a new item stays Not ordered yet until you save again.",
      "In the MoSCoW tab, reorder an ordered item within its bucket: it saves at once, with Undo.",
    ],
    tips: [
      "Value is one field: WSJF's business value and the matrix's value. Clearing Value/Effort keeps the value WSJF uses.",
      "WSJF parts run 1, 2, 3, 5, 8, 13, 20: give the smallest item a 1 and size the others against it.",
      "RICE reach can count per week, month, quarter or year; the score compares it per quarter.",
      "A sorted column holds its rows still while you edit: press Re-sort to catch up.",
      "Export gives Markdown with the decided order and each method's places.",
    ],
  },
  {
    toolId: "moscow",
    summary:
      "MoSCoW sorts scope into Must have, Should have, Could have and Won't have (this time), and keeps the Musts to about 60% of the planned effort.",
    whenToUse: [
      "Agreeing the scope of a release, MVP or fixed-date project.",
      "When stakeholders treat everything as top priority.",
    ],
    steps: [
      "Agree the release or timebox you're scoping. MoSCoW only works against a deadline.",
      "Type the Scope item, pick its Bucket (none is picked for you) and, if you like, an Effort in points, then click Add.",
      "Challenge every Must have: would the release fail without it? Use Move on a row to change its bucket. Items without one wait under Not sorted yet: use Sort to file them.",
      "Watch the Must budget: the Musts' share of the planned Must + Should + Could effort, against a marker at 60% (Won't is left out). Over the limit, it says how much Must effort to move down.",
      "A row linked to the backlog uses the item's job size as its effort, and a move writes to the backlog item too.",
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
      "The budget shows once three planned items have an effort.",
      "Won't have means not this time, not never: keep those items on the board and revisit them next release.",
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
      "Type the Idea or experiment, or use Import from backlog.",
      "Pick Impact (how much it would move your goal), Confidence (how much evidence you have) and Ease (how quickly you can try it). Hover a value to see what it means, then click Add & score.",
      "The list ranks by ICE (up to 1,000), and the sentence above it says what to do first.",
      "Use Edit on a row to re-score it in place, or Delete (with Undo). Run the top few, then re-score with what you learned.",
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
      "Check the front-runners with RICE before committing.",
    ],
  },
  {
    toolId: "value-effort-matrix",
    summary:
      "A Value vs Effort matrix places each item by the value it brings and the work it takes, sorting it into Quick Wins, Big Bets, Fill-Ins or Time Wasters.",
    whenToUse: [
      "Sorting a list of ideas or backlog items quickly in a workshop.",
      "Finding cheap, valuable work to start with.",
    ],
    steps: [
      "Type an Item title, pick a Value (1, 2, 3, 5, 8, 13 or 20, against the other items) and an Effort (1 under a day to 10 months across teams), and click Add. A title alone waits under Not placed yet.",
      "Place or move items on the Matrix: drag a dot or a chip from Not placed yet, pick a quadrant from a chip's Place in…, or focus a dot and use the arrow keys (Left and Right change effort, Up and Down value, Shift moves 3). A move saves when you let go, press Enter or move away.",
      "Start with Quick Wins (best value ÷ effort first), plan Big Bets, fit Fill-Ins into slack time and drop Time Wasters.",
      "Use Edit on an item to change its title or scores in place; clearing both sends it back to Not placed yet. Delete and Clear matrix offer Undo.",
      "Import from backlog scores a backlog item: its value and effort are saved to the item.",
    ],
    scales: [
      {
        name: "Quadrants (value 8 or more, effort 6 or more count as high)",
        values: [
          { value: "Quick Wins", meaning: "high value, low effort" },
          { value: "Big Bets", meaning: "high value, high effort" },
          { value: "Fill-Ins", meaning: "low value, low effort" },
          { value: "Time Wasters", meaning: "low value, high effort" },
        ],
      },
    ],
    tips: [
      "Value is the backlog's one value field, WSJF's business value too: scoring it here scores it there.",
      "Lots of Big Bets? Split them; smaller pieces often turn into Quick Wins.",
      "Estimate effort with the people who will do the work.",
    ],
  },
  {
    toolId: "kano-model",
    summary:
      "The Kano model sorts features by how customers react to them: some are expected, some satisfy more the better they are, and some delight. Two questions per feature, read through the Kano evaluation table, give the category and Better and Worse scores.",
    whenToUse: [
      "Planning a release or roadmap and weighing basics against differentiators.",
      "Surveying customers about a list of features, live or on paper.",
    ],
    steps: [
      "Type the Feature title. Under How you have the answers, pick One person's answers and answer both questions (If it has this, how do you feel? and If it doesn't have this, how do you feel?), or pick Survey counts and enter how many answer pairs came out A, O, M, I, R and Q. Click Add.",
      "To survey customers, under Ask customers press Run a live round, give your name, tick the consent and share the link with Copy link. Everyone answers on their own phone, anonymously; press Reveal results once 3 have answered, then Save round.",
      "With paper answers, press Enter counts instead and type how many people gave each answer pair into the feature's 5 × 5 grid (first answer down, second across), then Show totals and Save round. A round replaces a feature's earlier counts unless Add to earlier answers is on; Undo puts them back.",
      "Read the lists: a feature's category is its most common answer from 3 answers, with Better (having it helps) and Worse (missing it hurts), plotted in Better vs Worse.",
      "Cover every Must-be first, invest in Performance, add a few Attractive features, and reword the question for anything Questionable.",
    ],
    scales: [
      {
        name: "Kano categories",
        values: [
          { value: "Must-be", meaning: "expected; missing it causes dissatisfaction" },
          { value: "Performance", meaning: "the more and better, the happier customers are" },
          { value: "Attractive", meaning: "delights when present; not missed when absent" },
          { value: "Indifferent", meaning: "customers don't care either way" },
          { value: "Reverse", meaning: "some customers are put off when it's present" },
          { value: "Questionable", meaning: "the answers contradict each other" },
        ],
      },
    ],
    tips: [
      "A round keeps only each feature's totals, never who answered what.",
      "Questionable means someone liked both having and not having it: the question was probably unclear.",
      "Features picked by hand on the old page show Picked by hand: click Add answers to give them real ones.",
      "Open How the category is found to see the evaluation table.",
    ],
  },
  {
    toolId: "cost-of-delay",
    summary:
      "Cost of Delay orders work by CD3: what a week of waiting costs, divided by the weeks the work takes, inside urgency lanes. Putting a number on waiting makes it visible.",
    whenToUse: [
      "Making the case for doing one initiative before another.",
      "When work waits in queues and nobody sees what the wait costs.",
    ],
    steps: [
      "Type the Initiative title.",
      "Enter Cost of delay ($ per week): the revenue, savings or avoided risk lost each week it isn't live. Enter Duration (weeks), half a week at least. The CD3 they make shows as you type.",
      "Pick an Urgency profile: Expedite, Fixed date, Standard or Intangible (the line under it says what each means). For Fixed date, enter the Date it must land by. Then click Add.",
      "The list runs in lanes: Expedite first, then Fixed date by latest start (Start by … to land by …, marked late once that start has passed), then Standard and Intangible by CD3.",
      "Older items without a duration wait under Not scored: add a duration. Use Edit to add one.",
    ],
    tips: [
      "A rough range beats no number. Write down your assumptions so others can challenge them.",
      "Waiting costs $N per week is what one more week of the whole queue costs.",
      "Cross-check with the WSJF Calculator, which sizes the same trade-off relatively.",
    ],
  },
  {
    toolId: "buy-a-feature",
    summary:
      "Buy-a-Feature is an innovation game: players get a limited budget of play money to spend on priced features. The pool can't buy everything, so they negotiate, and that shows what they value most.",
    whenToUse: [
      "Prioritizing with customers or stakeholders who all want different things.",
      "When ranking exercises keep ending in “everything is important”.",
    ],
    steps: [
      "Add each feature with a Price that reflects its rough cost, such as its size in team-days. A price is a whole number, and every feature needs one.",
      "Under The game, set Players and Budget per player. The pool is the two multiplied and should stay below the sum of the prices (about half is usual). Use the team's N people and About half the prices offer numbers; nothing is set until you pick.",
      "To buy at the table, type an amount on a feature and press Buy. A purchase is capped at what the feature still needs and at what's left in the pool; Undo is in the toast.",
      "Or under Play a round, press Run a live round, give your name, tick the consent and share the link: each player splits their share on their phone, and you Reveal results once 3 have answered. With paper, press Enter counts instead and type the splits or the totals. Save round adds the totals; what a feature doesn't need goes back to the pool.",
      "At the end, Refund unfunded features gives the money of short features back. Then Add N funded features to the backlog makes each one a backlog story.",
    ],
    tips: [
      "A round keeps each feature's total, and from 5 answers how many backed it and the spread, never anyone's split.",
      "A later round's budget is what's left in the pool, split evenly.",
      "Price some features above any single player's budget, so people have to pool money.",
      "For a quick vote on how much each item matters, use the $100 Test instead.",
    ],
    timebox: "45–90 minutes",
  },
  {
    toolId: "hundred-dollar-test",
    summary:
      "In the $100 Test (cumulative voting) you split $100 across competing items. Giving more to one item means giving less to another, so it shows how strongly people prefer each item, not just the order.",
    whenToUse: [
      "Comparing a short list of options, roughly 3 to 10, with stakeholders.",
      "When a simple ranking hides how much more one item matters than another.",
    ],
    steps: [
      "Add each Item to vote on with Add item.",
      "Under The agreed split, type the group's amount next to each item. It saves when you leave the box or press Enter, can't take the split past $100, and a note says when it was capped.",
      "Keep going until Left to give shows $0. The list holds still while you type: Re-sort puts the biggest amounts first.",
      "Under Ask the team, press Run a live round, give your name, tick the consent and share the link: everyone splits their own $100 on their phone, anonymously. Press Reveal results once 3 have answered, then Save round. With paper, press Enter counts instead and type each split or the totals.",
      "Team results shows each item's team average beside the agreed split, and from 5 answers how the amounts were spread. Discuss the biggest gaps.",
    ],
    tips: [
      "A round keeps each item's total and, from 5 answers, how many backed it and the spread; never anyone's split or who answered.",
      "Clear all amounts empties the agreed split; saved rounds stay.",
      "Watch for an item the team rates far above or below the agreed split, and ask why.",
      "For a long list, shortlist first with the MoSCoW Matrix.",
    ],
  },
  {
    toolId: "eisenhower",
    summary:
      "The Eisenhower Matrix sorts tasks by whether they're urgent and whether they're important into four actions: Do, Schedule, Delegate or Delete. A task due within two days counts as urgent.",
    whenToUse: [
      "Planning your own or the team's week when there's more to do than time.",
      "Clearing a pile of requests and interruptions.",
    ],
    steps: [
      "Type a Task and answer Important? (does it move a goal) and Urgent? (does waiting cause harm soon) with Yes or No. Both are needed.",
      "Set Due if it has a due date; it can be in the past. Due within 2 days, or overdue, makes it urgent, and the line under the form says why (“Urgent because it's due tomorrow”).",
      "When the answers say Delegate, pick Who takes it? from your team. Click Add task.",
      "Do the Do tasks now, put Schedule tasks in the calendar, hand Delegate tasks over and drop Delete tasks.",
      "Use Edit on a task to change its answers, date or who takes it, and it moves to its new pane. Tasks missing an answer wait under Not sorted yet. Delete and Clear matrix offer Undo.",
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
      "One log of decision records for the whole team, in three forms: ADR (context, options, outcome and consequences), DACI and RAPID. Every record gets the next number (ADR-0003, DACI-0004) and the same lifecycle.",
    whenToUse: [
      "Decisions that are costly to reverse: architecture, tools, data or key product rules.",
      "When the team keeps reopening the same debate, or new joiners ask why things are the way they are.",
    ],
    steps: [
      "Press New ADR (or pick DACI or RAPID under Form), give it a Title, backdate Raised on if it started earlier, and add the Context and the Options considered.",
      "Pick the Decider from the team if you know them (optional for an ADR), then press Add ADR record.",
      "Open a record to edit any field in place. What it still needs (no decider, no outcome written, proposed for over 14 days) shows as a warning on it.",
      "Press Record the decision: write What was decided, pick the Option chosen, who decided and the day.",
      "When a later record replaces it, pick that one under Superseded by… and press Supersede: both records link to each other. Reopen takes a decision back to proposed; Deprecate retires it.",
      "Filter with the All, ADR, DACI and RAPID chips under Show. Export gives Markdown: one record from its card, or the whole log.",
    ],
    scales: [
      {
        name: "Status",
        values: [
          { value: "proposed", meaning: "under discussion" },
          { value: "accepted", meaning: "agreed and in force" },
          { value: "deprecated", meaning: "no longer applies" },
          { value: "superseded", meaning: "replaced by a newer record" },
        ],
      },
    ],
    tips: [
      "Every status change and every delete can be undone from the toast.",
      "Decisions sent from Six Hats, RFC Tracker and the Weighted Decision Matrix land here as proposed records.",
      "How long decisions take shows under Advanced analysis once three records are decided.",
    ],
  },
  {
    toolId: "daci",
    summary:
      "The Decision Log raised in the DACI form: the same records, with one Driver who runs the decision, one Approver who makes the call, Contributors who advise and Informed people who hear the outcome.",
    whenToUse: [
      "Cross-team decisions where it's unclear who has the final say.",
      "When decisions drag on or get reversed after the fact.",
    ],
    steps: [
      "Press New DACI, give it a Title and Context, and list the Options considered.",
      "Pick the Approver and the Driver from the team, then add Contributors and Informed with Add or Enter.",
      "Write the Driver's Recommendation and press Add DACI record.",
      "When the Approver decides, open the record and press Record the decision (it asks for the Approver if none is named).",
      "Once it's carried out, press Mark carried out; to revisit it, press Reopen.",
    ],
    tips: [
      "Exactly one Approver. If two people must both say yes, the decision isn't set up yet.",
      "Every page lists every record: use the DACI chip to see only the DACI ones.",
      "Tell the Informed group as soon as it's decided. Surprises are what reopen decisions.",
    ],
  },
  {
    toolId: "rapid-decision",
    summary:
      "The Decision Log raised in the RAPID form, from Bain & Company: the same records, naming who Recommends, who must Agree, who Performs, who gives Input and who Decides.",
    whenToUse: [
      "Decisions that need sign-off from legal, compliance, finance or another function.",
      "Large organizations where many people assume they have a veto.",
    ],
    steps: [
      "Press New RAPID, give it a Title and Context, and list the Options considered.",
      "Pick Decide (D) and Recommend (R), one person each, then add Agree (A), Perform (P) and Input (I) with Add or Enter.",
      "Write the Recommendation and press Add RAPID record.",
      "When the Decider makes the call, open the record and press Record the decision. Press Mark carried out once the Perform people have done it.",
    ],
    tips: [
      "Keep Agree for people with a real veto, such as legal or compliance: more than three shows a warning on the record.",
      "Input is advice, not a vote. The Decider weighs it but isn't bound by it.",
      "For lighter decisions, the DACI form is simpler.",
    ],
  },
  {
    toolId: "weighted-decision",
    summary:
      "A weighted decision matrix scores each option from 1 to 10 against the criteria that matter, with important criteria weighted higher. A Total needs every weighted cell scored: an empty cell is not 0.",
    whenToUse: [
      "Choosing between a few similar options, such as vendors, tools or designs.",
      "When a group needs to show how it reached a choice.",
    ],
    steps: [
      "Press New matrix, give it a Matrix name and write What are you deciding? (it becomes the decision record's title), then press Create matrix.",
      "Agree the criteria before discussing options. Add criterion with a name and a weight (relative: 2 counts twice as much as 1; 0 keeps it without counting), and if you like what a score of 1 and of 10 mean.",
      "Add option for each choice, then type a score in each cell; it saves when you leave the cell. Rows keep their place while you score: press Re-sort when it shows.",
      "Read the Result: the verdict, a tie when the top totals are within 5%, or the weight change that would flip the winner (every criterion under How sensitive is the result?).",
      "Use Send to… → Decision record (proposed) to put the result in the Decision Log, with the options ranked and the leader as the recommendation.",
    ],
    tips: [
      "An option reading Partial has cells not scored: it has no Total yet and can't get the star.",
      "Deleting a criterion takes its scores; Undo brings both back.",
      "Rows from before named matrices open as the Untitled matrix: give it a name.",
    ],
  },
  {
    toolId: "cynefin",
    summary:
      "Cynefin (Dave Snowden) helps you work out what kind of situation you're in before deciding how to act. A few questions suggest a domain; the team decides.",
    whenToUse: [
      "Before choosing whether to plan, analyze or experiment your way through a problem.",
      "When the team disagrees on whether something needs a detailed plan or a quick experiment.",
    ],
    steps: [
      "Describe the Problem, then answer the questions under Make sense of it with Yes, No or Not sure.",
      "Read the suggested domain and the reason; press Use the suggestion, or pick another Domain yourself. Nothing is placed until a domain is picked.",
      "Add Why this domain if you like, and press Place it.",
      "On the board, edit a problem's title or reason in place, or move it with its domain picker (a plan written for it stays). Situations move between domains as you learn.",
      "For a complex problem, press Turn into a hypothesis: it goes to the Hypothesis Tracker to test, and the card shows Testing, then Tested.",
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
      "Example items stay out of the Hypothesis Tracker.",
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
