# Where Amr's expansion scenes play

The 124 expansion scenes X001–X124 ([the spec](expansion-sheets.json), [how they're built](README.md#expansion-scenes)) come with the release's own rule for each: the trigger below. A scene may play only on the real event its trigger names, once the site really has that event and Amr can hear it, or when the visitor asks for it. Nothing plays one on a guess, a page visit standing for an outcome, or a timer.

A binding goes in this file with the change that makes it, naming the event in the code. `test/agent/mascot-expansion-scenes.test.ts` fails when code outside the scene tables names a scene whose row here says it plays on nothing (“—”).

## On request

Nothing asks for them yet.

## Real events

“—” means no real event plays it.

### Reading (X001–X024)

| Scene       | Title                                   | The release's trigger                                                                                                    | Plays on |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| X001 `x001` | Save your place and return              | Explicit bookmark or resume interaction; illustration only until a real save event exists.                               | —        |
| X002 `x002` | Find the telling detail                 | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X003 `x003` | Rebuild the four-panel story            | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X004 `x004` | Think before flipping the card          | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X005 `x005` | Recognise the colleague in the story    | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X006 `x006` | Offer the book with care                | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X007 `x007` | Find the plain-language meaning         | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X008 `x008` | Reveal the whole story                  | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X009 `x009` | Settle into a comfortable reading setup | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X010 `x010` | A dry place for the comic               | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X011 `x011` | Make a small story booklet              | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X012 `x012` | Take the story along                    | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X013 `x013` | Fit the protective book sleeve          | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X014 `x014` | Follow the idea through the story       | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X015 `x015` | One story at a time                     | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X016 `x016` | Leave a thoughtful guestbook note       | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X017 `x017` | Share feedback deliberately             | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X018 `x018` | Predict the next panel                  | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X019 `x019` | Browse a small collection               | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X020 `x020` | Prepare the next loan                   | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X021 `x021` | Open the squad conversation kit         | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X022 `x022` | The upside-down comic                   | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X023 `x023` | Care for the shared copy                | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |
| X024 `x024` | Adjust the reading light                | Deliberate reader interaction or clearly marked animation preview; never navigate or record progress from artwork alone. | —        |

### Tool lab (X025–X056)

| Scene       | Title                                      | The release's trigger                                                                                                                                                                  | Plays on |
| ----------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| X025 `x025` | A technology earns its next ring           | Illustrative preview on opening Tech Radar, or after a confirmed radar placement. Never infer adoption from a page visit.                                                              | —        |
| X026 `x026` | A proposal makes room for review           | Illustrative review invitation when RFC Tracker opens, or after a confirmed RFC enters review. A decided state needs a separately confirmed decision event.                            | —        |
| X027 `x027` | Look across five dimensions                | Illustrative SPACE Pulse preview, or after a confirmed quarterly pulse is saved. Poses do not manufacture scores or an improvement trend.                                              | —        |
| X028 `x028` | Find the drag in daily work                | Illustrative DevEx Survey preview or after a confirmed response is submitted; no implied measured score or resolved team friction.                                                     | —        |
| X029 `x029` | Treat the error budget as finite           | Illustrative SLO Builder preview, or after a confirmed burn event is recorded. The vessel is a metaphor, not a live reliability gauge.                                                 | —        |
| X030 `x030` | Choose the support that needs investment   | Illustrative Platform Engineering Maturity preview or after a confirmed assessment snapshot; not a claimed engineering repair.                                                         | —        |
| X031 `x031` | Keep the incident sequence clear           | Illustrative Incident Commander preview or after a confirmed timeline entry is logged. Never indicate resolved service or sent communications from merely opening the tool.            | —        |
| X032 `x032` | Several conditions made one failure path   | Illustrative Blameless Post-Mortem preview or after a confirmed post-mortem save. This physical model explains contributing conditions; it does not claim that a service was repaired. | —        |
| X033 `x033` | Share the rotation and notice load         | Illustrative On-Call Roster preview or after a confirmed rotation/page entry. Do not claim a person was contacted or a shift actually reassigned.                                      | —        |
| X034 `x034` | Dry-run every step, including the last     | Illustrative Runbook Maturity preview or after a confirmed test entry. The practice mechanism never claims tested production recovery.                                                 | —        |
| X035 `x035` | Examine the trust boundary                 | Illustrative Threat Model Registry preview or after a confirmed threat entry. A mitigated visual requires a confirmed mitigation event and evidence.                                   | —        |
| X036 `x036` | Close a finding after the recheck          | Play the complete sequence only after a confirmed vulnerability resolution with a recorded recheck; otherwise treat it as an explicitly illustrative procedure preview.                | —        |
| X037 `x037` | Keep evidence connected to its control     | Illustrative Compliance Control Map preview or after a confirmed evidence link is saved. Do not imply an audit, framework or regulation is fully satisfied.                            | —        |
| X038 `x038` | A focus path must reach the next key       | Illustrative Accessibility Audit Tracker preview. Use the post-fix complete path only after a confirmed resolved issue with keyboard retest.                                           | —        |
| X039 `x039` | Place the dependency in the landscape      | Illustrative Wardley Map Canvas preview or after a confirmed component/link edit. No build-versus-buy decision is claimed.                                                             | —        |
| X040 `x040` | Compare like with like                     | Illustrative LLM Eval Tracker preview, or after a confirmed eval comparison/regression. Do not invent a measured regression from a page visit.                                         | —        |
| X041 `x041` | Review the next version before release     | Illustrative Prompt Registry preview or after a confirmed draft/review event. A production transition requires a separately confirmed promotion event.                                 | —        |
| X042 `x042` | Specify the fallback before the drop       | Illustrative AI Feature Spec preview or after a confirmed specification save; no AI call, launch, reliability result or delivered feature is implied.                                  | —        |
| X043 `x043` | Give the claim an evidence footing         | Illustrative Hallucination Log preview. A grounded-claim outcome may reflect a confirmed source attachment/correction event, never the mere presence of the tool.                      | —        |
| X044 `x044` | Notice spend before the next token         | Illustrative Token-Cost Tracker preview or after a confirmed usage entry. Coin positions are a metaphor, never fabricated spend data or a billing claim.                               | —        |
| X045 `x045` | Measure the trade-offs on both sides       | Illustrative Model Comparison Matrix preview or after a confirmed comparison entry. No winner, benchmark result or provider capability is inferred.                                    | —        |
| X046 `x046` | An open check stays visible                | Illustrative AI Safety Review Checklist preview or after a confirmed checklist update. Do not imply safety certification or launch approval.                                           | —        |
| X047 `x047` | Try the new model in a small lane          | Illustrative Model Upgrade Migration Tracker preview, or after a confirmed canary step. Never infer full rollout, parity or retirement of the old model.                               | —        |
| X048 `x048` | Stop at the human checkpoint               | Illustrative Agentic Workflow Designer preview or after a confirmed workflow save. No API tool execution, human approval or external action is claimed.                                | —        |
| X049 `x049` | Rerun the same attack after a fix          | Full closing sequence only after a confirmed red-team finding is resolved following a rerun of the same attack; otherwise an explicitly illustrative procedure preview.                | —        |
| X050 `x050` | Review before the output leaves your hands | Illustrative Human-in-the-Loop Quality Tracker preview or after a confirmed reviewer disagreement/low rating. No output is sent or approved automatically.                             | —        |
| X051 `x051` | Compare the pair without the identity cue  | Illustrative RLHF Feedback Log preview or after a confirmed pairwise comparison is logged. This records a reviewer preference, not objective model superiority or a training job.      | —        |
| X052 `x052` | Do not mix incompatible embeddings         | Illustrative Vector Store Inventory preview or after a confirmed inventory entry. No collection is re-embedded, refreshed or deleted by this animation.                                | —        |
| X053 `x053` | Keep the model’s limits visible            | Illustrative Model Card Builder preview or after a confirmed card save. No model is trained, evaluated, licensed or certified by the folding action.                                   | —        |
| X054 `x054` | One action becomes the next observation    | Illustrative OODA Loop Tracker preview, or after a confirmed cycle completion. Physical rotation does not claim a real-world action or outcome.                                        | —        |
| X055 `x055` | Check agreement and certainty separately   | Illustrative Stacey Matrix preview or after a confirmed plotted item. The marker’s location is a planning illustration unless based on confirmed inputs.                               | —        |
| X056 `x056` | Keep both useful poles in play             | Illustrative Polarity Map preview or after a confirmed polarity entry. No measured team balance or permanent resolution is claimed.                                                    | —        |

### Team, data and decisions (X057–X080)

| Scene       | Title                                  | The release's trigger                                                                      | Plays on |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| X057 `x057` | Trace it back to the source            | Manual play during a discussion of data provenance or documentation.                       | —        |
| X058 `x058` | The duplicate that was different       | Manual play during a data-quality or exception-review discussion.                          | —        |
| X059 `x059` | The missing field matters              | Manual play when discussing readiness, validation rules or data completeness.              | —        |
| X060 `x060` | Find the unmatched entry               | Manual play during a reconciliation or data-quality conversation.                          | —        |
| X061 `x061` | Share the observation safely           | Manual play alongside anonymised research export or privacy-review discussions.            | —        |
| X062 `x062` | Only the access that is needed         | Manual play during an access-control or safe-sharing discussion.                           | —        |
| X063 `x063` | Keep it retrievable                    | Manual play during evidence organisation, runbook hygiene or record-retention discussions. | —        |
| X064 `x064` | Let the sample represent the mix       | Manual play while discussing evaluation-set coverage or research sampling.                 | —        |
| X065 `x065` | Make room for the next voice           | Manual play during a ceremony, facilitated discussion or fair-turns explanation.           | —        |
| X066 `x066` | Think first, reveal together           | Manual play when introducing silent brainstorming in a retrospective or workshop.          | —        |
| X067 `x067` | A private choice can be heard          | Manual play when discussing anonymous team check-ins or workshop voting.                   | —        |
| X068 `x068` | Support the speaker, steady the stand  | Manual play before a workshop demonstration or review.                                     | —        |
| X069 `x069` | Leave the request without interrupting | Manual play while explaining a working agreement about focus or asynchronous requests.     | —        |
| X070 `x070` | Clear a route before inviting          | Manual play before a workshop, review or team session.                                     | —        |
| X071 `x071` | Ask for one useful piece of help       | Manual play during a check-in, one-to-one or team-support conversation.                    | —        |
| X072 `x072` | Let the decision stay delegated        | Manual play while discussing decision rights or a working agreement.                       | —        |
| X073 `x073` | Check that the improvement helped      | Manual play when reviewing a retrospective action or completed improvement.                | —        |
| X074 `x074` | Rehearse the handoff orientation       | Manual play during a cross-team handoff or dependency discussion.                          | —        |
| X075 `x075` | Show one testable feature              | Manual play during product discovery or a sprint review.                                   | —        |
| X076 `x076` | Change the answer when the fit changes | Manual play during a decision, hypothesis or assumption discussion.                        | —        |
| X077 `x077` | See whether the user can reach it      | Manual play during an interview synthesis, usability discussion or sprint review.          | —        |
| X078 `x078` | Make room by making a trade-off        | Manual play during scope negotiation or planning.                                          | —        |
| X079 `x079` | Local motion is not the whole journey  | Manual play during delivery, integration or end-to-end verification discussions.           | —        |
| X080 `x080` | Test on the spare piece first          | Manual play during a hypothesis, discovery or risk conversation.                           | —        |

### Cast encounters (X081–X104)

| Scene       | Title                                  | The release's trigger                                       | Plays on |
| ----------- | -------------------------------------- | ----------------------------------------------------------- | -------- |
| X081 `x081` | The Blocker Becomes a Ramp             | Blocked handoff or dependency is inspected.                 | —        |
| X082 `x082` | Polished Enough to Roll                | A review remains open after the useful checks are complete. | —        |
| X083 `x083` | Walk the Marble Through                | A confusing fault needs a simple example.                   | —        |
| X084 `x084` | The Missing Piece Was Underneath       | An incomplete record or unexplained data gap is found.      | —        |
| X085 `x085` | A Bridge That Carries the Handoff      | A handoff needs a usable completion check.                  | —        |
| X086 `x086` | One More Has a Weight                  | Another request arrives at full capacity.                   | —        |
| X087 `x087` | The Extra Cube Needs a Swap            | A small extra feature is proposed.                          | —        |
| X088 `x088` | Change the Stencil for a Reason        | New evidence changes a requirement.                         | —        |
| X089 `x089` | Choose the Route That Reaches the Bowl | Prioritisation needs a clear intended outcome.              | —        |
| X090 `x090` | Stop Catching the Same Drop            | The same incident recurs.                                   | —        |
| X091 `x091` | The Wheel Makes Something Usable       | A delivery counter rises without a usable result.           | —        |
| X092 `x092` | A Safe Opening in the Wall             | A handoff stalls at a team boundary.                        | —        |
| X093 `x093` | Let the Fit Answer First               | A senior opinion arrives before a practical test.           | —        |
| X094 `x094` | The Smallest Useful Meeting            | A meeting is proposed for a simple handoff.                 | —        |
| X095 `x095` | One Spacer, One Test                   | An uncertain idea needs a small relevant experiment.        | —        |
| X096 `x096` | Show the Handle in Use                 | A request needs direct observation.                         | —        |
| X097 `x097` | Let the Empty Centre Show              | A polished result needs an honest evidence check.           | —        |
| X098 `x098` | A Connection You Can Pull              | A cross-team connection blocks flow.                        | —        |
| X099 `x099` | Retire the Wedge Properly              | A recurring workaround needs ownership.                     | —        |
| X100 `x100` | Pause at the Actual Snag               | A repeated snag is ready for a short review.                | —        |
| X101 `x101` | Follow the Snag Back                   | A handoff problem triggers blame.                           | —        |
| X102 `x102` | A Bounded Check, Then Release          | A controlled release awaits a clear assurance decision.     | —        |
| X103 `x103` | Give the Odd Piece Somewhere Safe      | A repeated process has an unhandled exception.              | —        |
| X104 `x104` | Close the Old Loop Gently              | An old unresolved item returns for review.                  | —        |

### Guides (X105–X112)

| Scene       | Title                            | The release's trigger                                                                                                                                                                    | Plays on |
| ----------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| X105 `x105` | A rhythm that knows when to stop | Manual normal-motion preview only. If a verified reduced-motion or animation-stop preference is active, show the already-still frame8 directly; never play a stopping performance first. | —        |
| X106 `x106` | Follow the next focus stop       | Manual keyboard-help preview; possible future use after an explicit request for keyboard guidance. Do not intercept Tab to play it.                                                      | —        |
| X107 `x107` | Close the panel, keep your place | Manual dismiss-help preview. An actual Escape or close action should dismiss immediately; do not delay it while these beats play.                                                        | —        |
| X108 `x108` | Choose a comfortable corner      | Manual position-help preview. Future state-driven use requires an explicit placement or drag request from the visitor.                                                                   | —        |
| X109 `x109` | Make room for silence            | Manual audio-help preview in normal motion. A real mute action immediately silences audio; show frame8 directly if animation is also disabled.                                           | —        |
| X110 `x110` | Keep a small preference here     | Manual preferences-help preview; future acknowledgement only after a real, confirmed local preference write succeeds.                                                                    | —        |
| X111 `x111` | Give the content the stage       | Manual presentation-help preview. A future animation may follow an actual confirmed Present action on a tool page.                                                                       | —        |
| X112 `x112` | Narrow the tool shelf            | Manual search-help preview or explicit request to learn the verified header Search tools control; no unsolicited shortcut lesson.                                                        | —        |

### Play (X113–X124)

| Scene       | Title                              | The release's trigger                                                                                                            | Plays on |
| ----------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| X113 `x113` | Free the badge, keep the lanyard   | Explicit gallery play or visitor-requested easter egg; never inferred from inactivity, work performance or user frustration.     | —        |
| X114 `x114` | The cable becomes a tidy coil      | Explicit gallery play or optional visitor-requested tactile scene; no claim to fix a technical issue.                            | —        |
| X115 `x115` | Fold, fly and catch                | Explicit gallery play or optional user-requested easter egg in normal motion.                                                    | —        |
| X116 `x116` | The yo-yo comes home               | Explicit optional play in normal motion; no unsolicited looping near content.                                                    | —        |
| X117 `x117` | Set the top spinning, then stop it | Explicit optional play in normal motion; never automatic after a visitor stops animations.                                       | —        |
| X118 `x118` | Gather the rolling pencils         | Explicit gallery play; a neutral tactile scene, never triggered as a judgement about messy work.                                 | —        |
| X119 `x119` | Measure, then guide the return     | Explicit optional play in normal motion; no measurements of the visitor or their work.                                           | —        |
| X120 `x120` | The keystone holds                 | Explicit optional tactile play; never claims a team's dependencies or architecture are solved.                                   | —        |
| X121 `x121` | A little toy can wait              | Explicit optional gallery play in normal motion. Do not run this sequence when real reduced motion or animation pause is active. | —        |
| X122 `x122` | A paper flake follows the balloon  | Explicit optional easter egg in normal motion; no interaction with the visitor's pointer or content.                             | —        |
| X123 `x123` | The block stays standing           | Explicit gallery play in normal motion; not a task-completion animation or performance challenge.                                | —        |
| X124 `x124` | Find the little release tab        | Explicit optional gallery play; never triggered as commentary on the visitor's decisions or effort.                              | —        |
