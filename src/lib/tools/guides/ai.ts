import type { ToolGuide } from "./types";

/** Guides for the "AI product management" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "ai-feature-spec",
    summary:
      "An AI feature spec is a product requirements doc with the extra questions AI raises: which model, how you'll judge its output, what happens when it fails and what it may cost. Writing it down before building makes those trade-offs clear and open to review.",
    whenToUse: [
      "Before building any feature that calls an LLM or other model.",
      "When a prototype works in a demo and the team must agree what “good enough for production” means.",
    ],
    steps: [
      "Start with Feature name and Problem & user goal: the user's job, described without mentioning AI.",
      "Fill in Model choice & justification, and Eval criteria with a measurable pass bar, e.g. accuracy ≥ 0.85 on a named test set.",
      "Set the limits: Latency budget (ms p95), Cost budget per request and per month, and Hallucination tolerance for each kind of output.",
      "Decide the Fallback if model fails and the Human-in-the-loop checkpoints, such as a reviewer approving low-confidence actions.",
      "Write the Rollout plan (e.g. 1% canary, then 10%, then 100%) and the Success metric, then export the spec and review it with the team.",
    ],
    tips: [
      "Write the fallback first. If the feature is useless without the model, say so and plan for outages.",
      "Tolerance differs by output: zero for facts and money, looser for tone or wording suggestions.",
      "The page holds one spec and saves as you type, so export it before starting the next feature. Track the eval bar in the LLM Eval Tracker.",
    ],
  },
  {
    toolId: "llm-eval-tracker",
    summary:
      "An eval tracker records how a model and prompt score on a fixed test set each time you run it. Over time it shows drift and flags real drops in quality, not just noise.",
    whenToUse: [
      "Before and after changing a prompt, a model or your retrieval setup.",
      "On a regular schedule, such as every release, to catch quality slipping quietly.",
    ],
    steps: [
      "Choose a dataset: a fixed set of test cases with a grading rule, named with a version (e.g. faithfulness-v2).",
      "After each run, use Log eval run to record the Model, Dataset, Prompt version and a Score from 0 to 1.",
      "If you've added your own provider key in AI settings, Live Eval Run (BYOK) runs a prompt for you; read the output, grade it and log the score.",
      "Read Score over time: one line per dataset, with a dashed reference line at 0.8.",
      "Check Detected regressions. Once a prompt version and dataset have six or more runs, the last three are compared with the earlier ones and a drop unlikely to be noise is flagged.",
    ],
    tips: [
      "Keep each dataset fixed. If you change the test cases, give it a new name, or the trend means nothing.",
      "Regressions are grouped by prompt version and dataset, not by model, so log a new prompt version when you switch models.",
      "Look into a flagged drop with the Hallucination Log; compare candidate models in the Model Comparison Matrix.",
    ],
  },
  {
    toolId: "prompt-registry",
    summary:
      "A prompt registry keeps every version of your prompts in one place, with who changed what, why, and which version is live. It turns prompt edits into reviewed releases you can roll back.",
    whenToUse: [
      "When prompts live in code, docs and chat threads and nobody is sure which one is in production.",
      "Before changing a prompt that real users depend on.",
    ],
    steps: [
      "Under Draft new prompt version, enter the Prompt name, Version (e.g. 1.4.0), Author, Prompt body and a Change note, then click Save draft.",
      "Set the status to review and ask someone else to read it.",
      "If you've added your own provider key in AI settings, click Test to run the prompt and check the output.",
      "When it passes your evals, publish it with the check icon, or set its status to production.",
      "Set the version it replaces to deprecated, so only one version of each prompt is live.",
    ],
    tips: [
      "Bump the version for every change, even one word. Use a new major number when the output's behavior or format changes.",
      "Run your eval set on each new version and log it in the LLM Eval Tracker under that prompt version, so versions can be compared.",
      "Make the Change note specific: “added a refusal rule for medical advice” beats “tweaks”.",
    ],
  },
  {
    toolId: "model-comparison",
    summary:
      "The Model Comparison Matrix puts candidate models side by side on cost, speed, context window and quality, so choosing a model is a visible trade-off rather than a habit.",
    whenToUse: [
      "Choosing a model for a new AI feature.",
      "When a new model comes out, or cost or latency becomes a problem.",
    ],
    steps: [
      "Under Add model, enter the Model name, Vendor, Input $/1k tok, Output $/1k tok, Context window, Latency p50 ms, Latency p95 ms and an Eval score from 0 to 1.",
      "Set a status: production, evaluation, experimental or deprecated, then click Add model.",
      "The Models table sorts by eval score. Read it against cost and p95 latency, not on score alone.",
      "To compare real outputs, use Live Compare (BYOK): type a prompt, tick the providers you've set up in AI settings and click Run all.",
      "To update a model, add it again with the same Model name; its row is replaced.",
    ],
    tips: [
      "Use the same dataset and grading for every model's eval score, or the column isn't comparable. The LLM Eval Tracker keeps the history.",
      "Judge user-facing features on p95 latency; the median hides the slow requests users notice.",
      "Price per token is only part of the cost. Longer prompts or retries add up, so check real spend in the Token-Cost Tracker.",
    ],
  },
  {
    toolId: "hallucination-log",
    summary:
      "A hallucination log records each time the AI gave a wrong or made-up answer: what was asked, what it said, what it should have said, how bad it was and why. Patterns in the log show what to fix first.",
    whenToUse: [
      "Whenever users, support or testers report a wrong AI answer.",
      "Reviewing AI quality each sprint, or after a model or prompt change.",
    ],
    steps: [
      "Under Log new hallucination, set the Feature, the Severity and the Root cause if you know it.",
      "Paste the Input sent to the model and the Actual response, and add Expected if you know the right answer. Remove personal data first.",
      "If you've added your own provider key in AI settings, Reproduce with BYOK reruns the input and fills in Actual, so you can check it still happens.",
      "Click Log incident. The Open by severity and By root cause charts show where problems cluster.",
      "Review open incidents weekly, fix the most common root cause and mark incidents resolved with the check icon once the fix is live.",
    ],
    scales: [
      {
        name: "Severity",
        values: [
          { value: "low", meaning: "cosmetic or easy to spot; little harm" },
          { value: "medium", meaning: "misleading, but users are likely to notice" },
          { value: "high", meaning: "wrong facts users may act on" },
          { value: "critical", meaning: "could cause legal, financial or safety harm" },
        ],
      },
      {
        name: "Root cause",
        values: [
          { value: "rag-miss", meaning: "retrieval didn't find or pass the right source" },
          { value: "prompt", meaning: "instructions were unclear or invited guessing" },
          { value: "model", meaning: "the model made things up despite good input" },
          { value: "context-window", meaning: "needed information was cut off by length limits" },
        ],
      },
    ],
    tips: [
      "Add each fixed incident to your eval dataset so it can't quietly return. Track the scores in the LLM Eval Tracker.",
      "Pick Unknown rather than guess a root cause; a wrong cause sends the fix in the wrong direction.",
    ],
  },
  {
    toolId: "token-cost-tracker",
    summary:
      "The Token-Cost Tracker adds up what each AI feature spends on model tokens, projects the next 30 days and warns you when spend is heading over budget.",
    whenToUse: [
      "Running AI features in production or a paid pilot.",
      "Before a pricing or model decision, to see which features cost the most.",
    ],
    steps: [
      "Set your Monthly budget in USD.",
      "Under Log spend, enter the Feature, Model, Date, Input tokens and Output tokens. If the model is in the price table, leave Cost USD blank and it's filled in; otherwise type the cost.",
      "Runs made with your own provider key anywhere in the toolkit are added automatically as “BYOK: …” rows. Delete any you don't want counted.",
      "Check Projected next 30d: your recent daily average times 30. It turns red, with a warning, when it's over budget.",
      "Each week, use Daily spend (with its daily budget line) and By feature to find the biggest spenders.",
    ],
    tips: [
      "Log on a steady rhythm, e.g. daily per feature. Days with no entries pull the projection down.",
      "Output tokens usually cost several times more than input tokens, so shorter answers are often the cheapest saving.",
      "If one feature dominates spend, compare cheaper models for it in the Model Comparison Matrix.",
    ],
  },
  {
    toolId: "ai-safety-checklist",
    summary:
      "A pre-launch checklist of 20 safety checks for an AI feature, grouped into privacy, security, content, operations and governance. The governance checks follow the four functions of the NIST AI Risk Management Framework.",
    whenToUse: [
      "Before launching an AI feature, or opening it to new users or markets.",
      "After a model change, a red-team finding or a serious incident.",
    ],
    steps: [
      "Go through the five sections with the people who own each area: privacy, security, content policy, operations and governance.",
      "Tick an item only when there's evidence, such as a test result, a document or a working dashboard.",
      "For the NIST RMF items: Govern names an owner and policies, Map sets out the context and risks, Measure covers evals and monitoring, and Manage plans mitigations and communication.",
      "Watch the Completion bar. Anything still open at launch needs an owned decision to accept the risk.",
      "Export the checklist and keep it with the launch decision.",
    ],
    tips: [
      "Back up the prompt-injection and jailbreak items with real attempts logged in the AI Red-Team Session Log.",
      "Record any risk you accept in the Risk Register, with an owner.",
      "The page keeps a single checklist, so export it before reusing it for another feature.",
    ],
  },
  {
    toolId: "ai-red-team",
    summary:
      "A red-team log records deliberate attempts to make your AI misbehave, such as prompt injection, jailbreaks or data leaks, and whether they worked. It shows which attacks your defenses stop and what still needs fixing.",
    whenToUse: [
      "Before launch, and after any change to the prompt, model or tools.",
      "In a planned session where several people try to break the feature.",
    ],
    steps: [
      "Plan which attack vectors to try, such as prompt injection, jailbreak, data extraction or harmful content.",
      "For each attempt, enter the Attack vector, a Severity and the Prompt used, and tick Attack succeeded if it worked.",
      "If you've added your own provider key in AI settings, Test attack with BYOK runs the prompt so you can judge the response before logging.",
      "Click Log finding. Fix successful attacks first, highest severity first.",
      "After a fix, rerun the same prompt and mark the finding resolved with the check icon only when the attack no longer works.",
    ],
    tips: [
      "Log failed attempts too. They show what you tested, and the success rate means nothing without them.",
      "Historical attack success counts every finding ever logged, so it doesn't drop as you fix things. Watch Open and Critical open for current risk.",
      "Use the results to tick the security items in the AI Safety Review Checklist.",
    ],
  },
  {
    toolId: "model-migration",
    summary:
      "A checklist for moving a feature from one model to another, such as a vendor's next version. It makes sure quality, cost and behavior are compared before users see the new model.",
    whenToUse: [
      "When a vendor releases a new model or retires the one you use.",
      "When switching vendors for cost, speed or quality.",
    ],
    steps: [
      "In Migration overview, enter the From model and To model.",
      "Work through the starter steps in order: evals on both models, cost and latency comparison, a behavior diff on 50 golden inputs, prompt updates, a 1% canary, 7 days of monitoring, full rollout and deprecating the old model.",
      "Record the results as Eval delta % (e.g. +2.1) and Cost delta % (e.g. -18).",
      "Add the steps your feature needs with Add step, remove ones that don't apply, and tick each one as it's done.",
      "Don't go past the canary until the deltas and the behavior diff are acceptable.",
    ],
    tips: [
      "Read the behavior diff, not just the scores. A new model can score the same and still change tone, length or format.",
      "Run both models on the same dataset in the LLM Eval Tracker so the eval delta is like for like.",
      "Keep the rollback flag in the Feature Flag Tracker. The page tracks one migration at a time, so export it when you're done.",
    ],
  },
  {
    toolId: "model-card",
    summary:
      "A model card is a short, standard document describing a model: what it's for, what it was trained on, how it was evaluated, where it falls short and its license. It helps others use the model responsibly.",
    whenToUse: [
      "When you train, fine-tune or ship a model that others will build on.",
      "When legal, compliance or customers ask what a model is and how it was tested.",
    ],
    steps: [
      "Under New model card, enter the Model name and its Intended use, including uses that are out of scope.",
      "Describe the Training data: sources, time range and anything excluded.",
      "Summarize the Evaluation results, naming the datasets and metrics used.",
      "List Limitations & biases honestly, add the License and click Save card.",
      "Cards can't be edited, so when the model changes, save a new card and remove the old one.",
    ],
    tips: [
      "Write for someone who wasn't on the project, without internal jargon.",
      "Report results for different user groups where you can; an overall average hides who the model fails.",
      "Take the numbers from the LLM Eval Tracker and known failure modes from the Hallucination Log.",
    ],
  },
  {
    toolId: "agentic-workflow",
    summary:
      "The Agentic Workflow Designer lists the steps of an AI agent's job in order: what the agent decides, which tools it calls, where a person checks the work and what happens when something fails.",
    whenToUse: [
      "Designing an agent before building it, to agree where the risks and human checks are.",
      "Reviewing an existing agent that is hard to explain or debug.",
    ],
    steps: [
      "Create a workflow with a name and an optional description, then select it.",
      "Add steps in order, each with a Step label, a Step kind (see below) and an optional description.",
      "Check that every risky action, such as sending, paying or deleting, has a human step before it.",
      "Check that every tool step has a fallback for when the call fails or returns nothing useful.",
      "If you've added your own provider key in AI settings, click Test on an agent step to try its label and description as a prompt.",
    ],
    scales: [
      {
        name: "Step kind",
        values: [
          { value: "agent", meaning: "the model reasons or decides" },
          { value: "tool", meaning: "a call to an API, database or other system" },
          { value: "human", meaning: "a person reviews or approves" },
          { value: "branch", meaning: "the flow splits based on a condition" },
          { value: "fallback", meaning: "what happens when a step fails" },
        ],
      },
    ],
    tips: [
      "Start with the simplest flow that works. Each extra agent step adds cost, latency and new ways to fail.",
      "Steps appear in the order you add them and can't be moved, so sketch the flow first.",
      "Track how the human checks go in the Human-in-the-Loop Quality Tracker.",
    ],
  },
  {
    toolId: "hitl-quality",
    summary:
      "Tracks what human reviewers think of the AI's output: a 1–5 rating and whether they agreed with the model. Over time it shows whether quality is improving and where reviewers keep overruling the AI.",
    whenToUse: [
      "When people review or approve AI output before it reaches users.",
      "Deciding whether a feature is ready for less human review.",
    ],
    steps: [
      "Optionally, paste the prompt into Generate first pass (BYOK) to see the model's output. The output isn't saved.",
      "Under Log review, enter the Feature and Reviewer and pick a Rating. Untick “Reviewer agreed with the model output” if they overruled it.",
      "Add a reason, especially for low ratings and disagreements, then click Log.",
      "Each week, check Mean rating, Agreement rate and the Mean rating over time chart.",
      "Export the log to read the reasons behind disagreements, and turn repeated ones into prompt fixes or eval cases.",
    ],
    scales: [
      {
        name: "Rating",
        values: [
          { value: "1–2", meaning: "poor: wrong or unusable" },
          { value: "3", meaning: "acceptable after edits" },
          { value: "4–5", meaning: "good: usable as it is" },
        ],
      },
    ],
    tips: [
      "Agree what each rating means with reviewers up front, with an example for each, or ratings will drift between people.",
      "A very high agreement rate can mean reviewers are rubber-stamping. Spot-check a sample yourself.",
    ],
  },
  {
    toolId: "rlhf-log",
    summary:
      "Collects pairwise preferences: for one prompt, a reviewer compares two responses, A and B, and picks the better one. The result is a preference dataset for evaluating models or training them with methods like RLHF or DPO.",
    whenToUse: [
      "Building a preference dataset for fine-tuning or a reward model.",
      "Comparing two models or prompt versions where a single score is hard to define.",
    ],
    steps: [
      "Optionally, in Generate pair (BYOK), type a shared prompt, pick a provider and model for Side A and Side B, and click Generate A & B. The responses fill in the form.",
      "Otherwise, paste the Prompt, Response A and Response B into Log pairwise comparison.",
      "Pick the winner (A wins, B wins or Tie), and add the Reviewer and a short Reason.",
      "Keep the redact box ticked so emails, API keys and phone numbers are removed, then click Log pair.",
      "Watch A wins, B wins and Ties, and export the full log as CSV or JSON for training.",
    ],
    tips: [
      "Swap which model is A and which is B from time to time, so reviewers can't learn a pattern.",
      "Write down what “better” means (correct, helpful, safe, concise) so every reviewer judges the same thing.",
      "Lots of ties usually means the two responses are too alike or the criteria are unclear.",
    ],
  },
  {
    toolId: "vector-store-inventory",
    summary:
      "A catalog of your embedding collections, the vector stores behind search and RAG features: which embedding model each uses, its size, how often it's refreshed and who owns it.",
    whenToUse: [
      "When several features or teams use retrieval and nobody has the full list.",
      "Before changing an embedding model, which means re-embedding every collection that uses it.",
    ],
    steps: [
      "Under Add collection, enter the Collection name and Embedding model; both are required.",
      "Add the Dimension (the vector size the model produces), Doc count, Refresh cadence (e.g. nightly) and Owner, then click Add.",
      "Review the Collections table monthly. To update a row, remove it and add it again.",
      "Remove collections nobody uses anymore, after checking with the owner.",
    ],
    tips: [
      "Vectors from different embedding models can't be searched together, so plan re-embedding when you upgrade.",
      "Stale content in a vector store is a common cause of wrong answers. Log those as rag-miss in the Hallucination Log.",
      "Give every collection an owner; one without an owner is rarely refreshed.",
    ],
  },
];
