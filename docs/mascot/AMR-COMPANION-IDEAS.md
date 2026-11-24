# Amr companion sprite ideas

Written 2026-11-10. These add to the ten sets ChatGPT proposed (AI Reviewer, Dinosaur Priorities, Deadline Rabbit Rush, Octopus Overload, Ahwa Debrief, Sticky Escape, Comic to Action, Graceful Retry, Your Decision, Quiet Companion). Nothing here is in `context-sheets.json` yet and no art exists.

How they were made: six writers produced 60 ideas from six angles, 11 duplicates were removed, and each of the other 49 was reviewed against the 115 existing sheets, the 192×224 cell, the cast's canon and the triggers the site really has. No idea passed as first written: 48 were revised and one was dropped. **The story shown for each idea is the reviewed version.** The slot lists are the writers' drafts from before the review, so adjust them to the reviewed story when the brief is written.

Marks: **★** = in the suggested 32; **★★** = suggested first batch. Scores are the reviewer's, each out of 5: new, fits the cell, true to the cast, trigger exists, delight.

## Cameo rules

Today's brief says no other people and no animals, and the pack builder finds Amr's hair, skin, shirt, trousers and shoes by colour and position. A second figure in his slot can be misread, so a cameo sheet needs these rules:

- Slot 1 stays Amr alone.
- One side per sheet, at most a quarter of the slot's width (96 px of 384), drawn whole: a figure cut by the slot edge shows a straight cut.
- At most 30% of his height (120 px), below his waist, never beside his head or below his soles, and 12 px clear of him.
- A cameo standing on the floor moves the feet anchor, so those slots are marked `kind: "hip"` (upright poses only).
- Colours to avoid on a cameo: black, charcoal, tan, peach, brown, khaki, beige, olive, lime. Safe: white, light grey, blue, purple, teal, red, magenta, bright yellow.
- Characters whose own colours are on the avoid list (the green Dinosaur, a brown Beaver, a tan Hamster, dark Hedgehog spines) need a new sheet group in the builder that measures Amr's columns only and masks the cameo out of the head, skin, clothes and hair steps.

## With a colleague (cameo sheets)

One colleague per sheet, drawn whole and small at one edge. These need the cameo rules above.

### Tell the Duck ★★

- **With:** Rubber Duck Analyst (bright yellow, round glasses; a floor cameo at the right edge from slot 3 on, so those slots need kind: hip)
- **Story:** Seeing the visitor stuck, Amr winces, starts explaining the problem to a below-knee Rubber Duck Analyst, freezes when the Duck turns to look at us, rubs his neck and offers an open palm within four seconds, while the two spare slots form an explaining-to-the-Duck loop for when the AI is thinking.
- **Plays when:** The stuck offer in src/components/agent/mascot/engine/interactions/intent.ts (three rage taps on one spot, or a form refused twice): replaces the lone "concerned" face before the "Need a hand?" bubble, once per page per visit.
- **Review:** Real trigger, fresh story; listening is the Duck's canon strength. But seven beats hold back help 7 s, and a 120 px duck touches the hip-anchor band. Fix: five beats under 4 s, duck under 100 px, two spare slots loop during AI thinking. (new 4, cell 3, cast 4, trigger 5, delight 4)
- **Draft slots 2-8:** 2. Sympathetic wince at us, shoulders up, one hand half-raised; no duck yet. 3. Finger raised, bright idea face; Rubber Duck Analyst stands whole at the right edge, knee-high, facing him. 4. Open hand presenting the duck, eyebrows up at us; duck unchanged at the right edge. 5. Leaning slightly toward the duck, both hands explaining, mouth open; duck looks up at him. 6. Frozen mid-gesture, eyes wide, mouth a small circle, realising the answer; duck unchanged. 7. Rubbing the back of his neck, sheepish grin; duck now turned to face us. 8. Open palm offered toward us, friendly eyebrows up; duck at the right edge, facing us.

### Scope Cat Swap ★

- **With:** Scope Creep Cat (grey tabby, blue blazer, as on the book cover; both colours are safe)
- **Story:** When a story joins a sprint already under way, Amr carries three teal blocks, the Cat at the right edge offers a red one, he says yes and the stack leans with both his feet planted, and they settle on a swap: red in, one teal held out low for the Cat to keep.
- **Plays when:** needs a new hook: `card_added` on a sprint that has already started (LIB\use-tool-reactions.ts plays the sticky scene for every card_added today).
- **Review:** card_added is only retro, kanban and story-mapper, never sprint-linked; hook sprint-planning's story_added while the sprint is active, once per sprint. Amr's half repeats S96's blocks: make his teal (the blazer is blue) and keep both feet down in the wobble. (new 3, cell 3, cast 4, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Amr carries three blue blocks stacked in his arms at chest height, content, face clear. 3. Cat sits whole at the right edge, knee-high, holding up a red block, hopeful; Amr looks down. 4. Amr holds four blocks, red on top, grinning, eager to please; Cat, right edge, paws together. 5. The stack leans; Amr wobbles on one foot, eyes wide; Cat, right edge, ears flat, paws to mouth. 6. Amr steadies and lowers one blue block in one hand; Cat, right edge, reaches both paws for it. 7. Cat, right edge, sits with the blue block under one paw; Amr holds three, red on top, relieved. 8. Amr tips his head to the Cat, smiling, stack steady; Cat, right edge, pats its block and waves.

### One More Thing ★

- **With:** Scope Creep Cat (grey tabby, blue blazer; a floor cameo at the left edge in every slot, so all seven need kind: hip)
- **Story:** Late in a long evening session Scope Creep Cat, seated small at the left edge, raises a paw for one more thing; Amr yawns, hears it out with a hand on his chin, the cat yawns too, Amr offers tomorrow with an open hand to the right, and both settle, the cat curled asleep and Amr with his hands in his pockets.
- **Plays when:** needs a new hook: the 25-minute long stretch (createLongStretch in src/components/agent/mascot/engine/interactions/intent.ts) when it fires in the idle ladder's late hours (23:00-05:00, engine/idle.ts), in place of the stretch.
- **Review:** Hook is real (intent.ts onInput) but 23:00-05:00 plus 25 minutes is very rare: widen to 21:00 onward or a visit's second stretch. Hip anchor reads the 30-45% band: cap the seated cat at 25%, keep Amr's palm waist-high. Let the cat yawn too, deciding together. (new 3, cell 3, cast 4, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Mid-yawn, one fist stretched up; Scope Creep Cat sits whole at the left edge, knee-high. 3. Looking down at the cat, eyebrows up; cat upright, one front paw raised, asking. 4. Hand on chin, weighing it, eyes on the cat; cat's paw still raised. 5. Kind smile, one palm raised gently toward the cat: not tonight; cat's paw lowering. 6. Arm pointing forward to the viewer's right, toward tomorrow; cat looking that way. 7. Hands sliding into his pockets, eyes half closed, shoulders dropping; cat curling up. 8. Standing quiet, hands in pockets, soft sleepy smile at us; cat curled asleep at the left edge.

### Beaver Tap Test ★

- **With:** Dependable Beaver (brown is on the avoid list, so this sheet needs the masked cameo group)
- **Story:** Amr proudly shows a two-block blue tower, the Beaver standing whole at the left edge points at it, Amr gives it a test shake himself and the top block tips into his other hand, the Beaver folds its own white list (no taller than itself) down to half, and the restacked tower survives Amr's second shake while both look pleased.
- **Plays when:** A logged tool action with a finished verb (`completed`, `finished`, `resolved`, `decided` in LIB\use-tool-reactions.ts; today a clap): now and then in place of the clap.
- **Review:** Best canon fit; trigger real. But Amr's poses re-skin S96's block tower, the tail tap needs contact or effect lines, and the list gag shrinks to 10 px. Fix: Amr shakes the tower himself at the Beaver's point; list no taller than the Beaver. (new 3, cell 2, cast 4, trigger 4, delight 3)
- **Draft slots 2-8:** 2. Amr balances a two-block blue tower on one palm, other hand thumbs-up, proud. 3. Beaver stands whole at the left edge, knee-high, pointing at the tower, tail raised; Amr looks down. 4. Amr, wincing, holds the tower at hip height; Beaver, left edge, tail mid-tap; the top block tips. 5. Amr holds one block in each hand, sheepish; Beaver, left edge, unrolls a blank paper list taller than itself. 6. Beaver, left edge, has bitten the list short, a small strip in its paws; Amr laughs. 7. Amr restacks the blocks on his palm, tongue out, careful; Beaver, left edge, checks its short strip. 8. Amr holds the tower low, standing firm; Beaver, left edge, tail resting, both giving a thumbs-up.

### Chameleon Shows Why ★

- **With:** Requirement Chameleon (cycles blue, red and purple only; never green, which would join his shirt)
- **Story:** When the sprint's scope is changed (burndown or burnup scope_changed), the Chameleon at the right edge turns wholly from blue to red and lifts a white-edged red card above its head, Amr looks from it to the blue card at his chest, flips his own to its red side, and the two end holding matching cards, the Chameleon staying red.
- **Plays when:** needs a new hook: the third `changed`, `renamed` or `moved` action in a row (LIB\use-tool-reactions.ts gives these verbs no reaction today).
- **Review:** Canon-true, but the 48 px Chameleon's red flag on a red body, half-purple and eye direction won't read, and the trigger also fires on canvas drags and filter changes. Fix: whole-body colours, a white-edged card held overhead instead of the flag, trigger on scope_changed only. (new 4, cell 2, cast 4, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Amr holds a blue card at his chest; Chameleon sits whole at the right edge, knee-high, also blue. 3. Chameleon, right edge, has turned red, eyes on the frame edge; Amr still smiles at his blue card. 4. Amr looks from the red Chameleon, right edge, to his blue card, frowning, finger on chin. 5. Chameleon, right edge, holds up a small red flag in its tail; Amr bends his head, eyebrows up. 6. Amr turns his card to its red side, nodding; Chameleon, right edge, is already half purple. 7. Amr raises one open palm, gently asking; Chameleon, right edge, half purple, looks at its flag. 8. Chameleon, right edge, red again, flag planted beside it, grinning; Amr holds the red card, thumbs up.

### Peacock Presents ★

- **With:** Vanity Metrics Peacock (look not in the repo; blue, teal and purple are safe, but no yellow-green in the tail)
- **Story:** The Peacock fans its tail and Amr claps, then the Peacock folds its tail and Amr holds the small red rosette out to us, the two bowing together as the chip fades, with the hand-over landing inside about four seconds.
- **Plays when:** A level-up or achievement chip beside Amr (LIB\use-celebration-reactions.ts; today thumbsUp, cheer or dance by rarity): the rare tier.
- **Review:** Trigger is real, but the chip lasts 4 s (CHIP_MS) and this runs about 7; the rosette makes the visitor's win Amr's; the Peacock shows 33 px wide, so only fanned versus folded reads. Fix: payoff inside 4 s, rosette held out to us. (new 3, cell 3, cast 4, trigger 4, delight 3)
- **Draft slots 2-8:** 2. Amr holds a small red rosette low in both hands, looking at it, quietly pleased. 3. Peacock stands whole at the left edge, knee-high, tail fanned wide, chest out; Amr turns, impressed. 4. Amr claps toward the Peacock, laughing, rosette tucked under his arm; Peacock, left edge, still fanned. 5. Amr offers the rosette forward at waist height, shy shrug; Peacock, left edge, looks over its shoulder. 6. Peacock, left edge, tail half folded, one wing swept toward Amr like a presenter; Amr blinks, surprised. 7. Amr lifts the rosette to shoulder height, chest out, proud grin; Peacock, left edge, wing still presenting. 8. Amr holds the rosette at his chest with a small bow; Peacock, left edge, bows too, tail closed.

### Hamster Wheel Pause ★

- **With:** Feature Factory Hamster (look not in the repo; tan fur needs the masked cameo group; wheel light blue)
- **Story:** The Hamster runs in his little wheel at the left edge while Amr cheers him on, then the Hamster steps out in front of the still wheel with one red block and the two of them hold it out to us, smiling.
- **Plays when:** A run of finishes close together (RUN_LENGTH within RUN_WINDOW_MS in LIB\use-tool-reactions.ts; today the dance).
- **Review:** Trigger is real (three finishes in five minutes, today a dance). Wheel plus growing stack overflows 96 px, spinning needs effects, and breathless Amr nags a visitor's streak. Fix: drop stack and jog; Hamster inside wheel means running, before it means paused; five frames. (new 4, cell 2, cast 3, trigger 5, delight 3)
- **Draft slots 2-8:** 2. Hamster runs in a small wheel, whole at the left edge, knee-high; Amr watches, hands on hips, impressed. 3. Amr pumps a fist, cheering; Hamster, left edge, still running, two red blocks stacked before the wheel. 4. Amr jogs on the spot, elbows pumping, cheeks puffed; left edge, Hamster runs, the block stack taller. 5. Amr stops, hand on his chest, out of breath, eyeing the stack; Hamster, left edge, runs on. 6. Amr holds one red block up to us, eyebrows raised; Hamster, left edge, leans from the still wheel. 7. Hamster, left edge, stands before the wheel hugging one block, looking at us; Amr waits, head tilted. 8. Amr and Hamster, left edge, each hold one block out to us, smiling; the wheel is still.

### Wrong Turn ★

- **With:** Data Ghost (drawn pale white or light grey, whole, hovering at the right edge between Amr's knee and hip so his feet anchor is untouched; beats 4-7 only; look not in the repo, confirm against its model sheet). Prop: a large fold-out map with plain blue and white panels (not the small cream roadmap of the Epic Roadmap sheet).
- **Story:** Amr wrestles open a blue and white map marked with one red dotted trail, turns it upside down so the trail runs the wrong way, and admits he is lost; Data Ghost drifts in low at the right edge with a blank teal card, they shrug together, both point the way back, and Amr, map folded under his far arm, ends on a thumbs-up, played on the 404 page and as the two-beat shrug on a guide search with no match.
- **Plays when:** not-found page (the 404 map; he is mounted there with no reaction today) -> beats 2-7; guide search without a match (a shrug today) -> 4-5; tool error boundary 'This tool hit a problem' -> 4-5, then 8 once the tool reloads. Needs a new hook: not-found mount and the tool error boundary.
- **Review:** New moment, apt Ghost use, pipeline-safe placement. But an unmarked map cannot read as upside down; beats 6 and 7 repeat; the tool-crash trigger suits neither map nor Ghost. Fix: one red dotted trail on the map, merge 6/7, drop crash trigger, confirm Ghost's look. (new 4, cell 3, cast 4, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Wrestles a large fold-out map open, plain blue and white panels, arms wide, puzzled. 3. Turns the map upside down, head tilted, one eye squinting. 4. Map lowered, looks down right; Data Ghost hovers whole, low at right edge, showing a blank teal card. 5. Rueful grin and a shrug, map in one hand; Ghost shrugs too. 6. Map folded under his arm, pointing firmly to viewer's left; Ghost points the same way. 7. Beckons us toward the left with a curled hand, smiling at us; Ghost waves its card goodbye. 8. Thumbs-up at chest height, folded map under his arm, relaxed; no cameo.

### No Spoilers ★

- **With:** Agile Sticky (small yellow note, drawn whole, standing on the floor at the right edge, below Amr's waist; beats 3-8; its look is not in the repo, so confirm the colour against its model sheet)
- **Story:** Sticky is bursting to give the ending away, so Amr hushes it and crosses his fingers while the reader chooses; when the panel shows, both are surprised, Amr laughs at his own missed guess and they clap for the story, whatever the reader picked.
- **Plays when:** /comics?ep guess (src/app/(tools)/comics/components/story-guess.tsx): question scrolls into view -> beats 2-4 (once per story); useStoryGuess.choose -> 5, then 6 as the last panel reveals; picked === guess.happened -> 8 (he applauds the reader); picked differs -> 7 (he missed too); skip ('Just show me') -> 6 only. Needs a new hook: queueReaction from useStoryGuess; nothing plays there today.
- **Review:** Real feature, nothing plays there. But choose() reveals instantly, so fingers-crossed has no wait; branching on picked === happened breaks guess.ts 'no right or wrong'. Fix: play 5 before the pick, one ending for any pick; give Sticky three bold silhouettes only, hip-anchored. (new 3, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Upright, head turned to viewer's left, hand at chin, weighing his own guess; no cameo. 3. Looks down right, eyebrows up; Sticky stands whole at right floor edge, arm raised, bursting to tell. 4. Finger to his lips, conspirator's smile toward Sticky; Sticky claps both hands over its mouth. 5. Fingers crossed on both hands at his chest, eyes fixed left; Sticky on tiptoe, mouth still covered. 6. Mouth open in happy surprise, open palms at shoulder height; Sticky flings both arms wide. 7. Laughs at himself, one hand on the back of his neck; Sticky gives a small kind shrug. 8. Soft applause toward us, warm grin; Sticky claps along at the right floor edge.

### Curtain Call ★

- **With:** Ahwa Cup and Agile Sticky: both whole, side by side at the right edge, knee-high, together inside 96 by 120 px; ruby-red tea and bright yellow, never brown or tan
- **Story:** On a milestone read (a new streak week or every fifth story, from the total and weekStreak ReadTracker already has), Amr steps forward, beckons Ahwa Cup and Agile Sticky in together from the right wing, bows his head beside them as they stand still and unchanged, and hands the applause to the reader.
- **Plays when:** /comics story end: ReadTracker's counted read after 8 s, which today queues only the 'excited' jump.
- **Review:** Trigger is real (ReadTracker queues 'excited'), but two cameos share 96 px, about 20 px each in the cell, so the tipping bow won't read, and playing at every ending is the overuse canon flags for both. Fix: static cameos entering together; milestone reads only. (new 3, cell 2, cast 3, trigger 5, delight 4)
- **Draft slots 2-8:** 2. Stepping forward, both arms opening wide to us, beaming like an actor after the last scene. 3. Turned toward the viewer's right, beckoning low with one hand toward the empty edge, encouraging. 4. Ahwa Cup stands whole at the right edge, knee-high; Amr presents it with an open palm. 5. Agile Sticky stands beside Ahwa Cup at the right edge; Amr applauds them, looking down fondly. 6. Hand on his heart, a shallow bow of the head; both cameos tip forward at the right edge. 7. Upright, both hands held out to us, palms up, grateful smile; both cameos whole at the right edge. 8. A small goodbye wave; Ahwa Cup and Agile Sticky side by side, whole, at the right edge.

### Ask the Hedgehog

- **With:** Silo Hedgehog (look not in the repo; dark or brown spines need the masked cameo group)
- **Story:** When the consent card appears Amr stays upright, opens both palms to ask and then waits with his hands behind his back while the Hedgehog sits curled around its blue box at the right edge; on "Agree and ask" the Hedgehog uncurls and holds up one white card as Amr bows with a matching card at his chest, and on "Not now" Amr gives a small understanding nod while the box stays shut.
- **Plays when:** The visitor AI consent card appearing (SRC\components\agent\mascot\visitor-ai-consent.tsx; nothing plays today). Needs a new hook: consent card shown.
- **Review:** Canon fits (Hedgehog guards confidential information), but Amr grabbing first contradicts a card that sends nothing before agreement, and the handover pre-plays the visitor's yes. Leaning reaches break hip alignment and clearance. Fix: Amr only asks and waits; handover on Agree, nod on Not now. (new 4, cell 2, cast 4, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Hedgehog sits whole at the right edge, knee-high, paw on a blue box; Amr spots it, delighted. 3. Amr leans toward the box, one hand reaching down, eager helpful grin; Hedgehog, right edge, stiffens. 4. Hedgehog, right edge, curled into a spiky ball around the box; Amr pulls his hand back, startled. 5. Amr stands straight, both palms open at his chest, apologetic asking smile; Hedgehog, right edge, still curled. 6. Hedgehog, right edge, half uncurled, peeking over the box lid; Amr waits, hands behind his back. 7. Hedgehog, right edge, holds up one white card from the open box; Amr reaches down gently. 8. Amr holds the card to his chest, a small bow; Hedgehog, right edge, relaxed beside its closed box.

### Ghost Paper Trail

- **With:** Data Ghost (white, hovering; look not in the repo; white is safe and a hovering cameo stays out of the floor and feet measurements)
- **Story:** Amr opens a purple folder toward us and finds it empty, a pale-blue Data Ghost hovering knee-high at the left edge points at the gap, the two share one shrug, and Amr holds the open folder out to us inviting other words (four beats, about 3.5 s), while the three spare poses (Ghost peeks in, Amr closes the folder, both wave) play as a separate short offline and back-online scene.
- **Plays when:** Guide search with no match (today a shrug). It would also suit page.ts `offline` (today downcast).
- **Review:** Real trigger, but the story contradicts it: nothing was found, yet Amr presents an answer and ends relieved. Seven four-element beats run 7 s per failed query; an outline-free white Ghost and white card fade on the light theme. Fix: four honest beats, pale-blue Ghost. (new 3, cell 2, cast 4, trigger 4, delight 2)
- **Draft slots 2-8:** 2. Amr presents a blue card to us in one hand, pleased, other hand on his hip. 3. Data Ghost hovers whole at the left edge, knee-high, pointing up at the card; Amr looks down. 4. Amr has turned the card to its blank white back and blinks at it; Ghost, left edge, waits. 5. Ghost, left edge, shrugs with both arms wide, eyes away; Amr tilts his head, open palm asking. 6. Ghost, left edge, holds up a small purple folder in both arms; Amr's eyebrows lift, relieved. 7. Amr slides the card into the purple folder in his hands; Ghost, left edge, watches, arms folded. 8. Amr hugs the folder to his chest, nodding down at the Ghost; Ghost, left edge, waves.

### Owl's Last Look

- **With:** Perfectionist Owl (look not in the repo; white, grey or purple is safe, brown needs the masked cameo group)
- **Story:** When a form that was refused earlier finally goes through, Amr holds a white card out to us, the Owl (drawn whole, knee-high at the right edge, in a masked cameo group) leans in wide-eyed and taps a wing toward its bare corner, Amr presses a big blue sticker onto it, and as he hands the card over the Owl covers its face with a wing, one big eye still showing.
- **Plays when:** The stuck offer when a form refuses its input twice (ENG\interactions\intent.ts; today the concerned face and "Need a hand?").
- **Review:** Trigger is real (two invalid events call stuck()), but the form is still refusing then, rage taps share the route, and 7 s buries 'Need a hand?'. Lens and dot vanish at 48 px. Fix: play on submit after refusals; five beats, no lens. (new 3, cell 2, cast 4, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Amr holds a white card out toward us in both hands, about to hand it over, bright smile. 3. Owl stands whole at the right edge, knee-high, one wing raised to stop him; Amr pauses, glancing down. 4. Amr lowers the card to hip height; Owl, right edge, studies it through a small round lens. 5. Owl, right edge, points a wingtip at the card's bare corner; Amr peers at it, eyebrows up. 6. Amr presses a small blue dot onto the card's corner, tongue out; Owl, right edge, nods, lens lowered. 7. Owl, right edge, lifts the lens again; Amr hugs the card to his chest, a pleading smile. 8. Amr hands the card toward us; Owl, right edge, covers its eyes with a wing, peeking through.

### Real Case

- **With:** Dependable Beaver (cameo: whole figure, knee-high, on Amr's floor line at the left edge, clear of him, slots marked hip; brown is on the avoid list, so this sheet needs the masked cameo group). Props: a short blue ruler; a small red box.
- **Story:** As a pastime on the Definition of Done Builder page, Amr raises his short blue ruler, sure of his neat rule, while Beaver at the left edge holds up a small red box that never leaves Beaver's hands (box low, then box high, the only two Beaver poses), and Amr, staying upright and clear of him, glances down, frowns at the ruler, scratches his head with it, tucks it under his arm and ends on a thumbs-up to Beaver's nod.
- **Plays when:** A tool action logged as failed or rejected (the WENT_WRONG set in src/lib/agent/mascot/use-tool-reactions.ts), today a downcast face.
- **Review:** Canon-true, but WENT_WRONG only matches impediment_raised, whose two tools already play scenes, and a failure isn't 'rule meets case'. Box changing hands breaks one-size props; Beaver's four poses are unreadable at 50 px. Fix: DoD Builder pastime, box stays with Beaver, two Beaver poses. (new 4, cell 2, cast 4, trigger 2, delight 3)
- **Draft slots 2-8:** 2. Amr holds a short blue ruler up like a wand, chin high, certain. No cameo. 3. Amr glances down; Beaver, whole and knee-high at left edge, lifts a small red box. 4. Amr leans slightly, ruler held out toward the box, still confident; Beaver whole at left edge, steady. 5. Amr straightens, frowning at the ruler, puzzled it does not fit; Beaver at left edge, waiting kindly. 6. Amr scratches his head with the ruler, sheepish; Beaver, whole at left edge, holds the box higher. 7. Amr turns the red box in both hands, ruler under his arm; Beaver at left edge, empty-handed, pleased. 8. Amr gives a thumbs-up down to Beaver, box in his other hand; Beaver, whole at left edge, nods.

### Mouse's Small Test

- **With:** Experiment Mouse (look not in the repo; white or light grey is safe)
- **Story:** Amr holds up a blue card as his guess, the light-grey Mouse at the right edge opens its single red box on a bright yellow ball, and Amr laughs, turns his card to its yellow side and shows it to us, surprised rather than wrong, while the Mouse closes the lid.
- **Plays when:** /comics?ep guess: an ending is picked and the last panel reveals (no reaction today). Needs a new hook: guess revealed, beside ReadTracker's `excited` in SRC\app\(tools)\comics\components\story-actions.tsx.
- **Review:** Real feature, new moment, but the gag hangs on a white ball, lid and two boxes in a 48 px cameo strip; Amr's half repeats S55's card flip; guess.ts says no right or wrong. Fix: one box, yellow ball, yellow-backed card; hook in story-guess.tsx choose(). (new 3, cell 2, cast 3, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Amr holds a card high in one hand, blue side out, chin up, sure of himself. 3. Mouse stands whole at the right edge, knee-high, pushing a closed red box forward; Amr glances down. 4. Amr bends his head to look, card lowered to his chest; Mouse, right edge, paws on the lid. 5. Mouse, right edge, lifts the lid on a white ball; Amr's eyebrows shoot up, mouth rounded. 6. Amr laughs at himself, hand behind his neck; Mouse, right edge, already offers a second closed box. 7. Amr turns his card to its white side for the Mouse; Mouse, right edge, lowers the second box. 8. Amr shows us the card's white side, easy smile; Mouse, right edge, sits on its boxes, thumbs up.

### Level Voices

- **With:** HiPPO (cameo: whole figure, knee-high, at most 120 px tall with its sign, standing on Amr's floor line at the right edge, clear of him, slots marked hip; keep it grey-purple, never tan). Props: four blank speech-bubble signs on short sticks in purple, blue, red and yellow.
- **Story:** On a planning-poker reveal (votes_revealed, already emitted), Amr holds three level speech-bubble signs, takes a purple fourth from HiPPO (whole at the right edge in the first and last frames only, its sign held low), starts to lift it above the rest, catches himself, sets it level and nods to HiPPO.
- **Plays when:** /comics?ep guess: the last panel reveals with the readers' split (no reaction today).
- **Review:** Guess reveal has no mascot hook; its split shows unequal bars and most stories lack HiPPO. Four frames repeat; HiPPO raising a same-size sign exceeds 120 px and skews the hip anchor. Fix: planning poker's votes_revealed, HiPPO in two frames, sign held low. (new 3, cell 2, cast 4, trigger 2, delight 3)
- **Draft slots 2-8:** 2. Amr fans three speech-bubble signs level at his chest; HiPPO, whole at right edge, raises a purple one. 3. Amr leans a little, palm out for the purple sign; HiPPO, whole at right edge, offers it up. 4. Amr lifts the purple sign to head height above the other three, impressed; HiPPO at right edge, pleased. 5. Amr glances up at the high sign, eyebrows knitting, catching himself; HiPPO whole at right edge, watching. 6. Amr lowers the purple sign into the fan, tongue out, lining up four; HiPPO at right edge, curious. 7. Amr shows us four signs at one height, calm smile; HiPPO whole at right edge, head tilted. 8. Amr nods down to HiPPO, signs level at his chest; HiPPO, whole at right edge, nods back.

## Honest AI (Amr alone)

What the chat is doing, shown as body language. No cameo, so the builder needs no change.

### Thinking First ★★

- **With:** Amr alone (no prop)
- **Story:** Amr raises a finger for "one moment", then for as long as the answer takes he cycles through four still thinking poses facing us (hand on chin with eyes up, arms folded with head tilted, hands clasped behind his back rocking on his heels, tapping his temple), and when the first words arrive his eyebrows lift in a small "got it" and he opens one palm toward us to start talking.
- **Plays when:** Chat turn starts: queueReaction("thinking") in src/lib/agent/mascot/use-chat-reactions.ts, replacing the running row; hold beats 2-5 until the first streamed chunk, then beats 6-7.
- **Review:** Real trigger and gap (thinking plays the running row), but beat 5 needs a walk cycle, beat 6's finger count is lost at 177 px, beats 2 and 7 look alike, and beats after the first chunk delay lip-sync. Fix: loop still poses, short hand-off. (new 3, cell 3, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Index finger raised beside his face, a friendly 'one moment' look, eyes on us. 3. Hand on chin, weight on one leg, eyes up to the viewer's left, thinking. 4. Arms folded, head tilted, eyes up to the viewer's right, lips pressed, weighing it. 5. One slow step to the viewer's left, hands clasped behind his back, looking down. 6. Facing us again, counting on his fingers, one hand tapping two raised fingers, concentrating. 7. Eyebrows up, index finger lifting from his chin, a small dawning smile. 8. Leaning slightly toward us, one open palm forward, mouth just opening, ready to answer.

### Slow Lift ★

- **With:** Amr alone, no props (the lift button is invisible)
- **Story:** After about six seconds of silent thinking Amr calls a slow lift, watches the floors and rocks on his heels in a loop, leans his whole body into a sheepish second press with his face turned to us, then either brightens and ushers the visitor in as the first word streams or, when the service is busy, thumbs toward the stairs (the offline guide) and stops there, at most once a conversation.
- **Plays when:** Chat 'thinking' that runs long (LIB/use-chat-reactions.ts; today the running row), slots 3-4 looping until the first word streams; also upstream_busy and site_busy; needs a new hook: a timer on thinking.
- **Review:** New moment, pipeline-safe (no cameo), `awaiting` and looping holds already exist. But beat 5 equals beat 2 at 177 px, beat 4's tells are tiny, and busy refusals never 'arrive'. Fix: full-body lean for 5, hip-anchor 4, refusals end on the stairs, once per conversation. (new 4, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Pressing an invisible lift button at chest height to the viewer's right with one finger, hopeful. 3. Hands clasped behind his back, chin lifted, eyes up, watching the lift's invisible dial. 4. Rocking back on his heels, toes up, lips pursed in a silent whistle, eyes still up. 5. Leaning to the viewer's right, pressing the invisible button again with his thumb, a sheepish grin. 6. Thumb pointing over his shoulder to the viewer's left, eyebrows raised at us: the stairs? 7. Eyes bright, one finger pointing up, mouth open in a relieved smile: it has arrived. 8. One arm sweeping low toward the viewer's right, a slight bow, a kind smile: after you.

### One Question First ★

- **With:** Amr alone (no prop)
- **Story:** When his reply ends with a question, Amr raises one finger, opens a palm to ask, then leans in with a hand cupped behind his ear and holds there on two breathing frames until the visitor answers, when a hand-on-chin nod replaces the thinking row, and an open-handed 'aha' with a hand-on-heart thank-you plays only once the next reply has landed.
- **Plays when:** needs a new hook: an assistant reply that ends with a question queues the typed-but-never-queued "listening" reaction at turn end in use-chat-reactions.ts (beats 1-4, holding the fourth); the visitor's next message plays beats 5-7.
- **Review:** Real gap: 'listening' is typed, never queued, and no prop-free listening pose exists. But stride beats redraw S10 and play after the question is already on screen; part two collides with 'thinking' at stream start. Cut strides; ask, hold listening, nod; cooldown. (new 3, cell 4, cast 4, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Striding to the viewer's right, arm swinging, chin up, sure of himself. 3. Frozen mid-step, heel off the floor, index finger raised, eyes back toward us. 4. Turned to face us, head tilted, one palm up at chest height, asking. 5. Leaning in, one hand cupped behind his ear, eyebrows up, listening closely. 6. Upright, slow nod, eyes closed for a moment, hand on chin, taking it in. 7. Bright 'aha' face, both hands open, shoulders lifting, he understands now. 8. Striding off to the viewer's left, a thankful look back at us over his shoulder.

### Wrong Way Round ★

- **With:** Amr alone (prop: a flat blue arrow paddle on a short white handle, no writing)
- **Story:** On a real tool miss (bad input, unknown tool or handler error, never a Deny, a cancel or an unavailable tool) Amr holds his arrow the wrong way with full confidence, doubts it, rubs his neck and raises a hand to own it; only if the retry in the same turn then succeeds does he turn the arrow round, hand on heart, and offer the corrected way.
- **Plays when:** Chat tool error: the is_error tool_result branch in use-chat-reactions.ts, replacing headShake.
- **Review:** The is_error branch also fires when the visitor presses Deny, closes the panel or a tool is unavailable, and the scene shows a fix before any retry succeeds. Filter to real misses, split into a miss scene and a put-right scene, once per turn. (new 3, cell 4, cast 4, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Holding a blue arrow paddle pointing to the viewer's left, chest out, confident grin. 3. Glancing sideways at the arrow, smile fading, one eyebrow up, doubtful. 4. Eyes wide, free hand to the back of his neck, sheepish, arrow lowered. 5. Free hand raised high, palm open, owning it, an honest 'my mistake' face. 6. Both hands turning the arrow paddle round to point to the viewer's right, careful. 7. Hand on heart, small apologetic nod, arrow now pointing right at his side. 8. Holding the corrected arrow out toward us, pointing right, a relieved, modest smile.

### Honest Limit ★

- **With:** Amr alone (prop: a clear jar with a teal lid and one big blue marble)
- **Story:** Only when an allowance is truly spent (the visitor's or the site's daily or busy-hours limit, or the owner's rate limit) and the refusal has landed, Amr tips the last blue marble out of an open, lidless jar, shows us it is empty, says so with a hand on his heart, then points to the guide that still works.
- **Plays when:** The `limited` effect in use-chat-reactions.ts (owner rate limit, visitorQuota remaining 0, visitorFallback back to the offline guide; refusals visitor_limit, slow_down, round_limit), replacing the single concerned face.
- **Review:** Real, underserved trigger, but overclaimed: slow_down and round_limit only set error; visitorFallback also covers disabled and site_busy, where an empty jar is untrue; quota 0 arrives with the last good answer. Play only on spent-allowance refusals; drop the lid (prop must stay identical). (new 3, cell 4, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Holding up a clear jar with one big blue marble inside, peering in, lips pursed. 3. Jar in one hand, the last blue marble held up between finger and thumb. 4. Empty jar turned upside down over his open palm, eyebrows raised, nothing falls. 5. Showing us the empty jar at arm's length, an honest, apologetic small smile. 6. Jar tucked under one arm, other hand on his heart, a small sorry nod. 7. Jar under his arm, free arm pointing to the viewer's left, face brightening: another way. 8. Jar under his arm, a gentle wave with his free hand, warm smile.

### Short Version ★

- **With:** Amr alone (props: a long white zigzag fold-out leaflet with plain grey lines, never touching the floor; one small blue card)
- **Story:** Amr proudly unfolds a tidy white leaflet that keeps concertinaing down to mid-shin, sees it is too much, sheepishly gathers it up, presses it flat to palm size, tucks it under one arm and opens his free hand to us, inviting the next, smaller ask.
- **Plays when:** Chat refusals "answer was cut short" and "ran out of room thinking" (src/lib/agent/client.ts), today one concerned face.
- **Review:** Trigger real but visitor-only, arriving as a plain error string; hook needs an error kind. Leaflet gag is fresh, canon-true, but the card ending promises a short answer the chat never sends and reads tiny. Drop card and pocket beats; end on an open-hand invitation. (new 3, cell 3, cast 4, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Holding a folded white leaflet open at chest height, chin up, proud presenter's smile. 3. Leaflet concertinaed open down to his waist, one finger raised, eyes closed, pleased with himself. 4. Leaflet now hanging to his shins in zigzags, looking down at it, eyes wide. 5. Sheepish grimace at us, gathering the zigzag paper back up in both arms. 6. Leaflet folded flat and tucked under one arm, other hand searching his trouser pocket. 7. Drawing one small blue card from the pocket, relieved smile, leaflet still under his arm. 8. Offering the small blue card to us in one open hand, leaflet under his arm, modest smile.

### Before It Leaves ★

- **With:** Amr alone (prop: a sealed purple envelope, no writing)
- **Story:** Amr holds the visitor's purple envelope at his chest, points to where it would go, then waits calmly with it in both hands; on yes he thanks them, lets it go and watches it leave empty-handed, on "Not now" he hands it back with a warm smile, and the same wait plays whenever he asks before changing a tool.
- **Plays when:** Visitor AI consent card shown (src/components/agent/mascot/visitor-ai-consent.tsx, nothing plays today): beats 1-5, holding the fifth; "Agree and ask" pressed: beats 6-7.
- **Review:** New story, real trigger (visitor-panel consent mode), but seen once per browser; slots 2/6 and 3/5 duplicate, 7 echoes nps.thanks, and 'send' with envelope in hand doesn't read. Fix: merge those, add a warm 'Not now' beat, release like ship.launch, reuse for approval waits. (new 3, cell 3, cast 3, trigger 4, delight 3)
- **Draft slots 2-8:** 2. Sealed purple envelope held flat to his chest with both hands, protective, kind face. 3. Envelope raised beside his shoulder, free hand pointing at it, eyebrows up, asking. 4. Free arm pointing away to the viewer's upper right, envelope kept at his chest, looking at us. 5. Open palm offered toward us, head tilted, envelope lowered to his side: 'may I?' 6. Envelope held in both hands at his waist, standing still, patient small smile, eyes on us. 7. Hand on heart, grateful nod, envelope held up in the other hand. 8. Arm stretched to the viewer's upper right, envelope at his fingertips, glancing back at us, smiling.

### Pen Handed Back ★

- **With:** Amr alone (props: a chunky blue marker; a white card with three grey lines, no writing)
- **Story:** While the Approve card waits, Amr holds the lined card toward us with the blue marker poised; on Approve he writes one line, looks up, lays the marker on his open palm beside the card and offers both, then stands back with empty clasped hands, and on Deny he tucks the card under his arm with an easy nod instead of a head-shake, each played once when the turn ends.
- **Plays when:** Chat tool result success for a tool that wrote into the visitor's tool after Approve (the nod branch in use-chat-reactions.ts; src/components/agent/chat/confirm-card.tsx).
- **Review:** Real trigger, safe solo footprint, but beats 5-7 are one offer drawn three times (grip-first is unreadable on a 30 px marker) and beat 2 is S89's charter.write. Merge them, add the approval wait and Deny, play once at turn end: reactions mute talking. (new 3, cell 3, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Writing on a white card resting on his forearm with a chunky blue marker, focused. 3. Marker lifted off the card, looking up at us, a thought crossing his face. 4. Card turned to face us in one hand, three grey lines showing, marker lowered. 5. Marker flipped in his fingers so its grip end points toward us, small smile. 6. Marker held out to us at arm's length, grip first, card in the other hand. 7. Card and marker both offered forward on open hands, an encouraging nod. 8. Hands empty and clasped in front, standing back on his heels, attentive, proud of us.

### Hands Off Live

- **With:** Amr alone (no prop)
- **Story:** Amr reaches in to help, catches his own wrist with a sheepish smile, shows his empty hands, clasps them behind his back, turns his eyes away from the room to us, rocks up on his toes, and ends with one open palm offered to the visitor, inviting a question.
- **Plays when:** Chat inside a visitor live room when src/lib/agent/client.ts shows LIVE_ROOM_NOTE ("Amr uses no tools while you're in a live room."), replacing the concerned face.
- **Review:** Trigger real but rare: live rooms offer no tools, so LIVE_ROOM_NOTE fires only on a stray call or a room opening mid-turn. Peering at the room contradicts 'reads nothing from the board'. Fix: face the visitor, and also play when chat opens in a room. (new 3, cell 4, cast 2, trigger 4, delight 3)
- **Draft slots 2-8:** 2. One hand reaching forward at chest height, eager helpful face, leaning in. 3. Catching his own reaching wrist with the other hand, a sheepish 'oops' smile. 4. Both open palms raised at shoulder height, empty hands shown to us, friendly. 5. Hands clasped behind his back, standing tall, a calm, content smile. 6. Hands behind his back, leaning to the viewer's left, watching with bright curious eyes. 7. Hands behind his back, up on his toes, eyebrows raised, delighted by what he sees. 8. One hand out for a small thumbs-up at his chest, the other still behind his back.

### Clean Slate

- **With:** Amr alone (props: a teal-framed white hand board with three coloured dots, red, blue and yellow; a blue cloth)
- **Story:** Once the clear truly forgets him and the page has reloaded, Amr holds up a teal-framed white board with three big coloured dots, raises a blue cloth with a questioning nod, wipes them away in a two-frame swipe, shows the blank face at arm's length, tucks the board under his arm and gives a fresh first-time wave that also serves as the missing first-visit hello.
- **Plays when:** Your data: "clear this browser" confirmed (no reaction today); needs a new hook: play it on confirm, before the clear takes effect.
- **Review:** Real moment, but on this branch the clear never removes mascot_memory (fix sits unmerged, f7a5b28c), and confirm reloads at once behind an 80% black overlay. Fix: play after reload from a one-shot marker; merge beats 4-5, cut the back-flip, enlarge dots. (new 4, cell 3, cast 3, trigger 2, delight 4)
- **Draft slots 2-8:** 2. Holding a teal-framed white hand board with three coloured dots toward us, a fond look. 3. Looking at us, a questioning nod, blue cloth raised in his other hand. 4. Wiping the board with the blue cloth, two dots gone, calm and willing. 5. Last dot wiped, cloth pressed flat on the board, eyes on his work. 6. Showing us the blank board at arm's length, cloth at his side, an honest face. 7. Board flipped to show its blank back, eyebrows up: nothing kept anywhere. 8. Blank board tucked under his arm, a fresh little wave, as if meeting us anew.

## Site moments with no art today

First visit, the comics, sharing, live rooms, the connection, your data.

### Megaphone Flip ★★

- **With:** Amr alone (prop: a small magenta megaphone with a white rim and a wrist strap)
- **Story:** Amr strides in with a small magenta megaphone held just below his chin, catches our eye and stops, sheepishly turns it round and holds it side-on to his ear as a listening horn, then lets it hang from his wrist strap with both palms open, all in about four seconds so it ends before the day's greeting, with the two horn-at-ear frames drawn as a clearly different lean-in and nod pair that he also holds while the visitor dictates (the "listening" reaction that is typed but never queued).
- **Plays when:** First-ever visit, where helloFor in src/components/agent/mascot/engine/senses.ts gives no hello today (the site has no first-visit tour or greeting).
- **Review:** memory.ts emits arrival 'first', helloFor ignores it. But beats 2/3 and 6/7 are indistinguishable at 177 px, a camera-facing horn reads as a disc, and 7 s collides with the 6 s context greeting. Fix: five beats, profile horn, reuse listening pair for dictation. (new 3, cell 3, cast 4, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Striding in place, chest out, magenta megaphone raised beside his mouth, free finger pointing ahead. 3. Megaphone still up, eyes sliding to us, eyebrows lifting, mouth closing mid-announcement. 4. Megaphone lowered to his chest in both hands, lips pressed, sheepish shrug. 5. Turning the megaphone round in both hands, studying its narrow end, an idea dawning. 6. Narrow end held to his ear, wide end toward us, leaning in, eyebrows up. 7. Same listening horn at his ear, eyes closed, slow nod, free palm open inviting more. 8. Megaphone hanging from his wrist strap, both palms open toward us, quiet attentive smile.

### Panel Hop ★

- **With:** Amr alone; prop: an empty comic panel frame, flat, white with a bold blue edge, shoulder-wide
- **Story:** As the comic intro lifts (or 1.6 s into any first-ever visit), Amr holds a hollow, bold-blue panel frame face-on at his chest and peeks over its top edge, lowers it and lifts one knee over it (slot marked hip), lets it hang from one hand beside his leg with a small ta-da, then tucks it under his arm and waves, with the three spare slots drawn as a repeatable "framing the page" idle for /comics so the sheet is not used once per device.
- **Plays when:** First-ever visit (helloFor in ENG/senses.ts gives no hello today), and the first QR scan when the 3 s poster or 5 s book intro overlay lifts.
- **Review:** Fresh gag for a real gap (Arrival 'first' exists, helloFor ignores it), but he is idling on the page before it plays and a waist-ring frame cannot stay flat. Fix: four face-on beats, hollow blue frame, hip-anchored step-over, started when data-intro lifts, replacing the 6 s greeting. (new 4, cell 2, cast 3, trigger 4, delight 3)
- **Draft slots 2-8:** 2. Holding an empty white panel frame around his waist with both hands, peeking left, curious. 3. Frame lowered to knee height, one knee lifted over its edge, foot off the floor, concentrating. 4. Both feet down outside the frame, which hangs from one hand; arms out, a ta-da grin. 5. Brushing his sleeve with his free hand, the frame resting against his hip, pleased. 6. Holding the frame up at chest height, looking back through it, one eyebrow raised. 7. Frame tucked under one arm, straightening his collar with the other hand, composed. 8. Frame under his arm, a warm open-handed wave to us, big smile.

### First Hello

- **With:** Amr alone (no prop; his own lanyard badge, blank)
- **Story:** Amr spots a newcomer and holds up the badge on his lanyard at chest height, then teaches by doing it to himself: pokes his own cheek, pats his own head, lifts himself by the back of his collar on tiptoe, tips the S63 phone flat in both hands while leaning with it, and ends leaning toward us with open hands as if to say "your turn" (the wave and handshake reuse the existing social and stakeholders.handshake frames).
- **Plays when:** First-ever visit: arrival.kind === 'first' (src/lib/agent/mascot/memory.ts), for which helloFor in engine/senses.ts returns null today -> beats 2-4 then 8 after HELLO_MS; beats 5-6 on the first idle pastime if he has never been touched; beat 7 on phones only, before motion permission is asked. Needs a new hook: a 'first' branch in helloFor.
- **Review:** Trigger real (arrival 'first' is dropped in helloFor) and cameo-free, but beat 4 already ships as stakeholders.handshake, beats 2 and 8 re-skin wave/welcome, and the phone mime won't read. Fix: reuse those frames; draw self-pat, back-collar lift, real S63 phone, 'your turn'. (new 3, cell 4, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Spots us: leaning forward a little, eyebrows high, one hand lifting in a small surprised hello. 3. Lifts the blank badge on his own lanyard toward us, pointing at it with his other hand. 4. Offers a handshake straight toward us, arm extended, warm direct smile. 5. Pokes his own cheek with one index finger, winking at us, playful. 6. Pinches his own collar and lifts, up on tiptoe as if picking himself up, cheeky grin. 7. Mimes holding a phone flat in both empty hands and tips it sideways, leaning with it. 8. Easy stance, open palm sweeping toward viewer's left, inviting us to look around.

### Same Here ★★

- **With:** Amr alone (props: a small red plush heart; a teal card album; one white-edged card with a plain purple face)
- **Story:** On a "Yes, I've seen this" tap Amr half-raises a sheepish hand, lifts it high with a front-facing sideways glance, then drops it with a relieved laugh; on a heart press he catches a small red plush heart and tucks it into his shirt pocket with a pat; and when a finished story adds a colleague to "Cast met" he studies a purple card and slots it into his teal album.
- **Plays when:** /comics story: 'Seen this at work?' tapped (comics/components/seen-at-work.tsx) -> beats 2-3, readers' count shown -> 4; heart pressed, never on take-back (love-button.tsx) -> 5-6; story counted as read by ReadTracker (story-actions.tsx, today 'excited') when it adds to 'cast met' -> 7-8; /comics home 'Your reading' streak and cast line (reader-progress.tsx) -> 8. Needs a new hook for the two taps and the cast-met change.
- **Review:** On tone; the only sheet answering reader taps. Fix: play 2-4 only on 'Yes, I've seen this', not on the share (hidden under 20 answers); keep his head front-facing; tuck the heart in his shirt pocket, not behind the badge; give ReadTracker cast names. (new 3, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Half-raises one hand, sheepish smile, eyes glancing sideways. 3. Hand high now, head turned over his shoulder, looking for other raised hands. 4. Relieved laugh, shoulders dropping, raised hand flopping down to his side, eyes closed. 5. Catches a small red plush heart in both hands, surprised, eyebrows high. 6. Tucks the heart behind his lanyard badge and pats it, a quiet proud smile. 7. Holds up a white-edged card with a plain purple face, studying it, eyebrows up. 8. Slides the card into a teal album open on his forearm, satisfied nod.

### Borrowed Bubble ★

- **With:** Amr alone; prop: an empty speech bubble, a flat white oval with a blue outline and a short tail, chest-wide
- **Story:** When the unanswered 'Seen this at work?' card comes into view, Amr plucks an empty, long-tailed speech bubble from the air, finds nothing to put in it, shrugs and holds it out to the reader; on their tap he cups an ear, then hugs the bubble to his chest with a pleased nod.
- **Plays when:** /comics story: the 'Seen this at work?' tap (no reaction today); also the typed-but-never-queued 'listening' state while a chat message is written.
- **Review:** Fresh prop, safe white/blue, but the scene invites words after the tap already answered, and typing is when the engine keeps Amr quiet. Beats 3 and 5 are twins; the tail is 8 px. Fix: invite before the tap, receive after; longer tail. (new 4, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Reaching up to the viewer's left, plucking an empty white speech bubble from the air, surprised. 3. Bubble held beside his shoulder, tail at his mouth, mouth open to speak, eyes unsure. 4. Turning the bubble over in both hands at chest height, peering at its blank face, puzzled. 5. Giving the bubble a gentle shake beside his shoulder, head cocked toward it, one eyebrow up. 6. A small shrug, the bubble under one arm, a sheepish smile at us. 7. Holding the bubble out to us in both hands, its tail pointing our way, eyebrows raised. 8. Bubble hugged to his chest, head tilted, one hand cupped behind his ear, listening warmly.

### Paper Plane ★

- **With:** Amr alone (prop: one white paper sheet that becomes a white paper plane)
- **Story:** Amr holds up a white paper plane, sends it up and to the right from a bent arm, then watches it go with hands on hips and a small wave; when a kudos card or room invite is opened from its link, he catches a plane beside his shoulder, peeks inside it with eyebrows rising, and beckons the newcomer in with the plane tucked under his arm.
- **Plays when:** Sharing a link: Share or copy-link on a story (comics/components/story-nav.tsx), a sent kudos card (kudos/components/kudos-sent.tsx) or a room invite (collab/session-share-modal.tsx, visitor-room-chip.tsx) -> beats 2-5, in place of the copy thumbsUp from page.ts onCopy; arriving by a shared link, /kudos#k= card opened from its link -> 6-8. Needs a new hook: share completed, and link arrival.
- **Review:** Send half repeats S57's rocket arc; folding and unfolding look alike at 177 px; a sideways full-arm throw overruns the slot. Share buttons fire no copy event, story links carry no arrival mark. Fix: throw up-right, drop the fold, greet only kudos-card and room arrivals. (new 3, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Folding a white paper sheet at his chest, brows knit, focused. 3. Holds the finished white paper plane up between finger and thumb, proud smile. 4. Throws toward viewer's right, arm fully extended, the plane just leaving his fingertips. 5. Hands on hips, watching to the right after it, hopeful smile. 6. Reaches up and catches a white paper plane with both hands, surprised, eyebrows high. 7. Unfolds the plane into a sheet, reading it, eyebrows rising, a smile starting. 8. Open sheet in one hand at his side, the other arm beckoning us in, delighted.

### Tea Round ★

- **With:** Amr alone; props: a round silver tray and small clear glasses of ruby-red tea
- **Story:** When the first guest joins the host's live room, Amr beckons them in, counts heads by pointing, carries in a round silver tray of three large glasses of red tea, offers it to the side and then to us with a hand on his heart, spots the one glass left, and raises it with the empty tray tucked under his arm.
- **Plays when:** Live room, host: the room opens and the first guest joins (no reaction today; only vote reveals have scenes); needs a new hook: room presence to queueReaction.
- **Review:** Real moment: member-join already reaches Amr's moment bus, only filtered out. But tray carry/offer, hand-on-heart and cheers repeat S33 and S93, and four tiny glasses blur at 177 px. Use three larger glasses, merge the doubled carry and offer beats, add a beckoning welcome. (new 3, cell 3, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Counting heads on raised fingers, looking off to the viewer's left, lips pursed, thoughtful. 3. Carrying a round silver tray of four small tea glasses in both hands at waist height, careful. 4. Tray balanced on one palm at chest height, free hand steadying a glass, tongue out. 5. Offering the tray out to the viewer's left with both hands, a host's warm smile. 6. Tray on one palm held toward us, other hand on his heart: please, take one. 7. The empty tray tucked under one arm, the last glass raised toward us, eyebrows up. 8. The empty tray hugged flat to his chest with both arms, a contented nod, eyes closed.

### Room Host

- **With:** Amr alone (props: three spare lanyards, blue ribbon with a blank white badge)
- **Story:** As the usher for the visitor's own room, Amr holds up one bundle of blue spare lanyards and beckons when the room opens, offers a lanyard with both hands to the first arrival (then at most once a minute, never on leaves or votes), counts the bundle in his hand when the room is nearly full, and gathers them over his shoulder with a two-finger salute when the host confirms End room.
- **Plays when:** Live room, host side (none today beyond vote-reveal scenes). Needs a new hook: host room events -> queueReaction. Room opens -> beat 2; someone joins -> 3; someone leaves -> 4 (the joins and leaves src/components/collab/visitor-room-chip.tsx already announces); votes still arriving -> 5; 'All votes in' (planning-poker/session-screen.tsx announce) -> 6; End room confirmed -> 7-8.
- **Review:** Real gap; events exist (chip join/leave, 'All votes in', End room). But joins trickle and presence flaps, so beats 3-4 nag; beat 6 lands seconds before Reveal and crowds poker.reveal (4 s gap). Door mime, finger-counting don't read. Cut vote beats, debounce joins, skip leaves. (new 4, cell 3, cast 3, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Pulls an invisible door open to viewer's right, three blue spare lanyards over his forearm, welcoming. 3. Offers one blue lanyard with a blank white badge toward viewer's right, both hands, eyebrows up. 4. Small goodbye wave to viewer's right, a returned blue lanyard dangling from his other hand. 5. Counts raised fingers of one hand with the other index finger, lips pursed, eyes sideways. 6. Both arms raised wide in a clear 'all in' signal, palms out, pleased, lanyards on forearm. 7. Gathers all three lanyards into one hand, looking down at them, content. 8. Lanyards hung over one shoulder, a two-finger salute to viewer's right, tired happy smile.

### Loose Cable ★

- **With:** Amr alone (prop: a thick blue cable in two halves, ending in a big white plug and a big white socket)
- **Story:** Amr finds his blue cable has come apart, shows us the two loose ends with a calm shrug, slings it over one shoulder and waits with his hands in his pockets, then, the moment the connection returns, pushes plug into socket at his chest and holds up the joined cable with a relieved grin.
- **Plays when:** Existing triggers in engine/interactions/page.ts: onOffline (today 'downcast') -> beats 2-4, then 5 as the held pose while offline; onOnline (today 'yes') -> 6-8. No new hook needed.
- **Review:** Real trigger (page.ts offline/online), but a lazy pack can't load once offline and failed packs never retry: preload it in LATER_PACKS; beat 5 needs a new 'offline' hold. Echoes S63's cable-and-socket. Swap the unreadable pocket pat; drape over one shoulder, clear of lanyard. (new 3, cell 4, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Holds a thick blue cable's two loose ends apart, white plug and socket, looking between them, puzzled. 3. Shows us both loose ends, calm shrug, a small reassuring smile. 4. Cable draped round his neck, patting his trouser pocket with a wink: kept safe here. 5. Cable round his neck, hands in pockets, weight on his heels, patient, eyes up. 6. Head turned sharply to viewer's right, eyes wide, grabbing both cable ends. 7. Pushes plug into socket at his chest with both hands, brows set, lips pressed. 8. Raises the joined cable in one fist, big grin, other hand on hip.

### Packed Suitcase

- **With:** Amr alone (props: a small teal suitcase; a blue notebook)
- **Story:** When the backup reminder toast shows, Amr holds out an open teal suitcase; once you download he packs a blue folder of your work, presses it shut and hands it to you; after a restore reloads the page he unpacks it, delighted; and after a clear (once clearing also wipes his notes) he turns out empty hands and gives a polite first-time wave.
- **Plays when:** Your data (src/components/data/your-data-dialog.tsx): backup saved -> beats 2-4; restoreBackup confirmed -> 5 then 3; 'Clear this browser' confirmation open -> 6; cleared, when his own memory and notes go too -> 7-8; backup reminder shown (data/backup-reminder.tsx) -> 2. Needs a new hook: data dialog events; all 'none' today.
- **Review:** Backups never carry Amr's notes (even in open PR #139), so "his notebook" is false. Dialogs sit at z-1000 over him and restore/clear reload instantly. Make the case hold your work, play at the reminder toast and after reload; drop the clear-confirm plea. (new 3, cell 3, cast 3, trigger 2, delight 3)
- **Draft slots 2-8:** 2. Teal suitcase open on his forearm, dropping a blue notebook into it, careful face. 3. Presses the suitcase shut with his palm, satisfied nod. 4. Holds the closed suitcase out to us by its handle, both hands, trusting smile. 5. Suitcase open on his forearm again, lifting the notebook out, delighted. 6. Offers the notebook to us on both open palms, small brave smile, eyebrows asking. 7. Empty hands turned out at his sides, a light shrug, calm face. 8. Head tilted, curious polite smile, a small first-time wave at shoulder height.

### Reader's Key

- **With:** Rubber Duck Analyst (yellow duck, round glasses as on the book cover; drawn whole, on the floor at the right edge, below Amr's waist; beats 6-8 only). Props: a white printed card with one plain blue square; a big red key.
- **Story:** Amr, alone, holds up and taps the white printed card on any poster or kudos scan, pats his empty pockets on the locked VIP page, and on each VIP hub visit finds the big red key, shows it proudly, twirls it at his waist and sweeps an arm low: after you.
- **Plays when:** Print arrivals: first scan at /comics?ep&src=poster|kudos or the book QR, once the 3 s poster or 5 s book intro overlay (z-index 120) lifts -> beats 2-3; /vip locked (src/components/vip/vip-lock-panel.tsx) -> 4; /vip/<key> device unlocked, after the 9 s VIP intro as the hub opens -> 5-8. Needs a new hook: intro overlay closed and VIP unlocked; both are 'none' today.
- **Review:** Intros already show Amr waving and asking, once per device, so seven frames plus cameo masking buy one play. Duck's orange beak, dark glasses and the key entering its columns endanger the builder. Fix: Amr alone; fire on every print scan and VIP hub visit. (new 4, cell 2, cast 3, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Holds a white printed card with one plain blue square, looking from it to us, recognising. 3. Taps the card with one finger, delighted grin at us, eyebrows up. 4. Card under his arm, patting both trouser pockets, apologetic half-smile: no key yet. 5. Holds a big red key out at chest height, proud; no cameo. 6. Lowers the key to the right; Rubber Duck Analyst stands whole at right floor edge, inspecting it. 7. Duck nods, one wing raised in approval; Amr grins, key ready at his waist. 8. Stands tall, free arm sweeping low to viewer's left, after you; Duck sweeps a wing too.

### Park It

- **With:** Amr alone (props: a magenta ball; a clear jar with a blue lid)
- **Story:** When unfinished stories are sent back to the backlog or a retro action is carried over, Amr hugs one leftover magenta ball, reluctant to let go, then drops it into an open pale-blue jar, presses the lid on, pats it 'later' and turns back to us, bright again.
- **Plays when:** needs a new hook: sprint closed with leftovers moved on (Close sprint plays scene:ship regardless today).
- **Review:** Sprint leftovers are unfinished commitments, not a shiny toy, and the hook would replace Close sprint's trophy. Bind instead to stories_returned and action_carried_over (logged today, no scene); cut to five beats; keep the jar lidless until the lid beat; ball-into-container echoes S98. (new 3, cell 4, cast 3, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Bouncing a magenta ball on one palm, eyes following it, delighted and distracted. 3. Hugging the ball to his chest with both hands, guilty sideways glance at us. 4. Ball held up in one hand, clear blue-lidded jar in the other, weighing them. 5. Dropping the ball into the open jar held at his waist, tongue out, careful. 6. Pressing the blue lid onto the jar with a flat palm, satisfied nod. 7. Jar tucked under one arm, patting it kindly, a 'later' look. 8. Jar under his arm, free hand gesturing forward to us, focused and bright again.

### Inked Detour

- **With:** Amr alone; prop: the site's ink pen, an oversized dip pen with a blue barrel and silver nib
- **Story:** Lost on a missing page, Amr rubs his neck, pulls a forearm-length blue ink pen from behind his back, sweeps a short stroke up and to the viewer's left close to his body while the site inks the line, squints along the upright pen at chest height, grins sheepishly at a blue ink dab on his fingertips, twirls the pen and gives a thumbs-up with it held at his hip, after which the engine's existing directional point shows the links; a tool crash plays only the sheepish and thumbs-up frames.
- **Plays when:** not-found (the inked 404 map) and 'This tool hit a problem': he mounts on both and does nothing today; the site draws his line in its ink style.
- **Review:** Unserved moment, but middle beats echo S79 canvas and S03 pointing. Fix: forearm-length pen, never floor-resting or beyond full reach; swap baked point-left for the engine's directional point; give the crash page its own short cut. Needs a 404 marker and a site-drawn stroke. (new 3, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. Looking around, one hand at the back of his neck, eyebrows tilted, a little lost. 3. Drawing an oversized blue ink pen from behind his back, face brightening with an idea. 4. Arm stretched to the viewer's left at shoulder height, the nib sweeping a stroke, tongue out. 5. Pen held upright at arm's length like a painter measuring, one eye closed, judging. 6. Wiping his cheek with the back of his hand, sheepish, the pen held low. 7. Pen tucked under one arm, his whole other arm pointing to the viewer's left: this way. 8. Pen held upright at his side like a staff, a thumbs-up, an encouraging smile.

## The visitor and Amr

Driven by things the browser already knows: returns, streaks, taps, a shake.

### Caught Practising ★

- **With:** Amr alone
- **Story:** On the first long absence of a day the visitor comes back to find Amr juggling three balls (two alternating frames, eyes on the balls), he freezes with eyes on us, clutches them to his chest, hides them behind his back looking innocent, then owns up by showing one blue ball and waving with it held at his side, while every other return keeps today's plain wave.
- **Plays when:** Back to the tab after more than 2 minutes hidden: visibilitychange in src/components/agent/mascot/engine/interactions/page.ts (AWAY_MS; today a lone wave).
- **Review:** Real trigger (page.ts onVisibility, AWAY_MS) and no sheet tells a 'caught' story. But one still juggling frame won't read as juggling, beats 7 and 8 are near-identical, and it would replay on every return. Fix: two juggling frames, drop beat 8, once a day. (new 4, cell 4, cast 3, trigger 5, delight 4)
- **Draft slots 2-8:** 2. Juggling three balls, blue, red and purple, low at chest height, tongue out, absorbed. 3. Eyes snapping to us, frozen mid-throw, one ball just above his open hand. 4. All three balls clutched awkwardly against his chest with both arms, flustered grin. 5. No balls: both hands behind his back, eyes up and away, lips pursed, innocent. 6. Sheepish smile, one hand bringing a single blue ball out to show us. 7. Warm wave with his free hand, the blue ball held at his side. 8. Blue ball tucked under one arm, other hand resting in his pocket, attentive smile.

### Kept Your Place ★

- **With:** Amr alone
- **Story:** After a week or more away from a browser that still holds saved work, Amr spots the visitor, lights up and waves, hugs the purple folder he kept safe, peeks inside to check it, offers it over in both hands and ends on a thumbs-up.
- **Plays when:** Return after days away: arrival.kind "back" in src/components/agent/mascot/engine/senses.ts (today a wave and "Welcome back"); could also play after a backup restore in Your data.
- **Review:** No folder or return story exists, but poses recombine wave, blow, read, offer. 'back' fires after any two-day gap; restore reloads the page. Fix: gate on daysAway of 7+ and saved work, swap the dust-blow (needs an effect, hints neglect) for hugging the folder. (new 3, cell 4, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Glancing to the viewer's left, a plain purple folder under one arm, unhurried. 3. Double-take toward us: eyebrows high, mouth open, glad surprise, folder still under his arm. 4. Big open wave with his free hand, wide smile, folder under the other arm. 5. Folder held in both hands at chest height, cheeks puffed, blowing across its top edge. 6. Folder open like a book at chest height, peeking inside, a reassured nod. 7. Closed folder offered toward us in both hands, arms extended, warm smile. 8. Thumb up at shoulder height, folder back under his arm, relaxed stance.

### Paper Chain ★

- **With:** Amr alone
- **Story:** On streak day 3 Amr links a red loop onto the end of an eight-loop blue-and-purple paper chain and holds it up to us, and on day 7 he wears that same chain as a garland and offers us its red end.
- **Plays when:** Streak day 3 or 7: arrival.kind "next-day" where helloFor returns "cheer" in src/components/agent/mascot/engine/senses.ts (today a cheer and "N days running").
- **Review:** Trigger is real (helloFor) but fires twice per run, and its caption is Lively-only, so the art must read alone. Chain jumps from short to garland-length; beats 6-8 are near-identical. Fix: one fixed eight-loop chain in every slot, split into day-3 and day-7 scenes. (new 4, cell 3, cast 3, trigger 5, delight 3)
- **Draft slots 2-8:** 2. Holding a short paper chain of blue and purple loops, plus one loose red loop. 3. Tongue out, concentrating, linking the red loop onto the chain's end with both hands. 4. Chain held up at shoulder height in one hand, dangling at his side, proud grin. 5. Chain stretched wide between both hands at chest height, eyebrows up, impressed. 6. Chain draped around his shoulders like a garland, hands on hips, pleased. 7. Offering one end of the chain toward us, the other end still on his shoulder, warm smile. 8. Chain resting around his shoulders, hand on chest, small grateful nod.

### Empty Pockets ★

- **With:** Amr alone
- **Story:** At the bottom of a long page Amr peers past his feet for more, pats his trouser pockets and then his shirt, turns both pockets out with the white linings showing, shrugs sheepishly, stuffs them back with both hands, and ends pointing a full arm straight up while looking at us.
- **Plays when:** End of a long page: atPageEnd in src/components/agent/mascot/engine/interactions/page.ts (today a lone pointUp, once per path, 2-minute cooldown).
- **Review:** Real trigger, new gag, but beat 8 is slot 1's hands-in-pockets stance, a one-pocket tuck is illegible at 177 px, and a thumb reads as 'well done'. Use a low/high two-frame pat, a both-hands tuck, close on a full-arm point up; play once daily. (new 3, cell 3, cast 3, trigger 5, delight 3)
- **Draft slots 2-8:** 2. Bending slightly, peering down past his feet, eyebrows up, searching for more. 3. Patting both trouser pockets, puzzled look at us. 4. Both pockets pulled inside out, white linings showing, eyebrows raised. 5. Big shrug, open palms up, pockets still out, sheepish grin. 6. Tucking one pocket lining back in, eyes on it, unhurried. 7. Thumb pointing straight up beside his shoulder, eyebrows asking, small smile. 8. Hands in his pockets, rocking back on his heels, content smile.

### Tap Back ★

- **With:** Amr alone, no props
- **Story:** The first tap after a seven-tap dizzy makes Amr tap the glass back with one fingertip, knock and cup an ear to it for our answer, and each further tap carries on to another short scene of the family: both palms flat on the glass looking around, then wiping a clear patch with his sleeve (two frames) and waving through it.
- **Plays when:** Ten taps in one burst: ENG/interactions/clicks.ts counts 3 for a tickle and 7 for dizzy; needs a new hook: a tenth-tap step (the site may fog the glass and ink his doodle).
- **Review:** Fresh fourth-wall idea, but tap 10 can't happen (count resets at seven), cuts dizzy, and tap 11 cuts the 7 s scene; breath and doodle need fog/ink in front of him. Fix: three short tap-chained scenes, mime-only: fingertip tap-back, ear to glass, sleeve wipe. (new 3, cell 3, cast 3, trigger 3, delight 4)
- **Draft slots 2-8:** 2. One finger raised toward us, head tilted, a playful 'wait a moment' smile. 3. Leaning in, knuckles raised toward us, knocking on the inside of the screen, eyebrows up. 4. Both palms pressed flat toward us at shoulder height, eyes wide, looking around the glass. 5. One hand cupped at his brow against the glass, peering out at us, squinting. 6. Breathing on the glass: mouth a round O, cheeks puffed, hands on his thighs. 7. Drawing on the glass with one fingertip beside his cheek, tongue out, concentrating. 8. Stepped back, a big open-handed wave at us through the glass, proud grin.

### Careful Fizz ★

- **With:** Amr alone; prop: a plain red drinks can
- **Story:** After a second shake, or a dizzying burst of taps, Amr stares at the red can in his hand, holds it out low at arm's length, gives its top one big tap, leans back facing us with both eyes squeezed shut as he opens it, opens one eye to find nothing happened, laughs with relief and raises the can to us in a toast.
- **Plays when:** A phone shake: createShake in ENG/interactions/sensors.ts, which today only makes him dizzy; play this on a repeat shake (the site may add the fizz).
- **Review:** New, cameo-free, one red prop; shake is real (sensors.ts:558) but phone-only and gated at 6 s, shorter than the scene. Turned-away face and tab/fingertip detail won't read at 177 px. Fix: face stays front, bigger gestures; also fire on the six-tap dizzy (clicks.ts). (new 4, cell 3, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Staring wide-eyed at the red can in his hand, shoulders up: it has just been shaken. 3. Holding the can at full arm's length to the viewer's left, leaning away, wary. 4. Tapping the can's top gently with one fingertip, tongue out, concentrating. 5. Face turned away, one eye squeezed shut, thumb on the can's tab, bracing. 6. Peeking back at the can with one eye open, surprised: nothing happened. 7. A relieved laugh, free hand on his chest, the can held safely low. 8. Raising the can toward us in a small toast, a cheerful wink.

### Player Two ★

- **With:** Amr alone; props: two identical chunky light-grey game controllers with red and blue buttons
- **Story:** The secret code (or an idle moment) makes Amr pull out a chunky light-grey controller, notice us and hold a second one out; tap him while he offers it and he plays his side of the round, leaning into each turn and mashing the buttons, then punches a fist up for the win we shared.
- **Plays when:** The Konami code: installKonami in ENG/customization/commands.ts (mounted in mascot-assistant.tsx), which today plays only a spin and a rainbow aura sweep.
- **Review:** Trigger is real (installKonami, mounted) and the controller is new, but the code needs a keyboard on a phone-first site and 'your turn' leads nowhere. Fix: offer first; a tap on him (scene-taps follow-up) plays the round; also list it in PLAY_SCENES. (new 4, cell 4, cast 3, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Pulling a chunky light-grey game controller from behind his back, eyebrows up, a sly grin. 3. Both thumbs on the controller at chest height, leaning hard to the viewer's left, tongue out. 4. The same grip, leaning hard to the viewer's right, eyes wide, elbows up. 5. Knees bent, controller pulled close, mashing the buttons, teeth gritted. 6. One fist punched high, the controller in his other hand, a winning shout. 7. Noticing us: a second identical controller held up in his free hand, eyebrows raised. 8. Offering the second controller toward us at arm's length, a warm grin: your turn.

### Rescue Ring

- **With:** Amr alone (prop: a red-and-white life ring)
- **Story:** Amr lunges in with a red-and-white life ring, freezes when he sees nobody is drowning, tucks it sheepishly under one arm and offers an open hand just as the "Need a hand?" bubble appears, then leans in to listen; if the form later goes through, he lifts the ring overhead in a small cheer and gives a thumbs-up.
- **Plays when:** The stuck offer in src/components/agent/mascot/engine/interactions/intent.ts (rage taps or a refused form, "Need a hand?"), today one concerned face.
- **Review:** Real trigger (intent.ts stuck: concerned face, then 'Need a hand?') and canon-true: reflex corrected, no hero. But beats 2/3 and 6/8 read alike at 177 px and 7 s delays the offer. Fix: four beats, ring under his arm, spare slots for a form-sent payoff. (new 4, cell 3, cast 4, trigger 4, delight 4)
- **Draft slots 2-8:** 2. Lunging in place, red-and-white life ring held up beside his head in both hands, alarmed. 3. Frozen mid-throw, ring still raised, eyes on us, eyebrows up, mouth a small o. 4. Ring lowered to his chest, shoulders dropping, sheepish half smile. 5. Slipping the ring over one shoulder like a bag, eyes still on us. 6. Ring on his shoulder, leaning in slightly, head tilted, one palm open, asking. 7. Hands clasped at his waist, ring on his shoulder, waiting patiently, soft smile. 8. One open hand offered toward us, ring on his shoulder, warm unhurried nod.

### Making Room

- **With:** Amr alone
- **Story:** As he slides off a control, Amr squeezes narrow on tiptoe, then gives an apologetic glance and offers the spot he just left (drawn to the viewer's left, to the right and downward, picked by the direction of the move), ending on a small all-yours nod, about three seconds in all.
- **Plays when:** When mascot-nudge moves him off a control (src/components/agent/mascot/mascot-nudge.ts, applied in mascot-assistant.tsx; the move is silent today); needs a new hook: the window made narrower (a resize listener already exists there).
- **Review:** Real, silent moment (useStepAside), but he slides in under 450 ms, usually upward or to the viewer's left, on touch screens only. Seven seconds of preamble blocks the control; fixed left/right poses mismatch. Merge the three narrow twins, add offer directions, play briefly after moving. (new 4, cell 3, cast 3, trigger 3, delight 3)
- **Draft slots 2-8:** 2. Looking down at his feet, eyebrows up, hands lifted: noticing he is in the way. 3. Apologetic smile at us, one palm raised, shoulders hunched. 4. Elbows tucked tight, arms hugged across his chest, feet together, standing very narrow. 5. Turned side-on to the viewer's right, cheeks puffed, breath held in, tall and thin. 6. Sidestepping on tiptoe, one foot lifted, arms still tucked, eyes on where he steps. 7. Both hands sweeping to the viewer's left, offering the cleared space, pleased smile. 8. Standing easy, hands clasped in front, a small nod: all yours.

## Dropped

- **Robot's First Day** (Helper Robot): Second robot sheet beside ChatGPT's AI Reviewer; clap and credit beats repeat S59. MCP writes log no history event, Approve all is owner-only. The hinge, a roughly 12 px card tipping at the cell edge, will not read; the handover breaks the 12 px gap.

Removed earlier as duplicates of a stronger idea in this list: 11 ideas.
