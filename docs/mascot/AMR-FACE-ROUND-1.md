# Amr: face, round 1

Amr's face has drifted away from the original pet's across the sprite sheets. This round brings it back, as **edits of the sheets you already have**: only his face changes, in the slots named, and his hair, head size, skin colour, body, clothes, props and any colleague beside him stay exactly as they are. The face to match is the original pet's (`Amr_Pet_Enhanced.zip`, the art the live sprite `public/mascot/amr.*.webp` was made from), shown in [`reference/ref-face.png`](reference/ref-face.png).

**Status:** superseded on 15 November 2026. The refined releases (`Amr_Refined_Original_124.zip`, every Amr redrawn whole from the approved standing master; see [refined-original-release.json](refined-original-release.json)) replace the art this round was going to edit, so batches A to L are not needed. Batch A came back once (10 November) and was reviewed; the audit and the method below are kept for the record.

## What the audit found

On 10 November 2026 every face that ships was cropped (869 frames from the 124 sheets: S01–S114 and the ten companion scenes N01–N10), enlarged and compared with the original, slot by slot and feature by feature. Each sheet was judged three times, by a reviewer and two independent skeptics, one challenging the flags and one the passes. A slot is in this round when at least two of the three flagged it (386 slots), plus four slots that are the other frame of a flagged two-frame loop (S07 6, S08 3, S14 3 and S62 4), so the loop doesn't jump. A sheet's verdict is the middle of the three.

| Verdict          | Sheets | What it means                                                                                   |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Redraw his face  | 36     | He reads as a different person, or a feature is broken (cartoon eyes, a smeared or melted face) |
| Touch up         | 52     | Clearly Amr, but one or two features drift in the named slots                                   |
| One or two slots | 21     | The sheet matches; one or two slots don't                                                       |
| Matches          | 15     | Nothing to do                                                                                   |

The same drift shows up across the library, most common first:

1. **A short, heavy lower face.** His chin sits a clear step below his mouth and his face tapers to it in a long, gentle curve, ending in a soft U about as wide as his neck. In the sheets the chin is short and blunt, close under the mouth, with full cheeks down to it, so the face reads round. It starts in S01, the sheet every later sheet was drawn to match, and goes furthest in the companion scenes: a ball face wider than his skull, with his features sitting low.
2. **Puffy, chubby cheeks.** His are firm, with rounded apples high under his eyes that lift when he smiles, and flat below them along the jaw.
3. **Big round eyes**, white showing all round the iris, in surprised, excited and talking frames (S01's own surprised and talk-wide faces among them). His are medium-small almonds, even when opened a little wider.
4. **Brows too high, thin or arched.** His sit low and close over his eyes, nearly straight.
5. **Older skin**: heavy crow's feet, creased cheeks and bags, where his is smooth with small creases at the eye corners.
6. **A grey shadow on his upper lip and chin** that reads as stubble. He is clean-shaven. It is in the generated art: the build's skin match moves his chin and his cheeks together (within about 1 point of a\*), so it doesn't make the shadow.
7. **A shorter nose, a narrower smile, shallow smile lines**, and in a few slots a smeared, stretched or lopsided face. A few slots go the other way, with a pointed chin or a long, hollow face; the prompt guards against both.

The companion scenes N01–N10 drifted furthest: every Amr slot in them needs his face redrawn. The core sheets S01–S10 come next (five of the ten to redraw, S01 among them), then the tool sheets S65–S114. The day and weather sheets S11–S64 are mostly close and need touch-ups only.

Not part of this round, because the build already corrects them or earlier rounds did: head size, skin colour, clothes colours and hair. The pack art's softer painted style, without the original's black ink outline, stays as it is too: only the features change.

---

## 1. His face

[`reference/ref-face.png`](reference/ref-face.png) shows the original from the front and six other angles, with each feature written beside it. [`reference/ref-face-fix.png`](reference/ref-face-fix.png) puts the original (TARGET) above six faces from the sheets (NOT THIS), one for each kind of drift.

| Feature    | The original                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Face shape | An inverted egg, longer than wide: broad at the temples and cheekbones, tapering in a long, gentle curve to a soft, rounded U-shaped chin about as wide as his neck, a clear step below his mouth. Not round, puffy or square; not pointed or hollow either |
| Cheeks     | Firm, with rounded apples high under his eyes that lift when he smiles; flat, not puffy, along the jaw                                                                                                                                                      |
| Forehead   | Tall, the hairline receding at both temples (that is his hair, which this round leaves as drawn)                                                                                                                                                            |
| Eyebrows   | Dark, medium-thick, low and close over the eyes; nearly straight with a gentle arch, the outer ends sloping slightly down                                                                                                                                   |
| Eyes       | Medium-small almond eyes, dark brown, natural size. When he smiles, the lower lids lift and crinkle, with small creases at the outer corners                                                                                                                |
| Nose       | Prominent and fairly long: a straight bridge, a broad rounded tip, visible nostrils, close to the upper lip                                                                                                                                                 |
| Mouth      | Wide, its corners about under the centres of his eyes; a thin upper lip, deep smile lines; his smile shows the full upper row of teeth                                                                                                                      |
| Chin       | Rounded, with a soft crease under the lower lip. Clean-shaven                                                                                                                                                                                               |
| Ears       | Large, sticking out, C-shaped, from brow to nose-tip height                                                                                                                                                                                                 |
| Age        | A man around 40, smooth warm skin                                                                                                                                                                                                                           |

---

## 2. The batches

Each batch is one ChatGPT conversation. Its zip (on the Desktop, in `AMR_Face_Round_1`) holds this page, the two references and the batch's sheets.

| Image                                                      | Why                                                                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`reference/ref-face.png`](reference/ref-face.png)         | The face to match, from seven angles                                                                                                                                                                |
| [`reference/ref-face-fix.png`](reference/ref-face-fix.png) | The original (TARGET) above the drift in these sheets (NOT THIS)                                                                                                                                    |
| your `S01-approved.png`                                    | From batch B on: the S01 sheet from batch A, once the face review approves it. Save it under this name, so it isn't mixed up with the old `S01-faces.png`, and add it to each conversation yourself |

**Settings:** 1536 × 1024, transparent background, PNG, high quality, as before. **Attach the sheet you are editing first**, then `ref-face.png`, `ref-face-fix.png` and, from batch B on, `S01-approved.png`. If the image shows a select (brush) tool, open the sheet you are editing in it and paint over his whole face in each slot you are fixing: from just under his hairline (the forehead, not the hair) to a little below his chin, and across his cheeks to a small margin outside his jaw. Leave out his hair, his ears, and any hand, glasses or prop on or in front of his face.

**Order:** A first, alone, and back to Claude for the face review. Once it passes, B, C and the rest in order: they are sorted by how often he's on screen and how far he drifted. Batches K and L can wait.

### Batch A: S01, the face every other sheet copies

Do this one first, on its own. Send it back to Claude when it is done and wait for the face review before you start batch B: every later edit matches it, and the talking frames are its heads.

| Sheet | File            | Slots     | To do  | What's wrong                                                                                |
| ----- | --------------- | --------- | ------ | ------------------------------------------------------------------------------------------- |
| S01   | `S01-faces.png` | all eight | redraw | Round full lower face, broad chin in all; googly white-ringed eyes in 4 and 6, stubble in 6 |

### Batch B: the core sheets

On screen most: talking, pointing, being touched, resting, page moments, waving and walking.

| Sheet | File                 | Slots            | To do     | What's wrong                                                                                                          |
| ----- | -------------------- | ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| S02   | `S02-explaining.png` | 8                | redraw    | Shrug frame: googly white-ringed eyes under high arched brows, round full face                                        |
| S03   | `S03-pointing.png`   | 2, 3, 4, 5, 6    | touch up  | Head-back frame melted and lopsided; turned frames narrow grey-toothed smiles, stubble cast, small nose, puffy cheeks |
| S04   | `S04-touch.png`      | 2, 3, 4, 5, 6, 7 | redraw    | Puffy ball-round faces, wide jaws, stubble shadow round the mouth, age creases; googly eyes in the poke               |
| S05   | `S05-lifted.png`     | 5                | small fix | Flail frame has huge round googly eyes and puffy wide cheeks; other frames match                                      |
| S06   | `S06-balance.png`    | 2, 3, 4, 5, 6, 7 | redraw    | Googly white-ringed eyes in five frames, wide squarish jaw and puffy cheeks, grey stubble round mouth                 |
| S07   | `S07-rest.png`       | 2, 3, 6, 7, 8    | touch up  | Fuller cheeks and broad jaw, grey stubble shadow, an aged yawn face, googly eyes when startled                        |
| S08   | `S08-page.png`       | 2, 3, 4, 5, 6, 7 | redraw    | Warped tilted head, ball-round chubby face, slit eyes and both teeth rows when clapping, grey stubble                 |
| S09   | `S09-social.png`     | 3, 4, 6          | touch up  | Squat, chubby-cheeked faces with broad jaws in slots 3-4; googly round eyes and square jaw in slot 6                  |
| S10   | `S10-stroll.png`     | 5, 6, 7, 8       | touch up  | Slots 5-7: round staring eyes, heavy arched brows, full cheeks; slot 8 face too wide, cheeks puffed                   |

### Batch C: the companion scenes

New this month and drawn with a colleague beside him. His face drifted furthest here, in every slot.

| Sheet | File                           | Slots               | To do  | What's wrong                                                                                                     |
| ----- | ------------------------------ | ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| N01   | `N01-ai-reviewer.png`          | 2, 3, 4, 5, 6, 7, 8 | redraw | Older, chubbier man: puffy jowls, short chin, wrinkles, faint brows, bulbous nose, thin gappy-toothed smile      |
| N02   | `N02-dinosaur-priorities.png`  | 2, 3, 4, 5, 6, 7, 8 | redraw | Cartoon round white-ringed eyes on an older, puffy, squat face; thin brows, blobby nose, thin smile              |
| N03   | `N03-deadline-rabbit-rush.png` | 2, 3, 4, 5, 6, 7, 8 | redraw | Puffy ball/pear face with jowls, round staring or dark-ball eyes, thin teeth band, high thin brows, aged creases |
| N04   | `N04-octopus-overload.png`     | 2, 3, 4, 5, 6, 7, 8 | redraw | Googly or round dark eyes, puffy jowly ball face, broad chin, thin high brows, thin teeth band, creases          |
| N05   | `N05-ahwa-debrief.png`         | 2, 3, 4, 5, 6, 7, 8 | redraw | Puffy pear face with jowls, round white-ringed or googly eyes, high arched brows, forehead and cheek creases     |
| N06   | `N06-sticky-escape.png`        | 2, 3, 4, 5, 6, 7, 8 | redraw | Jowly ball face, broad chin, googly downcast or staring eyes, thin teeth band, heavy ageing creases              |
| N07   | `N07-comic-to-action.png`      | 2, 3, 4, 5, 6, 7, 8 | redraw | Full cheeks, heavy short chin, thin high brows, beady eyes, short nose, thin teeth-strip smile                   |
| N08   | `N08-graceful-retry.png`       | 2, 3, 4, 5, 6, 7, 8 | redraw | Puffy cheeks, short chin and nose, long upper lip, thin brows, staring eyes, tight thin-teeth grin               |
| N09   | `N09-your-decision.png`        | 2, 3, 4, 5, 6, 7, 8 | redraw | Full cheeks, heavy short chin, thin faint brows, beady eyes, short nose, long upper lip, thin grin               |
| N10   | `N10-quiet-companion.png`      | 2, 3, 4, 5, 6, 7, 8 | redraw | Full cheeks, short broad chin, thin faint brows, small staring eyes, googly surprise eyes, thin teeth strip      |

### Batch D: tool sheets to redraw (1 of 2)

| Sheet | File               | Slots               | To do  | What's wrong                                                                                              |
| ----- | ------------------ | ------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| S73   | `S73-links.png`    | 2, 3, 4, 5, 6, 7, 8 | redraw | Googly or beady eyes, thin high brows, broad squat lower face, puffy cheeks, heavy jaw, short chin        |
| S74   | `S74-blocker.png`  | 2, 3, 4, 5, 6, 7, 8 | redraw | Round doll-like face, puffy cheeks, short wide chin; googly or beady eyes; forehead smear in slot 4       |
| S77   | `S77-crystal.png`  | 2, 4, 6, 8          | redraw | Googly round eyes in slots 2 and 4; rounder eyes, broad jaw and narrow smile elsewhere                    |
| S80   | `S80-burndown.png` | 2, 5, 7, 8          | redraw | Googly eyes in 7 and 8, round eyes in 5, broad heavy lower face and ball-round cheer face                 |
| S82   | `S82-cycle.png`    | 2, 5, 7             | redraw | Round googly or staring eyes, high arched brows; full cheeks and blunt chin in slots 2 and 5              |
| S84   | `S84-conveyor.png` | 4, 5, 8             | redraw | Googly pop-eyes with high brows in slots 4 and 8, round eyes and thin arched brow in 5                    |
| S86   | `S86-health.png`   | 2, 4, 6, 7, 8       | redraw | Round puffy faces, square jaws, thin brows, narrow smiles; googly pop eyes in surprise; jowly, aged frown |
| S92   | `S92-raci.png`     | 2, 3, 4, 5, 6, 7, 8 | redraw | Heavy, jowly, sagging lower face reads about 50; drooping older face in 5; googly eyes in 8               |
| S96   | `S96-rank.png`     | 4, 5, 7             | redraw | Googly saucer eyes, thin high brows and small 'o' mouths in surprise frames; puffy round cheeks, wide jaw |

### Batch E: tool sheets to redraw (2 of 2)

| Sheet | File                  | Slots               | To do  | What's wrong                                                                                                |
| ----- | --------------------- | ------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| S99   | `S99-hourglass.png`   | 4, 5, 6, 8          | redraw | Round staring or googly eyes in four frames, no smile crinkle; lower face too broad and round               |
| S101  | `S101-kano.png`       | 2, 3, 4, 5, 6, 7, 8 | redraw | Googly eyes (2, 4, 7), thin high brows (4, 7); puffy broad-jawed face throughout; narrow smirk (3)          |
| S103  | `S103-eisenhower.png` | 3, 4, 5, 6, 7, 8    | redraw | Round white-ringed eyes in most slots, googly in 4; full cheeks, jowly jaw, narrow calm smile               |
| S106  | `S106-okr.png`        | 2, 3, 4, 5, 6, 7, 8 | redraw | Round, puffy, broad face with short wide chin throughout; narrow smiles, thin brows, jowls, short flat nose |
| S107  | `S107-nps.png`        | 2, 3, 4, 6, 7       | redraw | Big round white-ringed cartoon eyes (2, 3, 4, 7, mildly 6); high arched brows; pointed chin                 |
| S108  | `S108-lab.png`        | 2, 4, 5, 6          | redraw | Googly white-ringed eyes in excited 4 and 6; puffy broad cheeks and lower face; extra ageing creases        |
| S109  | `S109-interview.png`  | 2, 3, 4, 5, 6, 7    | redraw | Broad square jaws, full cheeks; googly eyes in 4 and 5; jowly far cheek in 3; thin smiles                   |
| S110  | `S110-tree.png`       | 2, 3, 5, 6, 7, 8    | redraw | Ball-round faces, round or googly eyes, short nose, narrow smiles in front frames; jowly cheeks when tilted |
| S114  | `S114-flaky.png`      | 3, 4, 6             | redraw | Cartoon googly eyes in the two surprise frames; stubble-like grey shadow round the pursed mouths            |

### Batch F: day and weather sheets (1 of 3)

The first three are the ones to redraw; the rest are touch-ups.

| Sheet | File                | Slots            | To do    | What's wrong                                                                                                  |
| ----- | ------------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| S28   | `S28-late.png`      | 3, 7             | redraw   | Both open-eyed faces have huge googly white-ringed eyes under high, thin, sharply arched brows                |
| S52   | `S52-school.png`    | 3, 4, 6, 7       | redraw   | Stubble, long pointed chin, droopy eyes (4); white-ringed googly eyes (6, 7); round, fleshy faces (3, 6, 7)   |
| S57   | `S57-ship.png`      | 3, 4, 5, 6, 7, 8 | redraw   | Heavy square jaw, long jutting chin, creased jowly cheeks reading late 40s; thick angled brows in slots 3-5   |
| S12   | `S12-heat.png`      | 2, 3, 5, 6       | touch up | Puffy cheeks and square jaws while fanning; googly eyes, ball-round face at collar; wilt face saggy, older    |
| S13   | `S13-scorch.png`    | 4, 7, 8          | touch up | Slot 4 googly eyes, ball-round face; slot 7 puffy cheeks and jaw; slot 8 round, baggy, ageing eyes            |
| S14   | `S14-cold.png`      | 2, 3, 5          | touch up | Slot 2 square, blocky lower face; slot 5 googly round eyes under very high brows                              |
| S21   | `S21-grey.png`      | 3, 4, 6, 7       | touch up | Round eyes without lower-lid lift, thin high-arched brows, puffed round cheeks and jaw; gappy teeth in slot 3 |
| S24   | `S24-coffee.png`    | 2, 5             | touch up | Googly white-ringed eyes in the awake grin; puffed cheeks and blunt chin in the sleepy smile                  |
| S25   | `S25-breakfast.png` | 4, 5, 6, 8       | touch up | Googly white-ringed eyes and high arches; round staring eyes; broad full jaw, blunt chin; thin arched brows   |
| S26   | `S26-koshary.png`   | 4, 5             | touch up | Chewing face turns chubby and pear-shaped with jowls; spicy face has round white-ringed eyes                  |
| S29   | `S29-weekend.png`   | 3, 4, 5, 8       | touch up | Round wide-open eyes without smile crinkle, googly eyes in slot 5, fuller cheeks and blunt wide jaw           |

### Batch G: day and weather sheets (2 of 3)

| Sheet | File              | Slots         | To do    | What's wrong                                                                                           |
| ----- | ----------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| S32   | `S32-suhoor.png`  | 2, 3, 6       | touch up | Round, open eyes with flat lower lids in laughs and smile; full cheeks and broad jaw                   |
| S33   | `S33-sweets.png`  | 3, 4, 8       | touch up | Slot 3 googly eyes, high brows, pointed chin; slot 4 aged and square-jawed; slot 8 broad lower face    |
| S34   | `S34-kahk.png`    | 2, 6, 8       | touch up | Front smiles too round and chubby: puffed lower cheeks, wide jaw, broad blunt chin                     |
| S35   | `S35-eid.png`     | 2, 4, 6, 7    | touch up | Round plump faces with wide jaws and blunt chins; short forehead, filled-in temples on front smiles    |
| S38   | `S38-mawlid.png`  | 3, 4          | touch up | Slot 4 googly round eyes, long hollow face, pointed chin; slot 3 aged by heavy creases                 |
| S39   | `S39-xmas.png`    | 2, 3, 5       | touch up | Googly round eyes and high brows in surprise (2, 5), puffed cheeks (5), round side-eyes (3)            |
| S40   | `S40-eggs.png`    | 7, 8          | touch up | Slot 7 googly round eyes, high brows, pointed chin; slot 8 puffed round face, round eyes, arched brows |
| S46   | `S46-flowers.png` | 2, 6          | touch up | Tilted frames have a heavy, wide, square lower face without his chin taper; slot 6 lopsided            |
| S47   | `S47-green.png`   | 5, 6          | touch up | Tilted globe frames go round and wide with puffed cheeks, no chin taper; slot 5 smeared features       |
| S48   | `S48-spooky.png`  | 3, 6          | touch up | Scared frames get round, white-ringed cartoon eyes under high arched brows; slot 6 googly              |
| S49   | `S49-prank.png`   | 3, 4, 5, 6, 7 | touch up | Wide, round, short faces (4-7); googly eyes (7); gaunt, aged face (3); short nose (5, 6)               |

### Batch H: day and weather sheets (3 of 3)

| Sheet | File              | Slots               | To do    | What's wrong                                                                                                           |
| ----- | ----------------- | ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| S53   | `S53-winter.png`  | 4, 5                | touch up | Eyes opened into round white-ringed circles, googly in slot 5, under high arched brows                                 |
| S54   | `S54-sticky.png`  | 5, 8                | touch up | Slot 5 laugh makes the face round and short; slot 8 has round, white-ringed cartoon eyes                               |
| S55   | `S55-poker.png`   | 3, 5, 6, 7          | touch up | Slot 7 googly-eyed, squashed, short-nosed; 3 aged by creases; 5–6 full cheeks; 6 round eyes                            |
| S56   | `S56-timer.png`   | 3, 4                | touch up | Eyes enlarged and round in slot 3, googly in slot 4, under high arched brows                                           |
| S58   | `S58-focus.png`   | 5, 7                | touch up | Googly round eyes ringed with white in the eureka frame; wide, full-cheeked, square-jawed face under headphones        |
| S59   | `S59-kudos.png`   | 2, 3, 4, 5, 6, 7, 8 | touch up | Wide full-cheeked faces with broad jaw and chin; creased, weathered skin ageing him, worst in slot 2                   |
| S60   | `S60-ball.png`    | 5, 7                | touch up | Square jaw, wide flat chin when kicking; heavy, long, older lower face in the kneeling laugh                           |
| S61   | `S61-reading.png` | 2, 3, 5             | touch up | Googly round eyes and ball-round face when excited; rounder eyes, fuller cheeks and heavy jaw elsewhere                |
| S63   | `S63-phone.png`   | 3, 5, 7             | touch up | Googly surprised eyes, square heavy jaw, stubble shadow; rounder eyes looking up; over-wrinkled, aged skin in the wink |
| S64   | `S64-lights.png`  | 2, 4, 5             | touch up | Googly startled eyes and round cheeks; round side-glance eyes with high brows; round eyes, wide face when spooky       |

### Batch I: tool sheets to touch up (1 of 2)

| Sheet | File               | Slots            | To do    | What's wrong                                                                                                  |
| ----- | ------------------ | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| S65   | `S65-capacity.png` | 2, 3, 4, 6, 7    | touch up | Puffy cheeks, wide jaw and broad chin in 2, 4, 6, 7; googly round eyes in 3                                   |
| S70   | `S70-pi.png`       | 2, 5, 7, 8       | touch up | Fuller cheeks, wide jaw, no taper to chin; thin high-arched brows; weak smile lines; slot 7 ball-round laugh  |
| S78   | `S78-hats.png`     | 4, 6             | touch up | Excited frames turn his almond eyes into white-ringed circles; slot 4 cheeks too full                         |
| S79   | `S79-canvas.png`   | 2, 6, 7, 8       | touch up | Heavy, jowly lower face and blunt chin; narrow thin-teeth smile; eyes slightly round in 7 and 8               |
| S81   | `S81-bands.png`    | 4, 7             | touch up | Slot 4 googly pop-eyes with high arched brows; slot 7 round eyes and a thin, sharply arched brow              |
| S85   | `S85-toggles.png`  | 4, 5             | touch up | Sceptical frames: round white-ringed eyes, thin arched brows, short wide lower face without his tapering chin |
| S87   | `S87-shield.png`   | 2, 3, 6, 7, 8    | touch up | Front smiles: full lower face, broad U chin, narrow thin-toothed smile, shallow folds, thin short brows       |
| S88   | `S88-mood.png`     | 4, 5             | touch up | Neutral and sad frames: enlarged round eyes ringed with white, broad square jaw                               |
| S89   | `S89-charter.png`  | 2, 3, 4, 5, 6, 8 | touch up | Round, fleshy lower face with broad chin in most slots; googly round surprise eyes in slot 2                  |

### Batch J: tool sheets to touch up (2 of 2)

| Sheet | File               | Slots               | To do    | What's wrong                                                                                              |
| ----- | ------------------ | ------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| S90   | `S90-done.png`     | 2, 3, 4, 5, 6, 7, 8 | touch up | Wide, fleshy jaw and broad chin throughout; sagging, older frown in 5; round eyes, short nose in 8        |
| S91   | `S91-skills.png`   | 2, 3, 4, 5, 6, 7, 8 | touch up | Ball-round, short faces with full cheeks and broad chins throughout; googly round eyes in slot 4          |
| S97   | `S97-scale.png`    | 4, 7, 8             | touch up | Googly round eyes in the surprise; front smiles too square and full-cheeked with broad jaw and blunt chin |
| S100  | `S100-effort.png`  | 7, 8                | touch up | Front frames: eyes too round or beady; slot 8 wide full cheeks, narrow smile, short nose                  |
| S104  | `S104-gavel.png`   | 4, 7, 8             | touch up | Round white-ringed eyes in 4; full cheeks and broad jaw in 7 and 8; narrow smile in 8                     |
| S105  | `S105-compass.png` | 3, 7                | touch up | Surprise frames 3 and 7 have googly white-ringed round eyes, slot 3 crossed; slot 7 face slightly round   |
| S111  | `S111-assume.png`  | 3, 6, 7             | touch up | Googly eyes, round face in 7; square jaw, narrow grin in 6; oversized round eye in 3                      |
| S112  | `S112-risk.png`    | 2, 3, 5, 6          | touch up | Googly eyes in 3; square jaws in 2 and 5, narrow smile in 2; bulging eyes in 6                            |

### Batch K: one or two slots each (1 of 2)

Sheets that match the original apart from one or two slots. Do these last.

| Sheet | File                | Slots | To do     | What's wrong                                                                                       |
| ----- | ------------------- | ----- | --------- | -------------------------------------------------------------------------------------------------- |
| S11   | `S11-sun.png`       | 8     | small fix | Peek over sunglasses: round, enlarged eyes ringed with white; face too long and narrow             |
| S20   | `S20-wind.png`      | 4     | small fix | Slot 4: googly round eyes and over-round cheeks in the surprised look                              |
| S22   | `S22-stars.png`     | 6     | small fix | Amazed frame only: googly white-ringed eyes and a puffed, ball-round face                          |
| S31   | `S31-iftar.png`     | 4     | small fix | Slot 4 has huge googly cartoon eyes and a short round face                                         |
| S36   | `S36-adha.png`      | 6, 8  | small fix | Slot 6 wide round eyes, high brows; slot 8 closed-lip smirk, arched brows, long narrow chin        |
| S41   | `S41-picnic.png`    | 5     | small fix | Slot 5: big round eyes showing too much white, over-raised brows, deep forehead creases ageing him |
| S44   | `S44-fireworks.png` | 8     | small fix | Slot 8: round googly cartoon eyes with white ringed all round small irises                         |
| S51   | `S51-summer.png`    | 4     | small fix | Slot 4: round, white-ringed eyes and a round, full-cheeked, short face                             |
| S62   | `S62-music.png`     | 4, 5  | small fix | Front drum grin: face too wide and square at cheeks and jaw, chin barely tapers                    |
| S66   | `S66-goal.png`      | 2     | small fix | Slot 2 face too full with a broad, barely tapering chin; brows thin and arched                     |

### Batch L: one or two slots each (2 of 2)

| Sheet | File                   | Slots | To do     | What's wrong                                                                                 |
| ----- | ---------------------- | ----- | --------- | -------------------------------------------------------------------------------------------- |
| S69   | `S69-forecast.png`     | 6     | small fix | Slot 6 eyes round and white-ringed instead of almond; chin slightly pointed                  |
| S71   | `S71-roadmap.png`      | 6     | small fix | Slot 6 uncovered eye is a round, white-ringed stare instead of his almond                    |
| S72   | `S72-radio.png`        | 6     | small fix | Slot 6 has huge round googly cartoon eyes instead of his almond eyes                         |
| S76   | `S76-todo.png`         | 6     | small fix | Slot 6 excited eyes go round with white all round the iris; cheeks slightly full             |
| S93   | `S93-chat.png`         | 5     | small fix | Laugh goes broad and short: puffed cheeks, wide jaw, untapered chin, too much lower teeth    |
| S94   | `S94-stakeholders.png` | 3, 5  | small fix | Smirk: full cheeks, square jaw, high brow. Frown: jowly, heavy, older, bulbous nose tip      |
| S95   | `S95-adkar.png`        | 7     | small fix | Excited frame has large round eyes with white showing all round the irises                   |
| S98   | `S98-moscow.png`       | 5     | small fix | Only the hesitating frame drifts: googly round eyes ringed with white, cheeks a little wide  |
| S102  | `S102-buy.png`         | 8     | small fix | Surprise in slot 8 drawn with round, white-ringed eyes; face slightly wide with a blunt chin |

---

## 3. The prompt

Paste the shared block, then the block for that sheet from [section 4](#4-the-sheets), in the same message. One sheet per message. **In batch A, delete the sentence that starts _If a fourth image_ before you send.**

```text
Edit the first attached image, an Amr sprite sheet with eight slots: 1 to 4 left to right along the top row, 5 to 8 left to right along the bottom row. Every other attached image is a reference only: don't edit it, don't copy its poses or slots, don't return it. Change ONLY his face, in the slots named below, and keep everything else exactly as it is.

HIS FACE must be the face in ref-face.png and in the TARGET row of ref-face-fix.png: the same man, feature by feature. It must not look like the NOT THIS row. If a fourth image is attached, a sheet of his approved faces, it shows his corrected face in these sheets' style: match its features too, but don't copy its poses or slots. The black outline and the cream backgrounds in the references are only how they were drawn: don't copy them. Paint his face in this sheet's own soft style, with no black outline. Only the features change:
- Face shape: an inverted egg, longer than wide: broad at the temples and cheekbones, tapering in a long, gentle curve to a soft, rounded U-shaped chin about as wide as his neck, a clear step below his mouth. Not round, puffy, chubby or square, no heavy jaw; never pointed, V-shaped, hollow-cheeked or long and narrow either.
- Cheeks: firm, with rounded apples high under his eyes that lift when he smiles; flat, not puffy, along the jaw.
- Eyebrows: dark and medium-thick, low and close over the eyes, nearly straight with a gentle arch, the outer ends sloping slightly down.
- Eyes: medium-small almond eyes with dark brown irises, natural human size. The upper lid touches or covers the top of the iris and the lower lid touches or covers its bottom; a thin sliver of white above it is fine in surprise, and below it when he looks up. Never a round cartoon eye, never white showing all round the iris. When he smiles, the lower lids lift and crinkle, with small creases at the outer corners.
- Nose: prominent and fairly long: a straight bridge down to a broad, rounded tip with visible nostrils, the tip close to his upper lip.
- Mouth: wide, its corners about under the centres of his eyes, with a thin upper lip and deep smile lines from his nose to the corners of his mouth. His usual smile shows the full upper row of white teeth, not the lower row.
- Chin: a soft crease under the lower lip. Clean-shaven: no grey, blue or dark shadow on his upper lip, chin or jaw.
- Forehead, hairline and ears: keep exactly as drawn; only smooth away heavy creases on the forehead.
- Age and skin: a man around 40, with smooth, even skin and only small creases at the corners of his eyes. Not younger, not older: no heavy wrinkles, sagging or bags.

HIS EXPRESSION IN EACH SLOT STAYS: where he looks, and whether he smiles, laughs, squints, yawns, frowns, winks, closes his eyes, opens his mouth or raises his eyebrows, unless that slot's line below says to change it. Draw that same expression with his own features. A surprised face keeps his almond eyes, opened a little wider; it never turns into round cartoon eyes.

KEEP UNCHANGED: his hair, exactly (cut, colour and texture); the size, tilt and position of his head: it is not scaled or moved, and his hair, ears and the top of his head stay where they are, while below his eyes his cheeks, jaw and chin may be reshaped as each slot line says (slimmed where they bulge, the chin a little lower or higher); his skin colour; his body, pose, hands and fingers; every prop, including anything on or in front of his face (glasses, a cup, food, a hand); his shirt, T-shirt, lanyard, badge, belt, trousers and shoes; the black fitness band on his right wrist and the silver watch on his left; any other character in the slot; and the size and placement of every figure in its slot. Slots not named below stay exactly as they are.

Each slot line below first says what is wrong now (replace it), then what to draw instead.

OUTPUT: the same 1536 x 1024 image with a fully transparent background, 4 columns x 2 rows, nothing touching a slot edge. No background, floor, shadow, text, labels, grid lines, borders or effects. Do not mirror anything.
```

---

## 4. The sheets

Slot 1 is his standing pose (on S01 it is his default face, and it ships). Where two slots are two frames of one movement (a breath, a shiver, a drum beat), both are listed, so the loop doesn't jump.

### Batch A

```text
S01 — FACES. Slots 1, 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 1 (warm default smile): the chin is short and blunt close under the mouth, the lower cheeks full, the eyes narrow slits. Make the eyes medium-small smiling almonds; keep the jaw's width at the ears and bring the chin a clear step lower (over the top of his neck, never onto his collar), tapering in a gentle curve to a soft U; deepen the smile lines.
- Slot 2 (talking, lips closed): the chin is short and blunt close under the mouth, and the lower cheeks full. Keep the closed-lip smile; keep the jaw's width at the ears and bring the chin a clear step lower (over the top of his neck, never onto his collar), tapering in a gentle curve to a soft U, with a soft crease under the lower lip.
- Slot 3 (mid-word, mouth slightly open): the eyes are small round dark dots showing white above the iris; the chin is short and broad. Draw medium-small almond eyes, lower lids lifted, and give him the same longer, softly tapering chin as slot 1.
- Slot 4 (saying "ah", mouth wide): the eyes are big round discs with white all round the iris, under high arched brows. Draw medium-small almond eyes, iris touching both lids; brows nearly straight, only slightly raised; give him the same longer, softly tapering chin as slot 1.
- Slot 5 (happy, winking, big smile): the chin is short and blunt, the lower cheeks full and the upper lip long. Keep the wink; bring the broad nose tip close to the upper lip; keep the jaw's width at the ears and bring the chin a clear step lower (over the top of his neck, never onto his collar), tapering in a gentle curve to a soft U.
- Slot 6 (surprised, small "o" mouth): the eyes are googly white-ringed discs, far bigger than his; grey stubble shadows the mouth and chin. Draw medium-small almond eyes opened a little wider, iris touching both lids, clean-shaven skin round the mouth, and the same longer, softly tapering chin as slot 1.
- Slot 7 (sleepy, half-closed eyes): the chin is short and blunt close under the mouth, and the lower cheeks full. Keep the heavy half-closed lids and small smile; keep the jaw's width at the ears and bring the chin a clear step lower (over the top of his neck, never onto his collar), tapering in a gentle curve to a soft U; deepen the smile lines.
- Slot 8 (concerned, apologetic smile): the chin is short and blunt close under the mouth, and the lower cheeks full. Keep the lifted, knitted inner brows and closed-lip smile; keep the jaw's width at the ears and bring the chin a clear step lower (over the top of his neck, never onto his collar), tapering in a gentle curve to a soft U.
This sheet is the anchor for every later edit: his face here must be the original's, in this sheet's style.
```

### Batch B

```text
S02 — EXPLAINING. Slot 8 only.
- Slot 8 (friendly shrug, brows raised): the eyes are white-ringed round discs under high arched brows, and the face is round and full. Draw medium-small almond eyes, iris touching both lids; brows raised but nearly straight; taper to a rounded, fairly narrow chin.
Slots 2 to 7 stay exactly as they are: when he talks, the S01 heads go onto those bodies.
```

```text
S03 — POINTING. Slots 2, 3, 4, 5 and 6 only.
- Slot 2 (pointing left, head turned): the nose is small and flat, the near cheek puffy, the teeth dull grey. Draw a prominent, fairly long nose, straight bridge, broad rounded tip close to the upper lip, a near cheek flat along the jaw and clean white upper teeth.
- Slot 3 (pointing up-left, looking up): the cheeks are full; heavy creases round the eyes add years. Keep the lifted brows and upward gaze; draw firm cheeks lifted under the eyes, flat along the jaw, only small crinkles at the eye corners, and smooth skin.
- Slot 4 (head back, laughing): lopsided face, one cheek a smeared blob, jaw melting into the neck, white ringing the eyes, grey round the mouth. Keep the tilt and laugh; draw a symmetrical inverted egg, cheeks flat along the jaw, a clear rounded chin, almond eyes, clean-shaven mouth.
- Slot 5 (pointing up-right): the smile is narrow and tight, teeth dull grey, grey stubble on lip and chin, near cheek lumpy. Draw a wide smile with the full upper row of white teeth, deep smile lines, clean-shaven lip and chin, a smooth cheek, flat along the jaw.
- Slot 6 (pointing right): the smile is narrow, a grey band crosses the teeth, grey stubble shadows mouth and chin; eye creases add years. Draw a wide smile with the full upper row of white teeth, clean-shaven lip and chin, and only small eye crinkles.
```

```text
S04 — TOUCH. Slots 2, 3, 4, 5, 6 and 7 only.
- Slot 2 (poked, laughing): the eyes are big white-ringed discs, cheeks wide and puffy, grey stubble round the open mouth. Draw medium-small almond eyes opened a little wider, iris touching both lids, firm cheeks lifted under the eyes, flat along the jaw tapering to a rounded, fairly narrow chin, clean-shaven skin round the mouth.
- Slot 3 (giggling, hand over mouth): the face is round and heavy, cheeks bunched, deep creases ageing him, grey stubble on the chin below the hand. Keep the squeezed eyes with light crinkles; draw firm cheeks lifted under the eyes, flat along the jaw tapering to a rounded, fairly narrow, clean-shaven chin.
- Slot 4 (squirming left, laughing): ball-round face, bulging cheeks, wide jaw, short fleshy nose, heavy creases, grey stubble round the mouth. Draw an inverted egg to a rounded, fairly narrow chin, a fairly long straight nose with broad tip, light crinkles, clean-shaven lip and chin.
- Slot 5 (squirming right, laughing): the face is ball-round, full width down to the mouth then cut in sharply at the chin; heavy creases; grey stubble on lip and chin. Taper from below the cheekbones to a rounded, fairly narrow chin; light crinkles; clean-shaven mouth.
- Slot 6 (head pat, tilted left): the cheeks are full and round, jaw broad, brows thin and arched, a faint grey tint above the smile. Draw firm cheeks lifted under the eyes, flat along the jaw tapering to a rounded, fairly narrow chin, medium-thick nearly straight brows still raised, clean-shaven upper lip.
- Slot 7 (head pat, tilted right): the cheeks are puffy and round and the lower face heavy, with a broad jaw. Keep the closed eyes and closed-lip smile; draw firm cheeks lifted under the eyes, flat along the jaw tapering to a rounded, fairly narrow chin.
Keep the hand covering his mouth in slot 3 exactly as it is.
```

```text
S05 — PICKED UP AND LANDING. Slot 5 only.
- Slot 5 (flailing, alarmed): huge round eyes with white all round small irises; cheeks puffy and wide. Draw medium-small almond eyes opened a little wider, lids touching the iris, white only at the sides; slim the cheeks so the face tapers to a rounded, fairly narrow chin.
```

```text
S06 — BALANCE AND DIZZY. Slots 2, 3, 4, 5, 6 and 7 only.
- Slot 2 (tipping left, worried grin): big round eyes ringed with white; a broad, squarish jaw. Draw medium-small almond eyes opened a little wider, white only at the sides; slim the cheeks and jaw so the face tapers to a rounded, fairly narrow chin.
- Slot 3 (tipping right, worried grin): big round eyes ringed with white; a broad, squarish jaw. Draw medium-small almond eyes opened a little wider, white only at the sides; slim the cheeks and jaw so the face tapers to a rounded, fairly narrow chin.
- Slot 4 (losing balance, 'whoa'): big round eyes ringed with white, puffy round cheeks, a grey moustache shadow round the 'o' mouth. Draw medium-small almond eyes opened a little wider, white only at the sides; slimmer cheeks tapering to a rounded, fairly narrow chin; a clean-shaven upper lip.
- Slot 5 (steady again, exhaling): a round, heavy face with full cheeks and a wide jaw; grey stubble on upper lip and chin. Slim the cheeks and jaw so the face tapers to a rounded, fairly narrow chin; clean-shaven lip and chin.
- Slot 6 (dizzy, hand on forehead): round white-ringed disc eyes rolling apart, puffy squashed cheeks, grey shadow round the mouth. Draw medium-small almond eyes, unfocused and drifting in slightly different directions, lids touching the irises; slimmer cheeks tapering to a rounded, fairly narrow chin; clean-shaven.
- Slot 7 (dizzy, tilting the other way): round white-ringed eyes rolled sideways, puffy cheeks, grey shadow round the 'o' mouth and chin. Draw medium-small almond eyes, unfocused and glancing sideways, lids touching the irises; slimmer cheeks tapering to a rounded, fairly narrow chin; clean-shaven.
Keep the hand on his forehead in slots 6 and 7 exactly as it is.
```

```text
S07 — REST. Slots 2, 3, 6, 7 and 8 only.
- Slot 2 (yawning, hand over mouth, eyes shut): a broad, heavy lower face and jaw, and grey stubble on the chin beside the hand. Let the yawn lengthen the face, not widen it: taper the jaw to a rounded, fairly narrow chin, clean-shaven.
- Slot 3 (stretching, yawning): heavy, wide face with puffed cheeks and a broad jaw, ageing creases, strong grey beard shadow round the open mouth. Slim the cheeks, taper the jaw to a rounded, fairly narrow chin; smooth 40-year-old skin crinkling only at the eye corners; clean-shaven.
- Slot 6 (dozing, head drooped forward, eyes closed): the same full cheeks and wide jaw as slot 7. Fix them the same way, so the two breathing frames match.
- Slot 7 (dozing, breathing in): fuller cheeks, a wide jaw, a grey faint-moustache line on the upper lip, brows a little high and arched. Taper the face to a rounded, fairly narrow chin; clean-shaven lip; low, nearly straight brows, as in slot 6.
- Slot 8 (startled awake, hands up): big round eyes ringed with white, puffy cheeks, a grey moustache shadow round the 'o' mouth. Draw medium-small almond eyes opened a little wider, still almond-shaped, white only at the sides; slimmer cheeks tapering to a rounded, fairly narrow chin; clean-shaven lip and chin.
Keep the hand over his mouth in slot 2 exactly as it is.
```

```text
S08 — PAGE MOMENTS. Slots 2, 3, 4, 5, 6 and 7 only.
- Slot 2 (bracing into the wind, forearm over brows): heavy crow's-feet and cheek creases age him; broad, puffy lower face; grey shadow on upper lip and under lower lip. Squint with only small eye-corner crinkles; taper the jaw to a rounded, fairly narrow chin; clean-shaven.
- Slot 3 (bracing into the wind, the alternate frame): the same ageing creases round the squint and the same broad lower face as slot 2. Fix them the same way, so the two wind frames loop without a jump.
- Slot 4 (watching closely, leaning forward): warped face, near cheek a smeared blob, jaw melting into the neck, a white-ringed eye. Redraw it as a tilted inverted egg: firm cheek, defined jaw tapering to a rounded chin, almond eyes keeping their gaze, long broad-tipped nose.
- Slot 5 (fist pump, eyes shut, grinning): ball-round, chubby lower face; smeared nose and mouth; grey stubble on lips and chin. Taper the face to a rounded, fairly narrow chin; a defined straight nose with broad rounded tip; clear thin-lipped grin, deep smile lines; clean-shaven.
- Slot 6 (clapping, hands apart): squarish jaw and blunt chin, slit eyes, both rows of teeth, grey upper lip, lower lip and chin. Draw medium-small almond eyes with lifted lower lids; full upper row of teeth only, thin lips; a rounded, fairly narrow chin; clean-shaven.
- Slot 7 (clapping, palms together): wide jaw, full lower cheeks, small eyes, a grey band under the upper teeth, grey lip and chin. Match slot 6: medium-small almond eyes, full upper row of teeth only, jaw tapering to a rounded, fairly narrow chin, clean-shaven.
Keep the forearm and hand over his brows in slots 2 and 3 exactly as they are.
```

```text
S09 — SOCIAL. Slots 3, 4 and 6 only.
- Slot 3 (high five, eyes squeezed shut, grinning): the face is squat and wide, with chubby cheeks and a broad jaw. Slim it into his inverted egg: firm cheeks lifted under the eyes, flat along the jaw, jaw tapering to a rounded, fairly narrow chin. Keep the squint and grin.
- Slot 4 (shaking his hand out, laughing): the face is too wide and round, with puffy cheeks, a broad jaw and soft smile lines. Slim the cheeks, taper the jaw to a rounded, fairly narrow chin and deepen the smile lines. Keep the open laugh.
- Slot 6 (peekaboo, found you): the eyes are googly circles with white all round tiny irises; the jaw is broad and square. Draw medium-small almond eyes opened a little wider, with a sliver of white, and a jaw tapering to a rounded, fairly narrow chin.
Keep the high-five palm beside his face in slot 3 and the open hands beside his face in slot 6 exactly as they are.
```

```text
S10 — STROLL. Slots 5, 6, 7 and 8 only.
- Slot 5 (walking to our left): the eyes stare wide and round with white on both sides of the iris, brows heavy and arched, near cheek full. Draw medium-small almond eyes with lifted, crinkled lower lids, low, nearly straight, medium-thick brows and a cheek flat along the jaw.
- Slot 6 (walking to our left, mid-stride): the eyes are a little big and round with white showing, the brows thick and arched, the cheeks full. Draw medium-small almond eyes with lifted, crinkled lower lids, low, nearly straight brows and cheeks flat along the jaw.
- Slot 7 (walking to our left): the eyes are round and wide, the brows arched, the cheeks full, the lower face heavy. Draw medium-small almond eyes with crinkled lower lids, low, nearly straight brows, cheeks flat along the jaw and a jaw tapering to a rounded, fairly narrow chin.
- Slot 8 (turning back to face us): the face is nearly as wide as tall, with puffed cheeks, a broad lower face and eyes squeezed to slits. Slim it into his inverted egg: cheeks flat along the jaw tapering to a rounded, fairly narrow chin; smiling almond eyes.
```

### Batch C

```text
N01 — AI REVIEWER. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (looking down at the result): older, heavier face: puffy lumpy cheeks, short chin, creased skin with eye bags, faint thin brows, short, blobby nose with no clear bridge. Draw slim cheeks tapering to a rounded, fairly narrow chin, smooth skin, dark medium-thick low brows, his long nose with its straight bridge and broad, rounded tip.
- Slot 3 (opening the book, smiling down): jowly cheeks, short chin, creased skin, thin pale brows, short, blobby nose with no clear bridge, thin closed smile. Draw slim cheeks to a rounded, fairly narrow chin, smooth skin, dark low brows, his long nose with its straight bridge and broad, rounded tip, and keep the closed-lip smile, a little wider, with deep smile lines.
- Slot 4 (comparing result and reference): small sunken baggy eyes, cheeks bulging past the jaw, faint thin brows, wrinkles, short, blobby nose with no clear bridge. Draw medium-small almond eyes looking down, slim cheeks to a rounded, fairly narrow chin, dark low brows, his long nose with its straight bridge and broad, rounded tip, smooth skin.
- Slot 5 (correcting the result card): chubby sagging cheeks, short chin, wrinkled forehead and under-eyes, faint brows, a thin stretched-line smile. Draw slim cheeks to a rounded, fairly narrow chin, smooth skin, dark low brows, a wide smile showing the full upper row of teeth.
- Slot 6 (showing the correction): thin stretched mouth with small gappy teeth, puffy lumpy cheeks, wrinkled skin, thin light brows. Draw a wide smile with his full, even upper teeth and deep smile lines, slim cheeks, a rounded, fairly narrow chin, smooth skin, dark low brows.
- Slot 7 (approving, grinning): thin grin with uneven gappy teeth, puffy creased cheeks, wide squat face, short chin, faint brows; he looks 55. Draw a wide grin with his full, even upper teeth, slim cheeks to a rounded, fairly narrow chin, smooth skin, dark medium-thick brows.
- Slot 8 (presenting, facing us): squashed-wide face, bulging cheeks, short chin, small baggy eyes, thin pale high brows, short, blobby nose with no clear bridge, thin teeth strip. Draw an inverted-egg face, a rounded, fairly narrow chin, crinkling almond eyes, dark low brows, his long nose with its straight bridge and broad, rounded tip, full upper teeth, smooth skin.
Keep his hands, the helper robot, the reference book and the result card exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N02 — DINOSAUR PRIORITIES. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (glancing at the offered stack): big round white-ringed pop-eyes, puffy round cheeks, squat face, short chin, thin light brows, creased skin. Draw medium-small almond eyes glancing the same way, slim cheeks to a rounded, fairly narrow chin, dark low brows, smooth skin.
- Slot 3 (taking the stack): googly round eyes ringed with white, chubby ball-round lower face, faint thin brows, closed smirk, creased skin. Draw medium-small almond eyes looking down, slim cheeks to a rounded, fairly narrow chin, dark low brows, the closed-lip smile kept, a little wider, with deep smile lines, smooth skin.
- Slot 4 (considering the priorities): big round white-ringed eyes rolled sideways, thin pale arched brows, puffy wide squat face, short chin. Draw almond eyes still glancing sideways, dark medium-thick brows low and nearly straight, slim inverted-egg face tapering to a rounded, fairly narrow chin.
- Slot 5 (choosing a card): round staring white-ringed eyes, wide puffy face with a short chin, thin brows, creased skin, a narrow smile. Draw crinkling medium-small almond eyes, a narrow-chinned inverted-egg face, smooth skin, dark low brows, a wide smile with full upper teeth.
- Slot 6 (returning the stack): round staring white-ringed eyes, puffy creased cheeks bulging sideways, short chin, thin brows, a thin-line smile. Draw crinkling medium-small almond eyes, slim smooth cheeks to a rounded, fairly narrow chin, dark low brows, a wide smile with full upper teeth.
- Slot 7 (keeping one card): round staring eyes, squat chubby face, short chin, faint brows, a thin-line smile, creased skin. Draw almond eyes with crinkling lower lids, an inverted-egg face, a rounded, fairly narrow chin, dark low brows, smooth skin, a wide smile showing his upper teeth.
- Slot 8 (presenting the priority): round white-ringed eyes, puffy wide cheeks, short chin, pale brows, short, blobby nose with no clear bridge, thin teeth strip, wrinkles. Draw crinkling almond eyes, an inverted-egg face, a rounded, fairly narrow chin, dark low brows, his long nose with its straight bridge and broad, rounded tip, full upper teeth, smooth skin.
Keep the dinosaur and the card stack exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N03 — DEADLINE RABBIT RUSH. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (looks down at the anxious rabbit): puffy ball face, jowls, broad chin; round dark eyeballs in white; thin sliver of teeth. Draw his inverted egg tapering to a rounded, fairly narrow chin, cheeks lifted not puffy, lowered almond eyes with no white around the iris, the full upper row of teeth.
- Slot 3 (raises a hand to pause, eyes down): a jowly ball face, dark round eyeballs showing white, a thin band of teeth, creased cheeks and eye corners. Draw the inverted egg with a rounded, fairly narrow chin, almond eyes under lowered lids, the full upper teeth row, smooth, 40-year-old skin.
- Slot 4 (hand on chest, reassuring, eyes down): chubby round face, cheeks bulging below the cheekbones, no taper to the chin; round dark eyeballs; a narrow sliver of teeth; older creased cheek. Draw the inverted egg with a rounded, fairly narrow chin, almond eyes under lowered lids, the full upper teeth row, smooth skin.
- Slot 5 (points at the next-step card, eyes down): jowly ball face, broad chin; round dark googly eyeballs; thin teeth band; eye-corner and cheek creases. Draw the inverted egg tapering to a rounded, fairly narrow chin, almond eyes under lowered lids, the full upper teeth row, smooth skin of a 40-year-old.
- Slot 6 (front view, holds the card out): pear face, jaw as wide as the cheekbones; round staring white-ringed eyes; thin high brows; thin teeth band. Draw the inverted egg with a rounded, fairly narrow chin, almond eyes with lifted, crinkled lower lids, dark medium-thick brows low and close, the full upper teeth row.
- Slot 7 (front view, open hand, encouraging): jowly pear face, broad chin; round staring eyes, white all round small irises; thin raised brows; narrow teeth band. Draw the inverted egg tapering to a rounded, fairly narrow chin, almond eyes with crinkled lower lids, low near-straight brows, the full upper teeth row, smooth skin.
- Slot 8 (front view, hands clasped, relaxed): ball face, broad chin merging into jowls; round staring eyes; thin high brows; narrow teeth band. Draw the inverted egg, rounded, fairly narrow chin with a soft crease under the lower lip, almond eyes with lifted lower lids, low close brows, the full upper teeth row.
Keep Deadline Rabbit and the blue next-step card exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N04 — OCTOPUS OVERLOAD. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (surprised, looking down at the octopus): googly eyes, huge white eyeballs with dark discs; puffy ball face, jowls, broad chin. Keep the O mouth, raised brows and downward gaze; draw medium-small almond eyes opened a little wider, never white-ringed, and the inverted egg tapering to a rounded, fairly narrow chin.
- Slot 3 (raises a hand to pause, glancing down): round dark eyeballs showing white; puffy cheeks, broad chin, no taper. Keep the closed-lip smile; draw almond eyes under lowered lids with no white around the iris, and the inverted egg tapering to a rounded, fairly narrow chin, cheeks lifted not puffy.
- Slot 4 (holds the task cards, looking down): round dark downcast eyeballs; chubby jowly face, broad soft chin; thin brows; creases at the eye corners and cheek. Keep the closed-lip smile; draw almond eyes under lowered lids, dark medium-thick low brows, the inverted egg with a rounded, fairly narrow chin, smooth skin.
- Slot 5 (sorts the cards, looking down): chubby ball face, broad chin; round dark downcast eyeballs; heavy crow's feet and cheek creases that read 50. Keep the closed-lip smile; draw the inverted egg tapering to a rounded, fairly narrow chin, almond eyes under lowered lids, smooth skin of a man around 40.
- Slot 6 (front view, holds up a blue card): round staring eyes, white all round small irises; pear face with wide jowls; thin high brows; thin teeth band. Draw almond eyes with lifted, crinkled lower lids, dark brows low and close, the inverted egg with a rounded, fairly narrow chin, the full upper teeth row.
- Slot 7 (looks down, open hand parking the rest): puffy round cheeks and jowls, broad chin; round dark eyeballs under the lids; creased cheeks. Keep the closed-lip smile and lowered gaze; draw the inverted egg tapering to a rounded, fairly narrow chin, almond eyes under lowered lids with no white showing, smooth skin.
- Slot 8 (front view, calm, palm open): round staring white-ringed eyes; thin high brows; jowly wide lower face; narrow teeth band. Draw medium-small almond eyes with lifted, crinkled lower lids, dark medium-thick brows low and close, the inverted egg tapering to a rounded, fairly narrow chin, the full upper teeth row, smooth skin.
Keep the Overengineering Octopus, the task cards and the blue card held up beside his chin in slot 6 exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N05 — AHWA DEBRIEF. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (worried brows, after a difficult moment): round eyes ringed with white; puffy pear face, jowls bulging past the jaw, broad chin; thin arched brows; forehead and cheek creases. Keep the worried brow tilt and closed-lip smile; draw almond eyes, medium-thick brows, the inverted egg with a rounded, fairly narrow chin, smooth skin.
- Slot 3 (side glance with a grin): googly eyes, round dark irises in big whites; thick brows arched high; chubby jowly cheeks, broad chin. Draw almond eyes glancing sideways under natural lids, brows low and close, nearly straight with a gentle arch, the inverted egg tapering to a rounded, fairly narrow chin.
- Slot 4 (front view, knowing look, one brow raised): round staring white-ringed eyes, no lid lift; ball-pear face, wide jowls, creased cheeks. Keep the one raised brow and closed-lip smile; draw almond eyes with lifted lower lids, the other brow low and close, the inverted egg with a rounded, fairly narrow chin, smooth skin.
- Slot 5 (chuckles, hand on chest, eyes squeezed shut): ball-round jowly face, broad soft chin; brows set high and arched. Keep the squeezed-shut eyes with lifted lower lids and the grin; draw the inverted egg tapering to a rounded, fairly narrow chin, brows low and close, the full upper teeth row, deep smile lines.
- Slot 6 (eyes closed, relaxing): puffy pear face with jowls and a broad chin; deep cheek creases age him. Keep the closed eyes and closed-lip smile; draw the inverted egg tapering to a rounded, fairly narrow chin with a soft crease under the lower lip, cheeks lifted not puffy, smooth skin.
- Slot 7 (front view, hands clasped, settling): round staring eyes ringed with white; thin brows set high; wide jowly lower face, broad chin. Keep the closed-lip smile; draw almond eyes with lifted lower lids, dark medium-thick brows low and close, the inverted egg with a rounded, fairly narrow chin, smooth skin.
- Slot 8 (front view, calm, hands in pockets): round white-ringed eyes; thin brows set high; jowly ball face, broad chin; older creased cheeks. Keep the closed-lip smile; draw medium-small almond eyes with crinkled lower lids, low close brows with a gentle arch, the inverted egg tapering to a rounded, fairly narrow chin, smooth skin.
Keep the Ahwa Cup exactly as it is.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N06 — STICKY ESCAPE. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (looks down as Sticky slips away): dark round googly eyeballs in white; puffy ball face, jowly cheeks, broad chin; a thin sliver of teeth. Draw almond eyes under lowered lids with no white around the iris, the inverted egg tapering to a rounded, fairly narrow chin, the full upper teeth row.
- Slot 3 (reaches down gently): round dark googly downcast eyes; chubby jowly face with no taper to the chin; narrow teeth band; creased cheeks. Draw almond eyes under lowered lids, the inverted egg tapering to a rounded, fairly narrow chin, cheeks lifted not puffy, the full upper teeth row, smooth skin.
- Slot 4 (catches Sticky, glancing down): round dark eyeballs ringed with white; puffy cheeks and a broad chin; a thin teeth band. Draw almond eyes under lowered lids, the inverted egg tapering to a rounded, fairly narrow chin, the wide smile with the full upper teeth row and deep smile lines.
- Slot 5 (examines the note, eyes nearly closed, brows knitted): jowly ball face, broad chin; heavy creases on the forehead, eye corners and cheeks make him look 50-plus. Keep the nearly closed eyes, knitted brows and closed-lip smile; draw the inverted egg tapering to a rounded, fairly narrow chin, smooth, clean 40-year-old skin.
- Slot 6 (places Sticky on the board, lids lowered): cheeks bulge below the cheekbones into a broad soft chin; a thin band of teeth; wrinkled cheeks. Keep the lowered almond lids; draw the inverted egg tapering to a rounded, fairly narrow chin, the full upper teeth row with deep smile lines, clean smooth skin.
- Slot 7 (pins the paper margin, half-closed eyes): ball-round jowly face, broad chin; heavy cheek wrinkles that age him; a thin teeth band in the grin. Keep the half-closed eyes; draw the inverted egg tapering to a rounded, fairly narrow chin, the wide smile with the full upper teeth row, clean smooth skin.
- Slot 8 (front view, presents the board with an open hand): round staring eyes ringed with white; thin high brows; pear face, wide jowls, broad chin; thin teeth band. Draw almond eyes with lifted lower lids, dark brows low and close, the inverted egg with a rounded, fairly narrow chin, the full upper teeth row, smooth skin.
Keep Agile Sticky, the small board and the blue pin exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N07 — COMIC TO ACTION. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (holding the comic, slight turn): cheeks bulge past a heavy jaw, chin short, brows thin and high, eyes beady, smile a thin teeth strip. Taper to a rounded, fairly narrow chin; dark low brows; crinkled almond eyes; wide smile showing the full upper row.
- Slot 3 (reading, looking down): keep the lowered lids; cheeks balloon past the jaw, nose short and blunt, far above a small smile. Slim the cheeks; lengthen the nose, broad tip close to the lip; lengthen the chin; widen the smile across the upper teeth.
- Slot 4 (idea, open grin): eyes big and round with white all round, cheeks ballooning, brows thin and lifted. Keep the open grin and the glance down at the book; draw almond eyes opened a little wider, dark medium-thick brows, slim cheeks tapering to a rounded, fairly narrow chin.
- Slot 5 (taking the card, turned down): bulging cheeks over a short, wide jaw; brows thin and high; eyes beady; thin teeth-strip grin under a long upper lip. Slim the cheeks to a rounded, fairly narrow chin, dark low brows, crinkled almond eyes, nose tip close to the lip, wide upper-teeth smile.
- Slot 6 (closing the book, front): cheeks widest, jaw barely tapering to a short chin; eyes small staring dots; brows thin and high; smile a narrow strip. Taper from the temples to a rounded, fairly narrow chin; almond eyes, lower lids crinkled; dark low brows; wide full-upper-teeth smile.
- Slot 7 (offering something, front): puffy cheeks, short broad chin, beady staring eyes, thin high brows, thin teeth strip, long upper lip. Taper to a rounded, fairly narrow chin; crinkled almond eyes; dark low brows; nose tip close to the lip; full upper-teeth smile.
- Slot 8 (encouraging, front): chubby face with full cheeks and a short wide chin, small staring eyes, thin faint brows, narrow grin. Bring the chin a little lower, to a rounded, fairly narrow chin, soft crease under the lower lip; crinkled almond eyes; dark low brows; wide full-upper-teeth smile.
Keep the comic, the action card and his hands exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N08 — GRACEFUL RETRY. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (noticing the card, head bowed): keep the closed smile; cheeks bulge, nose short and blunt, smile small above a tiny chin. Slim the cheeks, lengthen the nose to a broad tip near the lip, widen the closed smile, taper to a rounded, fairly narrow chin.
- Slot 3 (sympathising, eyes downcast): keep the tilted sympathy brows and downcast eyes; brows thin and faint, cheeks plump, nose short, chin small and recessed. Draw dark medium-thick brows, slimmer cheeks, a longer nose ending close to the lip, a wider closed smile, a rounded, fairly narrow chin.
- Slot 4 (unfolding the card, head bowed): bulging cheeks, a short, blobby nose with no clear bridge, a small closed smile far below it. Slim the cheeks to taper into a rounded, fairly narrow chin, lengthen the nose so its tip nears the lip, widen the closed smile.
- Slot 5 (smoothing the card, head bowed): puffy cheeks, a short broad chin, thin faint brows and a long gap between nose and mouth. Dark medium-thick brows low over the downcast eyes, slimmer cheeks, a longer nose close to the lip, a rounded, fairly narrow chin.
- Slot 6 (showing the card, front): eyes small staring dots, grin a tight stretched line of teeth, jaw heavy and barely tapering, brows thin. Draw crinkled almond eyes, a wide smile showing the full upper row, a rounded, fairly narrow chin, dark low brows.
- Slot 7 (offering another try, front): staring round eyes, a wide but paper-thin teeth line, puffy wide lower face, thin high brows. Show the full upper row of teeth with deep smile lines; crinkled almond eyes; dark low brows; taper to a rounded, fairly narrow chin.
- Slot 8 (encouraging warmly, front): beady staring eyes, thin faint brows, a strained thin grin under a long upper lip, broad chin. A warm wide smile showing the full upper row, nose tip close to the lip, crinkled almond eyes, dark low brows, rounded, fairly narrow chin.
Keep the card and his hands exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N09 — YOUR DECISION. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (presenting two options, turned): cheeks bulge over a short chin; brows thin and lifted; eyes beady; thin teeth strip under a long upper lip. Taper to a rounded, fairly narrow chin, dark low brows, crinkled almond eyes, nose tip near the lip, full upper-teeth smile.
- Slot 3 (considering blue, looking down-left): keep the lowered lids; the cheeks bulge, the nose is short and blunt, the chin short. Slim the cheeks, lengthen the nose to a broad tip near the lip, taper to a rounded, fairly narrow chin, widen the smile across the full upper row.
- Slot 4 (considering purple, looking down-right): cheeks puffy and wide, brows thin and faint, nose short above a long upper lip. Dark medium-thick brows low over the lowered eyes, slimmer cheeks tapering to a rounded, fairly narrow chin, a longer nose ending close to the lip.
- Slot 5 (holding both equally, front): cheeks widest, jaw barely tapering to a short chin, eyes small dots ringed with white, brows thin and high, a narrow teeth strip. Taper to a rounded, fairly narrow chin; crinkled almond eyes; dark low brows; wide full-upper-teeth smile.
- Slot 6 (stepping back, front): full cheeks, beady eyes, thin high brows, thin teeth-strip grin, broad short chin, long upper lip. Slim the cheeks to a rounded, fairly narrow chin, crinkled almond eyes, dark low brows, nose tip near the lip, full upper-teeth smile.
- Slot 7 (waiting attentively, front): puffy face barely tapering, small staring eyes, thin brows, a narrow teeth strip. Slim the cheeks to a rounded, fairly narrow chin; almond eyes, lower lids lifted and crinkled; dark low brows; wide smile showing the full upper row.
- Slot 8 (still waiting, slight turn): full cheeks, short broad chin, small staring eyes, thin faint brows, thin grin under a long upper lip. Taper to a rounded, fairly narrow chin; crinkled almond eyes; dark low brows; nose tip close to the lip; wide full-upper-teeth smile.
Keep the two option cards and his hands exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

```text
N10 — QUIET COMPANION. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (holding the bell, grinning): jaw barely tapers to a short broad chin; brows thin and lifted; eyes small dots ringed with white; a thin teeth strip. Taper to a rounded, fairly narrow chin; dark low brows; crinkled almond eyes; wide smile showing the full upper row.
- Slot 3 (noticing the visitor, surprised): keep the surprise; eyes round and googly with white all round, brows thin high arches. Almond eyes opened a little wider, lids touching the iris, dark medium-thick raised brows, slimmer cheeks to a rounded, fairly narrow chin, wide upper-teeth smile.
- Slot 4 (covering the bell, grinning): full cheeks, short broad chin, beady eyes, thin faint brows, narrow teeth strip under a long upper lip. Taper to a rounded, fairly narrow chin; crinkled almond eyes; dark low brows; nose tip close to the lip; wide full-upper-teeth smile.
- Slot 5 (keeping the bell quiet, closed-lip smile): keep the closed lips; jaw barely tapers to a short chin, upper lip long, brows thin and faint over small staring eyes. Taper to a rounded, fairly narrow chin, nose tip near the lip, dark low brows, crinkled almond eyes.
- Slot 6 (putting the bell away): keep the closed-lip smile; plump cheeks, short chin, eyes small staring dots, brows thin and high. Slim the cheeks to a rounded, fairly narrow chin; almond eyes with crinkled lower lids; dark brows low over them.
- Slot 7 (settling calmly): plump cheeks over a short broad chin, small staring eyes, thin faint brows, long upper lip. Keep the closed smile; taper to a rounded, fairly narrow chin, soft crease under the lower lip; nose tip near the lip; crinkled almond eyes; dark low brows.
- Slot 8 (quiet, attentive): chubby wide face, small round staring eyes, thin high brows, broad short chin. Keep the closed smile; slim the cheeks to a rounded, fairly narrow chin; almond eyes, lower lids crinkled; dark brows low over the eyes; nose tip near the lip.
Keep the bell and his hands exactly as they are.
The other character in each slot stays exactly as drawn. Slot 1 is never shown on the site: leave it as it is.
```

### Batch D

```text
S73 — DEPENDENCY MAP. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (holding the cork board, curious): eyes are big bulging circles ringed with white, and the lower face is broad and heavy with a short chin. Draw medium-small almond eyes, slightly widened, and taper the face to a rounded, fairly narrow chin.
- Slot 3 (pushing a pin in, looking down): cheeks puff out and the jaw is heavy and jowly. Slim the cheeks to firm ones lifted under the eyes with deep smile lines and taper the jaw to a rounded, fairly narrow chin; keep the downcast eyes.
- Slot 4 (stretching the string, tilted squint): the cheeks and lower face are full and broad, not his tapering inverted egg. Keep the sideways squint, but slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 5 (tying the string, concentrating): full, heavy cheeks and a wide, jowly jaw make him look older and heavier. Give him cheeks flat along the jaw and a jaw tapering to a rounded, fairly narrow chin, so he reads as a firm man around 40.
- Slot 6 (tracing the string, eyes narrowed): the furrowed smirk sits on puffy cheeks and a broad, heavy jaw. Keep the narrowed eyes and furrow, but slim the cheeks and taper the jaw to a rounded, fairly narrow chin, firm and around 40.
- Slot 7 (pointing, 'aha!' face): huge circle eyes ringed with white, a ball-round face, a short, wide chin and thin, high brows. Keep the open mouth; draw medium-small almond eyes opened a little wider, dark medium-thick brows raised, and an inverted-egg face tapering to a rounded, fairly narrow chin.
- Slot 8 (holding the board up, proud): squat, wide face, short chin, small beady eyes, thin high brows. Draw medium-small almond eyes with lifted, crinkled lower lids, low medium-thick brows, cheeks flat along the jaw, a wide smile with deep smile lines and a rounded, fairly narrow chin.
Keep the raised index finger beside his face in slot 7 exactly as it is.
```

```text
S74 — IMPEDIMENTS. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (beside the barrier, determined squint): the cheek on the smirk side puffs out and the jaw is broad and heavy. Keep the squint and furrowed brows, but slim to firm cheeks lifted under the eyes, flat along the jaw and taper the jaw to a rounded, fairly narrow chin.
- Slot 3 (raising the red flag, alert): eyes are huge googly circles ringed with white, the face ball-round with puffy cheeks and a short, wide chin. Draw medium-small almond eyes opened a little wider, brows raised, cheeks flat along the jaw and an inverted-egg face tapering to a rounded, fairly narrow chin.
- Slot 4 (hands on cheeks, worried): eyes are big googly circles ringed with white, the face round and doll-like, and a red smear crosses the forehead. Draw medium-small almond eyes opened a little wider in worry on an inverted-egg face, and clear the forehead smear.
- Slot 5 (pushing the barrier, straining): the face is wide and round, with full cheeks and a broad jaw. Keep the shut eyes and grimace, but slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 6 (barrier above his head, triumphant): the face is almost circular and chubby, cheeks puffed wide, chin short, eyes small beady dots. Draw an inverted-egg face with cheeks flat along the jaw, deep smile lines, a rounded, fairly narrow chin and almond eyes with lifted, crinkled lower lids.
- Slot 7 (wiping his forehead, relieved): the cheeks are puffy and the lower face broad and round. Keep the closed eyes and relieved smile, but slim to firm cheeks lifted under the eyes, flat along the jaw with deep smile lines and taper the jaw to a rounded, fairly narrow chin.
- Slot 8 ('all clear!' smile, arms out): wide, round face with a short chin, small beady eyes, thin high brows, no smile lines. Draw almond eyes with lifted, crinkled lower lids, low medium-thick brows, cheeks flat along the jaw with deep smile lines and a rounded, fairly narrow chin.
Keep the red flag beside his head in slot 3, his hands on his cheeks in slot 4, his raised arms and the barrier above his head in slot 6, and the hand pressed to his forehead in slot 7 exactly as they are.
```

```text
S77 — PREMORTEM. Slots 2, 4, 6 and 8 only.
- Slot 2 (gazing into the crystal ball): googly round eyes, white all round dot irises; round boyish face, broad jaw. Draw medium-small almond eyes, widened only by lifting the upper lids, which still touch the iris; an inverted-egg face tapering to a rounded, fairly narrow chin.
- Slot 4 (leaning back, gasping): big round cartoon eyes, white above and below the irises. Draw his almond eyes opened a little wider only by lifting the upper lids, lower lids still touching the iris; keep the raised brows and the 'O' mouth.
- Slot 6 (finger to his lips, shushing): eyes too big and round, white showing all round the irises; cheeks full and jaw wide. Draw medium-small almond eyes with the lids over part of the iris, and cheeks flat along the jaw tapering to a rounded, fairly narrow chin.
- Slot 8 (confident thumbs-up): narrow smile with a thin strip of teeth, shallow smile lines, round eyes, broad square jaw. Draw a wide smile showing the full upper row of teeth, deep smile lines, almond eyes with lifted, crinkled lower lids, a rounded, fairly narrow chin.
Keep the finger on his lips in slot 6 exactly as it is.
```

```text
S80 — BURNDOWN. Slots 2, 5, 7 and 8 only.
- Slot 2 (pointing at the chart, smiling): lower face wide and heavy, full cheeks, broad jaw, blunt chin. Draw cheeks flat along the jaw tapering from broad cheekbones to a rounded, fairly narrow chin, and a wider smile with the full upper row of teeth and deep smile lines.
- Slot 5 (scratching his head, worried glance): eyes too big and round, white all round the irises, worst on the right. Draw medium-small almond eyes glancing sideways, lids over the top and bottom of each iris; keep the worried brows and tight mouth.
- Slot 7 (delighted, pointing down): googly eyes, white all round tiny irises; broad full cheeks. Draw medium-small almonds still glancing sideways, natural-size dark brown irises under the upper lids, lower lids lifted by the grin; cheeks flat along the jaw, rounded, fairly narrow chin; keep the open grin.
- Slot 8 (pointer high, cheering): huge round googly eyes, dot irises ringed in white; ball-round face. Draw almond eyes with natural-size dark brown irises and lifted, crinkled lower lids; cheeks flat along the jaw tapering to a rounded, fairly narrow chin; keep the wide-open cheering mouth.
Keep the pointer at his head in slot 5 and the pointer held high in slot 8 exactly as they are.
```

```text
S82 — CYCLE TIME. Slots 2, 5 and 7 only.
- Slot 2 (eyeing the stopwatch): big round eyeballs rolled sideways, ringed with white, under high arched brows; chubby cheeks, blunt chin. Draw medium-small almond eyes glancing sideways under low, nearly straight brows, cheeks not puffy, jaw tapering to a fairly rounded, fairly narrow chin.
- Slot 5 (waiting patiently, brows raised): round staring eyes with white on every side, arched brows, full lower face. Draw medium-small almond eyes only slightly widened, lower lids lifted, brows raised yet medium-thick and nearly straight, jaw tapering to his fairly rounded, fairly narrow chin.
- Slot 7 (impressed, grinning): big round googly eyes fully ringed with white, brows high. Draw medium-small almond eyes opened a little wider, lower lids lifted and crinkled at the outer corners, under dark, nearly straight brows lifted only slightly. Keep the open upper-teeth grin.
Keep the stopwatch and the hand holding it in slots 2, 5 and 7 exactly as they are.
```

```text
S84 — VALUE STREAM. Slots 4, 5 and 8 only.
- Slot 4 (watching the boxes, laughing): big round eyeballs rolled sideways, white all round the iris, brows arched high. Draw medium-small almond eyes glancing sideways at the belt, lower lids lifted and crinkled, under low, dark, nearly straight brows. Keep the open laugh.
- Slot 5 (pointing at the box, puzzled): round, enlarged eyes ringed with white; the raised brow thin and sharply arched. Draw narrower almond eyes, the raised brow dark, medium-thick and only slightly lifted, the other low and nearly straight. Keep the pursed mouth.
- Slot 8 (lifting a box, triumphant): googly round eyes ringed with white, brows thrown high, a gaping mouth showing both rows. Draw almond eyes narrowing and crinkling in the smile, brows only slightly lifted, and a wide open smile showing the full upper row.
Keep the box he holds up in slot 8 exactly as it is.
```

```text
S86 — SQUAD HEALTH CHECK. Slots 2, 4, 6, 7 and 8 only.
- Slot 2 (smiling, traffic light beside him): ball-round puffy face, wide rounded jaw, thin light brows, heavy crow's feet. Taper the face to his inverted egg and fairly rounded, fairly narrow chin; dark medium-thick brows; crinkled almond eyes, not slits; lighter crow's feet. Keep the smile.
- Slot 4 (looking down at amber light, frowning): jaw and area under the mouth heavy, wide and jowly, ageing him. Slim the jaw and lower cheeks so the face tapers to a rounded, fairly narrow chin, no jowls. Keep the knit brow and down-turned mouth.
- Slot 6 (mysterious smile, light behind him): ball-round puffy face, near-square jaw, wide chin, short thin brows, heavy crow's feet ageing him. Draw his inverted egg tapering to a fairly rounded, fairly narrow chin, dark medium-thick brows, narrowed almond eyes, lighter crow's feet. Keep the closed-lip smile.
- Slot 7 (surprised reveal): googly round pop eyes with white all round small irises; brows very thin. Draw his medium-small almond eyes opened a little wider, a sliver of white above the iris only, and dark medium-thick brows raised high. Keep the open O mouth.
- Slot 8 (hand on heart, warm smile): round puffy face, broad chin, narrow smile with a thin strip of teeth, short thin brows, slit eyes. Taper to his fairly rounded, fairly narrow chin; wide smile showing the full upper row; dark medium-thick brows; crinkled almond eyes.
Keep the traffic light beside his face in slots 2 and 7 exactly as it is.
```

```text
S92 — RACI. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (fanning the cards, smiling): the cheeks are heavy and jowly, the jaw broad, and extra creases age him past 40. Slim the cheeks and jaw to a rounded, fairly narrow chin; smooth the extra creases but keep his lower-lid crinkle, smile lines and teeth smile.
- Slot 3 (dealing a card, looking down): the lower face is full and jowly, with a broad chin and a fold beneath it, so he reads older. Even looking down, taper from the cheekbones to a smooth, rounded, fairly narrow chin with no fold; keep the lowered eyes and teeth smile.
- Slot 4 (star card beside his face, proud): the jaw is wide, the cheeks fleshy and the eyes open a little round. Narrow the jaw to a rounded, fairly narrow chin and draw medium-small almond eyes whose lower lids lift and crinkle in the smile; keep the teeth smile.
- Slot 5 (comparing two cards, thinking, looking down): cheeks droop past the jaw line, jowls hang and deep sagging folds make him a heavy man of 50. Draw a smooth, firm, about-40 face tapering from the cheekbones to a rounded, fairly narrow chin; keep the downward gaze and flat, down-turned mouth.
- Slot 6 (placing the blue card, careful): the chin is broad and jowly and the cheeks full and hanging, so he reads older. Slim the cheeks and taper to a smooth, rounded, fairly narrow chin with a soft crease under the lower lip; keep the lowered eyes and closed smile.
- Slot 7 (squaring the cards, satisfied nod): the cheeks are puffy and the face wide and heavy at the jaw. Slim the cheeks and narrow the jaw so the face tapers from the cheekbones to a rounded, fairly narrow chin; keep the squint and closed-lip smile.
- Slot 8 (shrugging, brows up): eyes are big googly balls ringed with white and the face is wide. Draw his medium-small almond eyes opened a little wider, lids touching the irises; narrow the jaw to a rounded, fairly narrow chin; keep the raised brows and open grin.
Keep the coloured cards exactly as they are, including the red star card held beside his face in slot 4.
```

```text
S96 — BACKLOG PRIORITIZER. Slots 4, 5 and 7 only.
- Slot 4 (looking down, smiling, hand at chin): puffy cheeks and a wide jaw make the face round and the chin broad. Keep the smile, eyes and nose; slim the cheeks to firm cheekbones and taper the jaw to a rounded, fairly narrow chin.
- Slot 5 (swapping blocks, eyebrows raised): googly eyes with white all round tiny pupils, thin high-arched brows and a small 'o' mouth. Keep the surprise; draw his medium-small dark brown almond eyes opened slightly wider, dark medium-thick brows moderately raised, his wide thin-lipped mouth parted.
- Slot 7 (steadying the wobbling tower): saucer eyes ringed with white, a puckered 'O' mouth and a round, puffy face. Keep the startle; draw his medium-small almond eyes opened a little wider, dark brows lifted moderately, lips parted in a gasp, cheeks flat along the jaw, a tapered rounded chin.
Keep the hand at his chin in slot 4 exactly as it is.
```

### Batch E

```text
S99 — COST OF DELAY. Slots 4, 5, 6 and 8 only.
- Slot 4 (counting coins in his palm): round staring eyes, white beside sideways pupils, full cheeks, broad jaw. Draw medium-small almond eyes glancing down at the coins, lids framing the iris; slim cheeks and jaw to a rounded, fairly narrow chin; keep the open grin.
- Slot 5 (dropping a coin, worried): large googly eyes, white fully ringed round dot pupils, on a ball-round, puffy-cheeked face. Draw medium-small almond eyes opened a little wider under the raised brows; slim the cheeks into his tapering inverted egg; keep the small 'o' mouth.
- Slot 6 (beckoning wave, 'hurry!'): round staring eyes ringed with white, and a broad, round lower face under the open grin. Draw medium-small almond eyes, a little wide, lower lids lifting with the grin; slim the jaw and cheeks to a rounded, fairly narrow chin.
- Slot 8 (pointing at the hourglass, smiling): round staring eyes showing the whole iris, white both sides, no smile crinkle; wide lower face, blunt chin. Draw medium-small almond eyes, lower lids lifted and crinkled by the smile; taper jaw to a rounded, fairly narrow chin.
Keep the waving hand in slot 6 and the hourglass beside his face in slot 8 exactly as they are.
```

```text
S101 — KANO MODEL. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (holding the clipboard up, a friendly question): eyes are round cartoon eyeballs with white all round the iris; cheeks and jaw full and wide. Draw medium-small dark brown almond eyes, lower lids lifted and crinkled by the smile; slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 3 (pointing at us, curious): round, wide face with full cheeks and a squarish jaw; the smirk shows only a few teeth. Taper the jaw to a rounded, fairly narrow chin and widen the curious smile into his wide, thin-lipped one showing the full upper row, with deep smile lines.
- Slot 4 (holding up the gift box, delighted surprise): googly eyes with huge whites round tiny irises, thin brows pushed high, ball-round puffy-cheeked face. Keep the open laugh, but draw almond eyes opened a little wider, dark medium-thick brows raised yet nearly straight, and an inverted-egg face tapering to a rounded, fairly narrow chin.
- Slot 5 (calm 'must have' nod, looking down): looking down, the cheeks are puffy and the lower face heavy and jowly, so he looks older and heavier. Slim the cheeks and jaw so the face tapers to a rounded, fairly narrow chin with a soft crease under the lower lip.
- Slot 6 (lifting the gift box lid, peeking in, excited): the face is round and wide with full cheeks and a broad jaw. Keep the downward glance and open grin, but draw the face as his longer inverted egg, broad at the cheekbones, tapering to a rounded, fairly narrow chin, with deep smile lines.
- Slot 7 (turning the clipboard round, eyes wide, revealing): bulging round eyes ringed in white, high thin brows, a wide puffy-cheeked face with a broad jaw. Keep the 'o' mouth; draw almond eyes opened a little wider, dark medium-thick brows raised yet nearly straight, and a face tapering to a rounded, fairly narrow chin.
- Slot 8 (hugging the gift box, eyes closed, delighted): the face is broad and round with full cheeks. Keep the closed eyes and wide toothy smile, but slim the cheeks and taper the jaw into his inverted egg with a rounded, fairly narrow chin and a soft crease under the lower lip.
Keep the clipboard in slot 2, the gift box in slots 4 and 6, and its gold bow under his chin in slot 8 exactly as they are.
```

```text
S103 — EISENHOWER MATRIX. Slots 3, 4, 5, 6, 7 and 8 only.
- Slot 3 (reading the task card, curious sideways glance): sideways glance with round eyeballs showing white round the iris; cheeks full and wide. Keep the pursed lips and the glance, but draw medium-small almond eyes and slim the cheeks so the jaw tapers to a rounded, fairly narrow chin.
- Slot 4 (slapping the card down, urgent, eyes wide): bulging googly eyes with big whites ringing the irises, brows pushed high, a ball-round face with puffy cheeks. Keep the 'o' mouth; draw almond eyes opened a little wider, dark medium-thick brows raised yet nearly straight, and an inverted-egg face tapering to a rounded, fairly narrow chin.
- Slot 5 (placing the card calmly, eyes closed): the face is round and full-cheeked with a heavy, jowly jaw that adds weight and years. Keep the closed eyes and calm smile, but slim the cheeks and taper the jaw to a rounded, fairly narrow chin with a soft crease under the lower lip.
- Slot 6 (handing the card over, friendly smile): eyes stay round and wide open with white round the iris; the cheeks are full. Keep the wide toothy grin, but draw medium-small almond eyes whose lower lids lift and crinkle at the outer corners, and slim the cheeks towards a rounded, fairly narrow chin.
- Slot 7 (flicking the card away, cheerful laugh): eyes are round and enlarged, ringed with white, with no lower-lid lift, and the face is broad with full cheeks. Keep the big open laugh; draw smiling almond eyes with lifted, crinkled lower lids and taper the jaw to a rounded, fairly narrow chin.
- Slot 8 (arms crossed, calm and in control): wide, round-square face with a broad jaw, small round dot eyes ringed with white and a narrow closed smile. Draw medium-small almond eyes, an inverted egg tapering to a rounded, fairly narrow chin, and a calm wide smile showing the upper teeth, with deep smile lines.
Keep the white task card beside his face in slot 3 exactly as it is.
```

```text
S106 — OKRS. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (target beside his face, determined smile): round, puffy face, short broad chin; narrow lopsided smile; thin light brows. Draw an inverted-egg face, cheeks flat along the jaw tapering to a rounded, fairly narrow chin; a wide smile showing the full upper row; dark, medium-thick, low brows.
- Slot 3 (3/4 laugh at the progress bar): cheeks puffed, jaw too full, nose short and stubby. Draw firm cheeks lifted under the eyes, a jaw tapering to a rounded, fairly narrow chin, and a prominent long straight nose whose broad rounded tip sits close to the upper lip.
- Slot 4 (eyes closed, nodding at the bar): heavy, puffy face, sagging jowls, ball-round jaw, looking well over 40. Draw smooth, cheeks flat along the jaw with no jowls, the jaw tapering to a rounded, fairly narrow chin with a soft crease under the lower lip. Keep the eyes closed and lips pressed.
- Slot 5 (looking up, laughing): face very broad and puffy, nose flattened, short and wide. Draw firm cheeks lifted under the eyes on an inverted-egg face narrowing to a rounded chin, and his long nose with its straight bridge and broad, rounded tip with a broad rounded tip and visible nostrils, seen from below.
- Slot 6 (effort, pushing the bar): heavy jowls, wide lower face, deep forehead furrows ageing him. Keep the squint and pursed lips; draw cheeks flat along the jaw without jowls, a rounded, fairly narrow chin and a smoother forehead with one light effort crease.
- Slot 7 (target high, celebrating): ball-round face, full cheeks, short wide chin; narrow smile; thin, high brows. Draw an inverted-egg face tapering to a rounded, fairly narrow chin; a wide grin showing the full upper row, deep smile lines; low, dark, medium-thick brows close over the eyes.
- Slot 8 (calm focus, pointing): wide puffy face and broad chin; thin arched brows; staring eyes; tight smile. Draw an inverted-egg face tapering to a rounded, fairly narrow chin; low, nearly straight dark brows; almond eyes, irises partly under the upper lid; a wider calm smile showing upper teeth.
Keep the target board beside his face in slot 2, the target and raised arms above his head in slot 7, and the target and pointing hand in slot 8 exactly as they are.
```

```text
S107 — NPS AND CSAT. Slots 2, 3, 4, 6 and 7 only.
- Slot 2 (holding up the survey card, friendly grin): big round eyes, white all round, brows lifted high and arched, chin a pointed V. Draw medium-small almond eyes, lower lids lifting and crinkling in the smile; low, nearly straight brows; a rounded, fairly narrow chin.
- Slot 3 (opening the envelope, excited): big round staring eyes ringed with white, brows high and arched, chin too pointed. Draw medium-small almond eyes, upper lids covering the top of each iris, lower lids lifted by the grin; brows low and nearly straight; a rounded, fairly narrow chin.
- Slot 4 (reading the card closely, brows raised): googly round eyes ringed with white around small irises; face tapers to a sharp chin. Draw medium-small almond eyes opened a little wider only by lifting the upper lids, irises touching the lower lids; a rounded, fairly narrow chin. Keep the raised brows and 'o' mouth.
- Slot 6 (card to his chest, listening): eyes a little round with white above and below the irises; brows thin and slightly high; tight smile. Draw almond eyes, upper lids resting on the irises; dark, medium-thick, low brows; a wider gentle smile with smile lines.
- Slot 7 (fan of envelopes, delighted): big round eyes ringed with white, brows raised high. Draw medium-small almond eyes, upper lids over the top of each iris, lower lids lifting and crinkling in the open grin; brows low, close over the eyes, gently arched.
Keep the envelope fan beside his face in slot 7 exactly as it is.
Keep the survey card in slot 4 exactly as it is.
```

```text
S108 — HYPOTHESIS TRACKER. Slots 2, 4, 5 and 6 only.
- Slot 2 (tilted 3/4, curious grin): puffy cheeks, wide lower face, chin losing its taper; extra creases round the mouth and cheeks age him. Draw firm cheeks lifted under the eyes, the jaw tapering to a rounded, fairly narrow chin; smooth skin with only his deep smile lines.
- Slot 4 (shaking the tube, eyes wide): googly round eyes ringed with white, brows shot up; puffy cheeks. Draw medium-small almond eyes opened a little wider only by lifting the upper lids, irises touching the lower lids; brows raised less; cheeks flat along the jaw, the jaw tapering to a rounded, fairly narrow chin. Keep the open grin.
- Slot 5 (one eye closed, observing): broad, puffy lower face; heavy crow's feet and forehead lines age him past 40. Keep the closed eye; draw cheeks flat along the jaw, the jaw tapering to a rounded, fairly narrow chin, a smooth forehead and only a light crinkle at the shut eye.
- Slot 6 (triumphant grin): googly round eyes ringed with white; puffy cheeks over a broad lower face. Draw medium-small almond eyes, upper lids cutting the top of the irises, lower lids lifting and crinkling with the grin; cheeks flat along the jaw, the jaw tapering to a rounded, fairly narrow chin.
```

```text
S109 — USER INTERVIEWS. Slots 2, 3, 4, 5, 6 and 7 only.
- Slot 2 (microphone out, smiling): jaw broad and square, cheeks full, chin blunt, teeth a thin strip. Taper to a rounded, fairly narrow chin with slim cheeks; widen the smile to show the full upper row of teeth, with deep smile lines.
- Slot 3 (hand cupped at ear, listening): the far cheek bulges into a round jowl past the jaw, leaving the lower face heavy and lopsided. Slim it into a smooth inverted egg tapering to a rounded, fairly narrow chin; keep the closed-lip smirk.
- Slot 4 (asking, brows up, 'oh' mouth): round eyes with white all round small dark irises, on a wide, full-cheeked face with a broad jaw. Draw medium-small almond eyes opened a little wider, lids touching the iris; slim the cheeks to a rounded, fairly narrow chin.
- Slot 5 (surprised, open grin): googly eyes, white discs with tiny centred pupils, on a ball-round, puffy-cheeked face with a broad chin. Draw almond eyes opened a little wider, irises touching the lids, in an inverted-egg face tapering to a rounded, fairly narrow chin; keep the grin.
- Slot 6 (sticking the note, eyes closed): lower face wide and boxy with full cheeks, and only a sliver of teeth. Keep the eyes closed; taper to a rounded, fairly narrow chin with slim cheeks; widen the smile to show the full upper row of teeth.
- Slot 7 (holding up the note, proud grin): jaw broader and squarer, cheeks fuller, chin blunt. Slim the cheeks and narrow the jaw to a rounded, fairly narrow chin; leave the eyes, nose and grin exactly as they are.
Keep the microphone below his chin in slot 2 and the hand cupped at his ear in slot 3 exactly as they are.
```

```text
S110 — OPPORTUNITY TREE. Slots 2, 3, 5, 6, 7 and 8 only.
- Slot 2 (holding the tree, eyes closed, smiling): the lower face is heavy, the cheek puffing out past the jaw line. Keep the closed eyes and smile; slim the cheek and taper the jaw to a rounded, fairly narrow chin.
- Slot 3 (watering, looking down, closed-lip smile): the cheeks sag into jowls beside the jaw, making the face heavy and older than 40. Lift and slim the cheeks so the face tapers cleanly to a rounded, fairly narrow chin, reading as a man around 40.
- Slot 5 (picking the fruit, close 3/4 grin): the face is very wide, the cheek between eye and mouth inflated and pushing the outline out. Slim that cheek so the face narrows into his inverted egg; keep the eyes, nose and toothy grin.
- Slot 6 (wide-eyed 'growing!' gesture, 'oh' mouth): googly eyes, white discs ringed round tiny pupils, on a ball-round face with puffy cheeks and a broad jaw. Draw almond eyes opened a little wider, irises touching the lids, in an inverted-egg face with a rounded, fairly narrow chin.
- Slot 7 (offering the fruit, smiling): ball-round face, puffy cheeks, round eyes showing white, short small-tipped nose, narrow smile. Draw an inverted egg with a rounded, fairly narrow chin, almond eyes crinkling in the smile, a long broad-tipped nose and the full upper row of teeth.
- Slot 8 (thumbs-up, tree in arm, smiling): round wide face, round eyes with white showing, short nose, shallow smile lines. Draw an inverted egg with a rounded, fairly narrow chin, crinkled almond eyes, a long broad-tipped nose and deep smile lines.
Keep the tree's leaves, its fruit and his hands below his chin in slots 2, 6, 7 and 8 exactly as they are.
```

```text
S114 — FLAKY TESTS. Slots 3, 4 and 6 only.
- Slot 3 (watching the tube wobble, alarmed): round white cartoon eyeballs, white all round, small centred irises, and grey shading round the open mouth. Draw his medium-small almond eyes, dark brown irises, lids opened slightly wider under raised brows; keep the open mouth, upper lip and chin clean-shaven.
- Slot 4 (catching the tipping tube, mouth open): huge round googly eyeballs, white all round, tiny irises, and a grey moustache shadow round the lips. Draw his medium-small almond eyes, dark brown irises, lids opened slightly wider; keep the 'o' mouth, lip and chin clean-shaven.
- Slot 6 (shaking the rack, listening, brows raised): grey shading round the pursed lips reads as stubble. Keep the squinting almond eyes, raised brows and pursed lips, with the upper lip and chin smooth and clean-shaven, no grey shadow.
Keep the rack, the yellow tube and his hands in slots 3, 4 and 6 exactly as they are.
```

### Batch F

```text
S28 — LATE NIGHT. Slots 3 and 7 only.
- Slot 3 (tapping his watch, 'it's late!'): huge round googly eyes ringed with white, small irises, under high thin sharp arches. Keep the open grin; draw his medium-small almond eyes, lower lids lifted by the grin, under dark medium-thick, nearly straight brows raised only slightly.
- Slot 7 (jolting awake, startled): huge googly eyes, white all round tiny irises, under high thin arches. Keep the small 'o' mouth; draw his medium-small almond eyes opened a little wider, still almond-shaped, natural-sized dark brown irises, under dark medium-thick brows raised but nearly straight.
```

```text
S52 — BACK TO SCHOOL. Slots 3, 4, 6 and 7 only.
- Slot 3 (thumbs in straps, determined grin): broad, fleshy face, full cheeks, wide jaw, heavy ageing creases round the squeezed eyes. Narrow the face to his inverted egg with smooth, lifted cheeks tapering to a rounded, fairly narrow chin; keep the squeezed eyes and grin.
- Slot 4 (reading the notebook, curious): grey stubble on the upper lip, a long narrow face, a pointed chin, droopy hooded eyes. Clean-shave him, widen the cheekbones, round the chin, draw lowered almond eyes; keep the brows lifted in the middle, curious.
- Slot 6 (pencil raised, 'I've got it!'): white-ringed googly eyes, a round, wide face. Draw his medium-small almond eyes opened a little wider under the raised brows, lower lids touching the irises; slim the cheeks and jaw into an inverted egg with a rounded, fairly narrow chin.
- Slot 7 (pencil on his upper lip, goofy): enlarged round crossed eyes full of white, a round, short face. Shrink the eyes to his medium-small almonds, still crossed; slim the cheeks and jaw into an inverted egg with a rounded, fairly narrow chin.
Keep the pencil balanced on his upper lip and the pursed lips under it in slot 7 exactly as they are.
```

```text
S57 — WE SHIPPED IT. Slots 3, 4, 5, 6, 7 and 8 only.
- Slot 3 (hugging the trophy, eyes closed): broad square jaw, sagging cheeks and jutting chin age him to 50; brows slope down hard; narrow smile. Taper the face to a rounded, fairly narrow chin, smooth cheeks, low near-straight brows, wider smile showing his full upper teeth.
- Slot 4 (rocket raised, laughing upward): long, heavy lower face, wide square jaw, jutting chin, deep ageing cheek creases, thick angled brows. Shorten the lower face and taper it to a rounded, fairly narrow chin, smooth cheeks, low, medium-thick near-straight brows; keep the laugh.
- Slot 5 (letting the rocket go, laughing upward): long, square, heavy lower face, broad jutting chin, deep ageing cheek creases, thick angled brows. Shorten the lower face and taper it to a rounded, fairly narrow chin, smooth cheeks, low, medium-thick near-straight brows; keep the open laugh.
- Slot 6 (shading his eyes, grinning up): chin long and pushed forward, jaw heavy, light ageing creases on the cheeks. Shorten and round the chin, taper the jaw to his fairly rounded, fairly narrow chin, smooth the cheeks; keep the wide toothy grin.
- Slot 7 (victory dance, front grin): the face is rounder and squarer than his, with full cheeks and broad jaw corners, so it does not taper. Slim the cheeks and draw the inverted egg narrowing to his fairly rounded, fairly narrow chin; keep the wide toothy smile.
- Slot 8 (bowing, eyes closed): broad, heavy jaw and cheeks that read older than 40, wider than a bowed head explains. Slim the jaw and lower cheeks so the face still narrows to his fairly rounded, fairly narrow chin, and smooth the cheeks.
Keep the trophy he hugs under his chin in slot 3 and the hand shading his brow in slot 6 exactly as they are.
```

```text
S12 — HOT DAY. Slots 2, 3, 5 and 6 only.
- Slot 2 (fanning, eyes closed, blowing): the cheeks are puffy and the lower face broad and square-ish. Keep the closed eyes, pursed lips and a slight puff, but slim the lower cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 3 (fanning, fan on the other side): the cheeks are puffy and the lower face wide and square around the pursed mouth. Keep the closed eyes and pursed lips; slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 5 (pulling his collar, brows up): the eyes are googly circles, white all round tiny irises, in a ball-round face. Draw medium-small almond eyes opened a little wider and an inverted-egg face tapering to a rounded, fairly narrow chin. Keep the raised brows and pursed lips.
- Slot 6 (wilting, head tilted): the face is long and droopy, with sagging cheeks, and reads older. Draw his smooth 40-year-old face: firm cheeks under broad cheekbones, a rounded, fairly narrow chin. Keep the half-closed eyes, furrowed brows and slack open mouth.
Keep the orange fan beside his face in slots 2 and 3 exactly as it is.
Keep the finger pulling his collar in slot 5 exactly as it is.
```

```text
S13 — SCORCHING DAY. Slots 4, 7 and 8 only.
- Slot 4 (surprised at the drip): huge googly eyes, white all round tiny irises, in a ball-round face. Draw medium-small almond eyes opened a little wider, dark brown irises touching both lids, and an inverted-egg face tapering to a rounded, fairly narrow chin, keeping the 'o' mouth.
- Slot 7 (enjoying the fan, chin up): puffed cheeks and a broad, heavy jaw make the lower face round. Slim the cheeks below the cheekbones and taper the jaw to a rounded, fairly narrow chin; keep the closed eyes and closed-lip smile.
- Slot 8 (melting, weak smile): eyes too round, whole iris showing, with heavy bags and creases under them that age him. Draw medium-small almond eyes, lids partly over the dark brown irises, smooth skin beneath; keep the worried brows and crooked smile.
Keep the ice cream cone and its pink drip in slot 4 and the electric fan in slot 7 exactly as they are.
```

```text
S14 — COLD DAY. Slots 2, 3 and 5 only.
- Slot 2 (shivering, chattering grin): bunched cheeks and a jaw nearly as wide as the cheekbones make the lower face square. Slim the cheeks and narrow the jaw so the face tapers to a rounded, fairly narrow chin; keep the clenched-teeth grin and squint.
- Slot 5 (blowing into cupped hands): googly round eyes, white all round small irises, under brows pushed very high. Draw medium-small dark brown almond eyes, lids partly covering the irises, still looking at us, and dark brows lower and nearly straight, only slightly raised.
- Slot 3 (shivering, the second frame): the same square lower face as slot 2. Slim it the same way, so the two shiver frames match.
Keep his cupped hands over his mouth in slot 5 exactly as they are.
```

```text
S21 — FOG AND GREY SKIES. Slots 3, 4, 6 and 7 only.
- Slot 3 (clearing the fog, delighted grin): staring round eyes, thin high-arched brows, puffed ball-round face, gappy upper teeth. Draw almond eyes with lifted lower lids, low near-straight brows lifted slightly, slim cheeks tapering to a rounded, fairly narrow chin, one full even upper tooth row.
- Slot 4 (clearing the fog, open grin): round open eyes without lower-lid lift or crinkles, thin arched brows, puffed cheeks, broad jaw. Draw smile-narrowed almond eyes with crinkled outer corners, low near-straight brows, slim cheeks tapering to a rounded, fairly narrow chin; keep the open grin.
- Slot 6 (pointing up, grinning at us): roundish open eyes, no lower-lid lift or crow's feet, thin high-arched brows, slightly full cheeks. Draw grin-narrowed almond eyes with crinkled corners, low medium-thick near-straight brows, slim cheeks tapering to a rounded, fairly narrow chin; keep the toothy grin.
- Slot 7 (palms-up shrug, 'oh well' smile): wide round eyes with white showing, thin high-arched brows, a narrow closed smile with weak smile lines. Draw medium-small almond eyes, low medium-thick brows lifted only at the inner ends, a wider closed smile with deep smile lines.
Keep the fog-clearing hand beside his face in slots 3 and 4 exactly as it is.
```

```text
S24 — MORNING COFFEE. Slots 2 and 5 only.
- Slot 2 (sleepy smile over the mug): cheeks puffed and lower face wide and round, with a blunt chin and faint smile lines. Slim the cheeks, taper the jaw to a rounded, fairly narrow chin and deepen the smile lines; keep the half-closed eyes.
- Slot 5 (jolted awake, energised grin): googly round eyes, small irises ringed with white, ballooning round face. Draw his almond eyes only slightly widened, lower lids lifted by the grin, slim cheeks tapering to a rounded, fairly narrow chin; keep the raised brows and toothy grin.
Keep the yellow mug and his hands under his chin in slot 2 exactly as they are.
```

```text
S25 — FUL AND TA'MEYA BREAKFAST. Slots 4, 5, 6 and 8 only.
- Slot 4 (chewing, eyes closed): the puffed cheeks carry the jaw out as wide as the temples, ending in a broad blunt chin. Keep the puffed cheeks, closed eyes and pursed lips, but taper the jawline into his fairly rounded, fairly narrow chin.
- Slot 5 (thumbs-up, 'so good'): huge round googly eyes, white all round tiny irises, high round-arched brows, a round face. Draw his medium-small almond eyes, slightly widened, lower lids lifted, under dark nearly straight brows raised a little; taper to a rounded, fairly narrow chin.
- Slot 6 (offering the sandwich): round, wide-open eyes with white beside the irises and flat lower lids; full cheeks, broad chin. Draw smiling almond eyes, lower lids lifted and crinkled at the outer corners; slim the cheeks and taper to a rounded, fairly narrow chin.
- Slot 8 (rubbing his tummy, eyes closed): thin brows arched high above the closed eyes; full wide cheeks and jaw, a broad squarish chin. Make the brows dark, medium-thick, low and nearly straight; slim the cheeks and taper to a rounded, fairly narrow chin.
Keep the thumbs-up hand beside his chin in slot 5 exactly as it is.
```

```text
S26 — KOSHARY LUNCH. Slots 4 and 5 only.
- Slot 4 (chewing, eyes closed): a chubby pear-shaped face; puffed cheeks run into a wide jowly jaw broader than the temples and a blunt chin merging into the neck. Keep closed eyes and puffed cheeks; rebuild his inverted egg tapering to a rounded, fairly narrow chin.
- Slot 5 (fanning his mouth, 'too spicy!'): the eyes open into round discs ringed with white. Keep the knotted raised brows, flushed cheeks and shouting mouth, but draw his medium-small almond eyes opened a little wider, still almond-shaped, natural-sized dark brown irises, no white all round them.
Keep the fanning hand beside his face in slot 5 exactly as it is.
```

```text
S29 — WEEKEND. Slots 3, 4, 5 and 8 only.
- Slot 3 (tossing the dice, laughing): round, wide-open eyes, flat lower lids, high arched brows, broad jaw and blunt chin. Draw medium-small almond eyes with lifted, crinkled lower lids and outer-corner creases, low near-straight brows, jaw tapering to a rounded, fairly narrow chin.
- Slot 4 (fists up, cheering): eyes round and open with flat lower lids; cheeks full, jaw wide, chin not tapering. Draw medium-small almond eyes with lifted, crinkled lower lids and outer-corner creases, slimmer cheeks, and a jaw tapering to a rounded, fairly narrow chin.
- Slot 5 (reading the paper, surprised): huge round googly eyes, white all round the iris; ball-round face, full cheeks, wide chin. Draw medium-small almond eyes opened slightly wider; keep the raised brows and small open mouth; jaw tapering to a rounded, fairly narrow chin.
- Slot 8 (lazy wave, toothy smile): eyes open and round, lower lids flat; brows a little high; cheeks full, jaw square. Draw medium-small almond eyes with lifted, crinkled lower lids, brows low and nearly straight, slimmer cheeks, jaw tapering to a rounded, fairly narrow chin.
Keep the raised fist beside his face in slot 4, the newspaper just below his chin in slot 5 and the waving hand in slot 8 exactly as they are.
```

### Batch G

```text
S32 — SUHOOR BEFORE DAWN. Slots 2, 3 and 6 only.
- Slot 2 (beating the drum, calling out): eyes round and wide open, white beside the iris, lower lids flat; cheeks full, jaw broad. Draw medium-small almond eyes with lifted, crinkled lower lids, slimmer cheeks, and a jaw tapering to a rounded, fairly narrow chin.
- Slot 3 (stick raised, calling out): eyes round and open, lower lids flat; lower face broad and round, chin blunt. Draw medium-small almond eyes with lifted, crinkled lower lids and outer-corner creases, and taper the jaw to a rounded, fairly narrow chin.
- Slot 6 (knocking, toothy smile): eyes round and wide open under slightly raised brows, lower lids flat; jaw a little wide. Draw medium-small almond eyes with lifted, crinkled lower lids, low, nearly straight brows and a slimmer jaw tapering to a rounded, fairly narrow chin.
Keep the drumstick beside his head in slot 3 and the knocking hand near his chin in slot 6 exactly as they are.
```

```text
S33 — KONAFA AND QATAYEF. Slots 3, 4 and 8 only.
- Slot 3 (offering the tray, brows up): big round eyes ringed with white under high arched brows, a pointed chin. Draw medium-small almond eyes opened a touch wider, lower lids lifted; brows lifted a little, nearly straight; a rounded, fairly narrow chin.
- Slot 4 (admiring the qatayef, open grin): heavy cheek and eye creases age him to 55; square jaw; mouth gaping over both teeth rows. Draw smooth 40-year-old skin, smile lines only, a jaw tapering to a rounded, fairly narrow chin, thin-lipped grin showing the upper row.
- Slot 8 (laughing 'no more', eyes squeezed): cheeks bulge towards the ears, jaw wide, chin blunt, mouth gaping over both teeth rows. Keep the squeezed eyes; taper cheeks and jaw to a rounded, fairly narrow chin; a wide, thin-lipped laugh showing mainly the upper row.
```

```text
S34 — EID KAHK. Slots 2, 6 and 8 only.
- Slot 2 (holding the plate, delighted): round face, nearly as wide as long, with puffed lower cheeks, a wide jaw and a broad blunt chin. Make it an inverted egg, longer than wide, cheeks lifted not full, jaw tapering to a rounded, fairly narrow chin.
- Slot 6 (offering a kahk): a round, chubby face, full lower cheeks, a wide jaw and broad chin, and a slightly narrow smile. Taper the jaw to a rounded, fairly narrow chin, cheeks lifted not full; widen the thin-lipped smile to show the full upper row.
- Slot 8 (hand on heart, warm smile): near-circular face, cheeks full down to a wide jaw and a broad blunt chin, so he looks boyish. Make the face clearly longer than wide, broad at the cheekbones, cheeks lifted, tapering to a rounded, fairly narrow chin.
```

```text
S35 — EID DAY. Slots 2, 4, 6 and 7 only.
- Slot 2 (looking up at the balloons, grinning): the lower face is broad and heavy, with wide cheeks, a thick jaw and a blunt chin. Even at this angle, taper the jaw to a rounded, fairly narrow chin, cheeks lifted by the grin, not full.
- Slot 4 (giving the envelope, smiling): round, plump face, cheeks puffed towards the ears, broad jaw and chin. Draw an inverted egg tapering to a rounded, fairly narrow chin, firm cheeks lifted under the eyes, flat along the jaw.
- Slot 6 (both arms up, celebrating): nearly circular face, puffy full cheeks, wide jaw, broad chin. Make it clearly longer than wide, firm cheeks lifted by the smile, flat along the jaw, jaw tapering to a rounded, fairly narrow chin.
- Slot 7 (arms open for a hug, beaming): full round cheeks, a wide blunt jaw and chin: he looks chubby and boyish. Taper the jaw to a rounded, fairly narrow chin, cheeks firm and lifted under the eyes, flat along the jaw.
Keep the balloons and their strings in slots 2 and 6 exactly as they are.
```

```text
S38 — MAWLID SWEETS. Slots 3 and 4 only.
- Slot 3 (admiring the sugar doll, laughing): deep crow's-feet, creased cheeks and forehead lines age him to 50, and the near cheek puffs out. Draw smooth skin of a man around 40, only small crinkles at the outer eye corners, and firm cheeks lifted under the eyes, flat along the jaw.
- Slot 4 (peering into the box, amazed): googly round eyes ringed with white, brows too high, face long and hollow-cheeked with a pointed chin. Draw medium-small almond eyes slightly wider, brows only a little raised, face broad at the cheekbones tapering to a rounded chin.
Keep the sugar doll in slot 3 exactly as it is.
```

```text
S39 — CHRISTMAS. Slots 2, 3 and 5 only.
- Slot 2 (holding the gift, excited): big bulging round eyes with white all round small irises, brows shot high and arched. Draw medium-small almond eyes, dark brown, opened only slightly wider, and his low, medium-thick, nearly straight brows lifted just a little.
- Slot 3 (shaking the gift by his ear, glancing up): eyes too large and round, white showing below and beside the irises like cartoon side-eyes. Draw medium-small almond eyes turned up and sideways, lower lids lifted, with deep smile lines beside the closed-lip smile.
- Slot 5 (peeking into the box, delighted): googly round eyes ringed with white, brows high, cheeks puffed round so the face loses its taper. Draw almond eyes slightly widened, brows only a little raised, firm cheeks lifted under the eyes, flat along the jaw narrowing to a rounded, fairly narrow chin.
Keep the red gift box and his hand holding it against his ear and jaw in slot 3 exactly as they are.
```

```text
S40 — COLOURED EGGS. Slots 7 and 8 only.
- Slot 7 (mock dismay, scratching his head): bulging round googly eyes with white around the irises, brows raised high, face narrowing to a pointed chin. Draw medium-small almond eyes, low dark brows knitted with only a slight lift, and a rounded, fairly narrow chin.
- Slot 8 (tossing the egg, laughing upward): puffed round cheeks and a jaw that stays wide too far down; round eyes under high arched brows. Draw firm cheeks lifted under the eyes, flat along the jaw tapering to a rounded, fairly narrow chin, almond eyes with lifted lower lids, low nearly straight brows.
Keep his hand scratching the side of his head in slot 7 exactly as it is.
```

```text
S46 — FLOWERS DAY. Slots 2 and 6 only.
- Slot 2 (bouquet behind his back, shy smile): the tilted lower face is heavy, the near cheek bulges, the wide soft jaw never tapers. Slim cheeks and jaw into his inverted egg with a rounded, fairly narrow chin; make the slightly large eyes medium-small almonds.
- Slot 6 (card at his chest, bashful): squat, lopsided face, wide square jaw, full cheeks, small low far eye, faint smile lines. Taper cheeks and jaw to a rounded, fairly narrow chin, raise the far eye, sized like the near almond, and deepen the smile lines.
Keep the tulip bouquet beside his chin in slot 2 and the heart card in slot 6 exactly as they are.
```

```text
S47 — GREEN DAY. Slots 5 and 6 only.
- Slot 5 (hugging the globe, eyes closed): full cheeks make the tilted face round and wide; eyes, nose and smile lines are blurred. Taper cheeks and jaw to a rounded, fairly narrow chin; draw distinct crinkled closed lids, a broad nose tip, deep smile lines.
- Slot 6 (spinning the globe, head back, grinning): broad, nearly ball-round face; the near cheek bulges and the jaw curves wide and low with no chin taper. Slim cheeks and jaw into his long inverted egg ending in a rounded, fairly narrow chin.
Keep the globe he hugs in slot 5 and the globe on his fingertip in slot 6 exactly as they are.
```

```text
S48 — SPOOKY WEEK. Slots 3 and 6 only.
- Slot 3 (claw hands up, playful boo): round eyes with white all round the irises, under high round brows; cheeks slightly full. Draw medium-small almond eyes opened a little wider, lids touching the irises, brows lifted but nearly straight, and cheeks tapering to a rounded, fairly narrow chin.
- Slot 6 (peeking over the pumpkin, startled): googly eyes, big white circles round tiny irises, under high round arched brows. Draw his medium-small almond eyes widened in fright, natural-size dark brown irises with the lids touching them, and brows lifted but nearly straight.
Keep his claw hands in slot 3 and the pumpkin lantern with its black handle across his lower face in slot 6 exactly as they are.
```

```text
S49 — APRIL FOOLS AND PI DAY. Slots 3, 4, 5, 6 and 7 only.
- Slot 3 (lowering the joke glasses, winking): his face is narrow and gaunt, with hollow cheeks and deep lines round the winking eye, so he looks about 50. Lift the cheeks and soften the hollows and the deep lines, firm, not puffy; keep the wink.
- Slot 4 (pointing, laughing): broad, square-jawed, short face; the laugh reaches the cheek edges; deep creases age him. Lengthen the face into an inverted egg tapering to a rounded, fairly narrow chin, bring the open laugh's corners inside his deep smile lines, smooth the creases.
- Slot 5 (hand at chin, smirking): nearly circular face, puffy cheeks, short blunt nose. Make it an inverted egg, longer than wide, with slimmer lifted cheeks and his long nose with its straight bridge and broad, rounded tip, its broad tip close to the upper lip; keep the narrowed eyes and smirk.
- Slot 6 (balancing the pie, proud): the face is too wide and short: full cheeks, broad jaw, little space from nose to chin. Slim the cheeks, lengthen the lower face and the nose a little, and taper the jaw to a rounded, fairly narrow chin.
- Slot 7 (holding the slice, eyes wide): round googly eyes ringed with white, a ball-round face. Draw his medium-small almond eyes opened a little wider, lower lids touching the irises; slim the cheeks into an inverted egg with a rounded, fairly narrow chin; keep the open mouth.
Keep the joke glasses with their nose and moustache and the hand lowering them in slot 3, the hand under his chin in slot 5 and the pie slice in slot 7 exactly as they are.
```

### Batch H

```text
S53 — SAHLAB AND SWEET POTATO. Slots 4 and 5 only.
- Slot 4 (grinning, licking the sahlab moustache): his eyes are round circles with white all round the irises, under high arched brows. Draw his medium-small dark brown almond eyes, lower lids lifting and crinkling with the grin, under low, nearly straight brows.
- Slot 5 ('ooh, hot!' face, O-mouth): his eyes bulge into googly circles, white all round small irises, with brows thrown high and arched. Draw his almond eyes at natural size, opened a little wider for surprise, brows lifted slightly but nearly straight; keep the O-mouth.
Keep the white sahlab foam moustache and his tongue in slot 4 exactly as they are.
```

```text
S54 — STICKY NOTES. Slots 5 and 8 only.
- Slot 5 (laughing, peeling the note off): his face is round and short, with puffy bunched cheeks and a short, broad chin. Lengthen the lower face into his inverted egg, cheeks lifted and firm, flat along the jaw, jaw tapering to a rounded, fairly narrow chin; keep the laugh.
- Slot 8 ('idea!' face): his eyes are big round cartoon circles with white all round the irises, under brows thrown high and arched. Draw his almond eyes, only slightly widened with excitement, brows raised a little but nearly straight; keep the wide open toothy smile.
Keep his hand and the pink note at his forehead in slot 5 exactly as they are.
```

```text
S55 — PLANNING POKER. Slots 3, 5, 6 and 7 only.
- Slot 3 (squinting at the cards, thinking): deep forehead and between-brow creases, hollow cheeks and a sagging mouth age him past 50. Keep the knitted brows and squint with one faint frown line; draw smooth skin, firm, lifted cheeks and firm mouth corners.
- Slot 5 (secretive smile): his cheeks and lower face are full and wide, with extra age lines round the mouth. Slim the cheeks, taper the jaw to a rounded, fairly narrow chin and drop the extra lines; keep the side glance and closed smile.
- Slot 6 (excited reveal grin): the eyes stay wide, round and white-ringed, and puffed cheeks widen the face. Draw his almond eyes with lower lids lifting and crinkling in the grin, slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 7 (surprised, glancing aside): googly white-ringed eyes, a squashed, wide face, heavy forehead creases and a short, upturned nose. Draw his almond eyes opened moderately, still glancing aside, an inverted-egg face, smooth forehead and long straight nose with broad rounded tip; keep the O-mouth.
Keep his finger at his temple in slot 3 exactly as it is.
```

```text
S56 — TIMEBOX. Slots 3 and 4 only.
- Slot 3 (checking the stopwatch): in the sideways glance the eyes are enlarged and round, white showing round the irises, under high arched brows. Draw his almond eyes at natural size, still glancing sideways, brows raised only slightly and nearly straight; keep the O-mouth.
- Slot 4 (startled by the alarm clock): the eyes bulge into googly circles, white all round small centred irises, under high arched brows. Draw his almond eyes opened a little wider for the shock, never round, brows lifted a little and nearly straight; keep the open mouth.
Keep the stopwatch in slot 3 exactly as it is.
```

```text
S58 — FOCUS MODE. Slots 5 and 7 only.
- Slot 5 (headphones on, eyes closed, bobbing): the face is wide, with full cheeks and broad, squarish jaw corners, so it does not taper. Slim the cheeks and draw the inverted egg narrowing to his fairly rounded, fairly narrow chin; keep the closed eyes and toothy smile.
- Slot 7 (finger raised, 'eureka!' face): big round googly eyes with white showing all round the irises, full round cheeks. Draw his medium-small almond eyes opened a little wider, still almond-shaped, lower lids touching the irises, cheeks slimmed to his egg taper; keep raised brows and the 'o' mouth.
Keep the headphones over his ears in slot 5 and the raised finger in slot 7 exactly as they are.
```

```text
S59 — KUDOS. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (showing the gold star, 3/4 smile): heavy crow's feet and cheek lines age him to 50; cheeks very wide, lips thick. Leave only small crinkles at the eye corners, smooth cheeks slimmed to his egg taper and rounded, fairly narrow chin, fairly thin lips.
- Slot 3 (pinning on the star, eyes closed, head down): weathered creases round the eyes and cheeks age him, jaw broad. Leave only small smile crinkles at the eye corners, smooth the cheeks and narrow the jaw to his fairly rounded, fairly narrow chin.
- Slot 4 (offering the star, front smile): wider, rounder face with full cheeks, a broad flat chin and creased skin. Narrow the jaw and lower cheeks into his inverted egg ending in a fairly rounded, fairly narrow chin; smooth the skin.
- Slot 5 (reading the card, looking down): squat, wide face, smudged cheeks, and a smile with too few teeth. Slim the face to his egg taper and rounded chin, smooth clean cheeks, and a wide smile showing his full upper row.
- Slot 6 (thankful nod, eyes closed): squat, wide, broad-jawed face with smudged cheeks. Slim the cheeks and jaw into his inverted egg tapering to a fairly rounded, fairly narrow chin, with smooth clean cheeks; keep the closed eyes and smile.
- Slot 7 (clapping, big smile): wide jaw, full cheeks and a smile stretched thin across the face. Taper the cheeks and jaw to his fairly rounded, fairly narrow chin; a wide natural smile with deep smile lines and the full upper row of teeth.
- Slot 8 (pointing at us, big grin): brows arched high, eyes round and too open, wide jaw, creased cheeks, stretched smile. Brows slightly raised but nearly straight, almond eyes crinkling, jaw tapering to his fairly rounded, fairly narrow chin, smooth cheeks, natural wide smile.
Keep the gold star beside his face in slot 2 exactly as it is.
```

```text
S60 — FOOTBALL. Slots 5 and 7 only.
- Slot 5 (kicking toward us, front smile): broad cheeks, square jaw and a wide flat chin; smile slightly short. Narrow the jaw into his inverted egg with a fairly rounded, fairly narrow chin, and widen the smile to show his full upper row of teeth.
- Slot 7 (kneeling, head back, squinting laugh): heavy, wide lower face and a broad, long chin that age him past 40. Slim the jaw and shorten the chin to his fairly narrow rounded one, smooth the cheeks; keep the squint and laugh.
```

```text
S61 — READING A COMIC. Slots 2, 3 and 5 only.
- Slot 2 (reading, brows raised): eyes too big and round, white above the irises; cheeks and jaw too full. Draw medium-small almond eyes, upper lids lowered over the downward gaze, keep the raised brows, and slim the lower face to a rounded, fairly narrow chin.
- Slot 3 (laughing, head tipped back): the jaw is heavy and wide, cheeks puffed, so the lower face is broad and blunt. Slim the cheeks and jaw so the face tapers to a rounded, fairly narrow chin; keep the closed eyes and open laugh.
- Slot 5 (showing the comic, excited): big round googly eyes, irises ringed with white, on a short, ball-round face with a stubby chin. Draw medium-small almond eyes opened moderately, lids touching the irises, and a longer inverted-egg face tapering to a rounded, fairly narrow chin.
Keep the comic and his pointing hand in slot 5 exactly as they are.
```

```text
S63 — PHONE. Slots 3, 5 and 7 only.
- Slot 3 (selfie, peace sign, winking): forehead lines, deep crow's feet, creases under his open eye and lumpy creased cheeks age him. Give him the smooth skin of a man around 40, with only small outer-corner eye crinkles and his smile lines; keep the wink.
- Slot 5 (surprised, brows up): huge googly eyes ringed with white, a tiny 'o' mouth, a square heavy jaw, grey stubble on lip and chin. Draw his almond eyes opened moderately, a wider surprised mouth, the egg face tapering to a rounded, fairly narrow chin, clean-shaven.
- Slot 7 (holding the cable, looking up): eyes too round and large, white round the irises; heavy, long jaw; grey stubble on the upper lip and chin. Draw almond eyes glancing up, lids touching the irises, a tapering rounded chin, clean-shaven; keep the worried mouth.
Keep the peace-sign hand in slot 3, the phone in slot 5 and the hand raised to his brow in slot 7 exactly as they are.
```

```text
S64 — LIGHTS ON, LIGHTS OFF. Slots 2, 4 and 5 only.
- Slot 2 (startled in the dark): huge round googly eyes ringed with white, wide round cheeks and a tiny 'o' mouth. Draw almond eyes opened moderately wide, slim the cheeks into a long egg face with a rounded, fairly narrow chin; make the open mouth wider.
- Slot 4 (sweeping the torch, glancing sideways): round eyes, white on both sides of the iris; brows too high and arched. Draw almond eyes keeping the same sideways glance, lower lids lifting and crinkling in the smile, and low, nearly straight brows, gently arched.
- Slot 5 (torch under his chin, spooky grin): eyes too round and large, white showing; cheeks full, chin short. Draw almond eyes, slim the cheeks into a longer egg tapering to a rounded, fairly narrow chin; keep the spooky grin, thin lips and deep smile lines.
Keep the torch held under his chin in slot 5 exactly as it is.
```

### Batch I

```text
S65 — SPRINT CAPACITY. Slots 2, 3, 4, 6 and 7 only.
- Slot 2 (looking down at the calendar): puffy lower cheeks and a wide jaw ending in a short, broad chin make the face round and heavy. Slim the lower cheeks and jaw so the face tapers from broad cheekbones to a rounded, fairly narrow chin.
- Slot 3 (flipping a page, brows raised): big round googly eyes with white all round tiny dot pupils, and puffy cheeks. Draw his medium-small almond eyes, opened a little wider for surprise, dark brown irises resting on the lower lids; slim the cheeks to his tapering chin.
- Slot 4 (looking down, counting the chips): full, puffed lower cheeks and a broad jaw down to a short, wide chin make the face round. Narrow the lower cheeks and jaw so the face tapers from broad cheekbones to a rounded, fairly narrow chin.
- Slot 6 (holding out the green chip): round apple cheeks and a near-vertical wide jaw ending in a short, broad chin make the face as wide as it is long. Make it a longer-than-wide inverted egg, tapering from the cheekbones to a rounded, fairly narrow chin.
- Slot 7 (balancing the calendar, winking): full cheeks and a jaw that stays wide to a short, broad chin make the face chubby. Narrow the lower cheeks and jaw into his inverted egg, tapering to a rounded, fairly narrow chin; keep the wink.
Keep the hand and green chip by his ear and jaw in slot 6 exactly as they are.
```

```text
S70 — PI PLANNING. Slots 2, 5, 7 and 8 only.
- Slot 2 (hand on the board, welcoming smile): full cheeks and wide jaw, so the face barely tapers; brows thin, arched and high. Taper the cheeks and jaw to a rounded, fairly narrow chin; draw medium-thick brows, low and close over the eyes, nearly straight.
- Slot 5 (hands on hips, satisfied): puffy cheeks, wide rounded lower face with no taper; thin high-arched brows; faint smile lines. Keep the closed-lip smile; taper the jaw to a rounded, fairly narrow chin, draw low, nearly straight medium-thick brows and deepen the smile lines.
- Slot 7 (arms wide, laughing): face ball-round, cheeks puffed sideways, jaw wide; thin high brows; eyes too wide. Keep the laugh on his inverted-egg face: broad cheekbones tapering to a rounded, fairly narrow chin, low nearly straight brows, medium-small almond eyes, lower lids crinkled.
- Slot 8 (dusting off his hands, proud): wide jaw, broad soft chin, full cheeks, thin arched brows, weak smile lines. Keep the closed-lip smile; taper cheeks and jaw to a rounded, fairly narrow chin, draw low, nearly straight medium-thick brows and deep smile lines.
```

```text
S78 — SIX THINKING HATS. Slots 4 and 6 only.
- Slot 4 (laughing beside the red hat): round eyes with white all round small irises; cheeks puffed and face rounder. Draw almond eyes, upper lids over the iris, lower lids lifted and crinkled; flatter along the jaw cheeks tapering to a rounded, fairly narrow chin. Keep the open laugh.
- Slot 6 (finger up, 'idea!' face): eyes widened into big white-ringed circles, worst in the right-hand eye. Draw medium-small almond eyes, opened a little wider only by lifting the upper lids, lids touching the iris; keep the raised brows and open grin.
Keep the red hat beside his face in slot 4 and the raised finger in slot 6 exactly as they are.
```

```text
S79 — CANVAS. Slots 2, 6, 7 and 8 only.
- Slot 2 (welcoming at the board): lower face wide and heavy: jowly cheeks, broad jaw, blunt chin; thin narrow strip of teeth. Draw cheeks flat along the jaw tapering to a rounded, fairly narrow chin; a wide smile showing the full upper row of teeth, deep smile lines.
- Slot 6 (head tipped down, arranging): lower face squashed and wide, with jowly fullness under the cheeks and a broad chin. Draw firm cheeks lifted under the eyes, flat along the jaw and a rounded, fairly narrow chin with the soft crease under the lower lip; keep the closed smile and downward look.
- Slot 7 ('ta-da!'): full cheeks, wide jaw, broad chin; thin narrow band of teeth; eyes slightly round. Draw cheeks flat along the jaw tapering to a rounded, fairly narrow chin, a wide smile with the full upper row and deep smile lines, almond eyes with lifted, crinkled lower lids.
- Slot 8 (twirling the marker, happy): heavy wide lower face and thin narrow band of teeth; eyes round, too much white. Draw cheeks flat along the jaw tapering to a rounded, fairly narrow chin, a wide smile with the full upper row and deep smile lines, crinkled almond eyes.
```

```text
S81 — CUMULATIVE FLOW. Slots 4 and 7 only.
- Slot 4 (measuring a band, surprised): big round pop-eyes with white all round the iris, brows arched high. Draw his medium-small almond eyes opened a little wider, lids touching the iris, under dark, medium-thick, nearly straight brows lifted slightly. Keep the open mouth.
- Slot 7 (hand on chin, puzzled): round, oversized eyes with white above and below the iris; the raised brow is thin and sharply arched. Draw narrower almond eyes glancing sideways, the raised brow dark, medium-thick and only slightly lifted, the other low and nearly straight.
Keep his hand on his chin in slot 7 exactly as it is.
```

```text
S85 — FEATURE FLAGS. Slots 4 and 5 only.
- Slot 4 (sceptical, hand at chin, brow raised): eyes big, round and ringed with white; cheeks full, face short and wide. Draw medium-small almond eyes with lifted lower lids and slim the lower cheeks into his tapering inverted egg. Keep the raised brow and smirk.
- Slot 5 (sceptical, brow raised, pointing): eyes round and ringed with white, brows thin and arched, lower face broad and U-shaped. Draw medium-small almond eyes, dark medium-thick brows (one still raised), and taper the jaw to a rounded, fairly narrow chin. Keep the smirk.
Keep the hand under his chin in slot 4 and the switch panel in slots 4 and 5 exactly as they are.
```

```text
S87 — PSYCHOLOGICAL SAFETY. Slots 2, 3, 6, 7 and 8 only.
- Slot 2 (shield at chest, smiling): full cheeks, broad U-shaped jaw, narrow smile with a thin band of teeth, thin short brows. Slim the cheeks, taper the jaw to his fairly rounded, fairly narrow chin; widen the smile to the full upper row; dark medium-thick brows.
- Slot 3 (offering shield): full lower face, broad chin, narrow smile with a thin band of teeth, shallow smile lines, thin short brows. Taper to his fairly rounded, fairly narrow chin; widen the smile to the full upper row; deepen the smile lines; dark medium-thick brows.
- Slot 6 (arms open, welcoming): full cheeks, broad jaw and a wide round chin, narrow smile, thin brows. Slim the cheeks and taper the jaw to his fairly rounded, fairly narrow chin; widen the smile to show the full upper row; dark medium-thick brows.
- Slot 7 (hand on heart, thankful smile): wide full lower face, broad chin, smile narrower and showing fewer upper teeth, thin light brows. Taper to his fairly rounded, fairly narrow chin; widen the smile to the full upper row with deep smile lines; dark medium-thick brows.
- Slot 8 (proud, shield beside face): broad full cheeks, wide rounded chin, narrow smile with a thin band of teeth, thin short brows. Slim the cheeks and taper to his fairly rounded, fairly narrow chin; widen the smile to the full upper row; dark medium-thick brows.
Keep the blue shield beside his face in slot 8 exactly as it is.
```

```text
S88 — TEAM MOOD. Slots 4 and 5 only.
- Slot 4 (neutral face, grey card): eyes open wide and round, white above and around the irises; lower face broad and square-jawed. Draw medium-small almond eyes with relaxed lids, and taper the jaw to a rounded, fairly narrow chin. Keep the flat closed mouth.
- Slot 5 (sad face, blue card beside him): big round puppy eyes ringed with white; jaw broad and squarish. Draw medium-small almond eyes, soft and kind, and taper the jaw to a rounded, fairly narrow chin. Keep the up-tilted brows and down-turned mouth.
Keep the grey card beside his face in slot 4 and the blue card beside his face in slot 5 exactly as they are.
```

```text
S89 — WORKING AGREEMENT. Slots 2, 3, 4, 5, 6 and 8 only.
- Slot 2 (unrolling the scroll, surprised): eyes are big googly balls ringed with white, cheeks full and chin broad. Draw his medium-small almond eyes opened a little wider, lids touching the irises; keep the raised brows and open grin; slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 3 (reading the scroll, looking down): the lower face spreads as wide as the temples, the near cheek bulges and the chin is broad and short. Even looking down, narrow the cheeks below the cheekbones and taper to a rounded, fairly narrow chin; keep the downcast eyes and closed smile.
- Slot 4 (writing on the scroll, eyes closed): cheeks spread out to the jaw, so the face is pear-shaped with a broad U-shaped chin. Narrow the jaw into his inverted-egg taper ending in a rounded, fairly narrow chin; keep the closed eyes and closed-lip smile.
- Slot 5 (signing the scroll, eyes closed): the face is short and wide, almost a ball, with full round cheeks. Make it longer than wide: slim the cheeks below the cheekbones, narrow the jaw and lengthen the chin slightly; keep the closed, crinkled eyes and full upper-teeth smile.
- Slot 6 (hand on heart, firm nod): the face is round, the jaw nearly as wide as the cheekbones and the chin wide and flat. Keep the face broad at the temples and cheekbones, then taper the jaw to a rounded, fairly narrow chin; keep the eyes, brows, nose and smile.
- Slot 8 (rolling up the scroll, content): the face is wide and round, with full cheeks and a short broad chin. Slim the cheeks, narrow the jaw and lengthen the chin a little, so the face tapers to a rounded, fairly narrow chin; keep the closed eyes and closed-lip smile.
```

### Batch J

```text
S90 — DEFINITION OF DONE. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (holding up the stamp, grinning): the near cheek puffs out wide, the jaw is heavy and the chin broad. Slim the near cheek below the cheekbone and taper the jaw to a rounded, fairly narrow chin; keep the almond eyes and full upper-teeth smile.
- Slot 3 (reading the card, looking down): the lower face is broad and heavy and the chin wide and short. Even looking down, narrow the face from the cheekbones to a rounded, fairly narrow chin; keep the lowered eyes and smile.
- Slot 4 (ticking a box, nodding, head tilted): cheeks are full and heavy and the face widens at the jaw, more pear than egg. Slim the cheeks and narrow the jaw so the face tapers from the cheekbones to a rounded, fairly narrow chin; keep the closed eyes and smile.
- Slot 5 (pressing the stamp, frowning): the cheeks sag, the lower face is heavy and deep folds round the mouth make him look older than 40. Keep the knitted brows, squint and down-turned mouth; smooth the folds, firm the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 6 (checking the card, one eye shut, head tilted): the face looks stretched along the tilt, the near cheek bulges and the jaw is wide. Restore his normal proportions along the tilt, flatten the near-cheek bulge and narrow the jaw to a rounded, fairly narrow chin; keep the shut eye, squint and smile.
- Slot 7 (holding up the stamped card, proud): already close, but the jaw and chin are a little wide and full. Narrow the jaw slightly to a rounded, fairly narrow chin with a soft crease under the lower lip; keep the almond eyes and full upper-teeth smile exactly.
- Slot 8 (blowing on the stamp, cheeky): the jaw is very broad, the eyes round with extra white and the nose short. Draw medium-small almond eyes glancing sideways, a prominent, fairly long nose with a broad rounded tip and a narrower jaw; keep the raised brows and pursed lips.
Keep the green stamp and white card exactly as they are, including the stamp held up beside his face in slot 2 and near his mouth in slot 8.
```

```text
S91 — SKILLS MATRIX. Slots 2, 3, 4, 5, 6, 7 and 8 only.
- Slot 2 (holding the toolbox, ready smile): the face is ball-round and short, cheeks full, jaw as wide as the cheekbones, chin short and broad. Make it longer than wide, broad at the temples and cheekbones, tapering to a rounded, fairly narrow chin; keep the almond eyes and teeth smile.
- Slot 3 (peering into the toolbox, head tilted down): the lower face spreads wide and fleshy into a broad chin. Narrow the cheeks and jaw below the cheekbones to a rounded, fairly narrow chin; keep the lowered almond eyes and open smile.
- Slot 4 (examining the wrench, impressed): eyes are big googly balls ringed with white and the cheeks puffed round. Draw his medium-small almond eyes opened a little wider, lids touching the irises; slim the cheeks and taper to a rounded, fairly narrow chin; keep the raised brows and pursed 'oo' mouth.
- Slot 5 (paintbrush flourish, winking): cheeks are puffy and round, the face wide and short. Slim the cheeks, narrow the jaw and lengthen the chin slightly to a rounded, fairly narrow chin; keep the wink, the crinkled open eye and the teeth smile.
- Slot 6 (counting the fanned tools): the face is round and short with full cheeks and a broad chin, and the eyes sit too open. Taper the jaw to a rounded, fairly narrow chin, and lift the lower lids so the almond eyes crinkle in the smile; keep the teeth smile.
- Slot 7 (handing over the hammer, encouraging): the face is round, with full cheeks and the jaw almost as wide as the cheekbones. Keep the width at the temples and cheekbones, then taper the jaw to a rounded, fairly narrow chin; keep the almond eyes and teeth smile.
- Slot 8 (thumbs-up, confident): the face is round and short with a broad, flat chin. Lengthen the face slightly and narrow the jaw to a rounded, fairly narrow chin with a soft crease under the lower lip; keep the almond eyes and teeth smile.
Keep the wrench and hand beside his face in slot 4, the paintbrush and hand in slot 5, the hammer in slot 6 and the thumbs-up in slot 8 exactly as they are.
```

```text
S97 — WSJF. Slots 4, 7 and 8 only.
- Slot 4 (watching the scale tip, surprised): googly round eyes, white all round tiny pupils, and puffed cheeks. Draw his medium-small almond eyes opened a little wider, lids framing the iris, cheeks slimmed to a rounded, fairly narrow chin; keep the raised brows and 'o' mouth.
- Slot 7 (holding up the box, knowing smile): the face is squarish, with puffed cheeks, a broad jaw and a blunt chin. Slim the cheeks and jaw into his inverted egg, tapering from broad cheekbones to a rounded, fairly narrow chin; keep eyes and smile.
- Slot 8 (holding the scale, OK sign): squarish, full-cheeked face with a broad chin; the smile is a little narrow and lifts on one side. Taper cheeks and jaw to a rounded, fairly narrow chin; make the smile wide and even, full upper teeth showing.
Keep the raised hands beside his face in slots 4 and 8 and the orange box in slot 7 exactly as they are.
```

```text
S100 — VALUE AND EFFORT. Slots 7 and 8 only.
- Slot 7 (pointing at the green quarter, knowing nod): under the raised brows the eyes are big and round, white above and below the iris. Draw medium-small almond eyes, a touch wider than usual, lower lids lifting slightly with the closed-mouth smile; keep the brows raised.
- Slot 8 (board under his arm, thumbs-up): beady eyes, no smile crinkle, cheeks wide and full, a short nose, a narrow smile. Draw crinkled almond eyes, cheeks tapering to his rounded chin, a longer nose near the lip, a wide smile showing the upper teeth.
Keep the thumbs-up hand in slot 8 exactly as it is.
```

```text
S104 — DECISION LOG. Slots 4, 7 and 8 only.
- Slot 4 (hands out like a scale, weighing, glancing up): eyes are round, bigger than his and ringed with white; the face reads broad. Keep the upward glance and pursed lips, but draw medium-small almond eyes looking up, white showing only below the iris, and taper the jaw towards a rounded, fairly narrow chin.
- Slot 7 (gavel up, nodding firmly, settled): cheeks are very full and the jaw wide and jowly, so the face looks puffy and heavier. Keep the closed eyes and closed-lip smile, but slim the cheeks and taper the jaw into his inverted egg with a rounded, fairly narrow chin.
- Slot 8 (closing the notebook, satisfied smile): fuller cheeks, a wider jaw, small roundish eyes and a slightly narrow smile with soft lines. Draw almond eyes with lifted, crinkled lower lids, a jaw tapering to his rounded, fairly narrow chin, and his wide smile showing the full upper row, with deep smile lines.
Keep the gavel beside his head in slot 7 exactly as it is.
```

```text
S105 — CYNEFIN. Slots 3 and 7 only.
- Slot 3 (dizzy, watching the needle spin): crossed googly eyes, white showing all round dot pupils, brows shot high. Draw medium-small almond dark brown eyes with lids, irises partly under the upper lid, both glancing down towards the compass; brows lower, nearly straight. Keep the 'o' mouth.
- Slot 7 (mock alarm, hands up): perfect circle eyes ringed with white, dot pupils; face a touch round and broad. Draw medium-small almond eyes opened a little wider only by raising the upper lid, irises touching the lower lid; taper the face to a narrower rounded chin. Keep the open mouth.
Keep the hand at his ear in slot 3 and both raised hands beside his head in slot 7 exactly as they are.
```

```text
S111 — RISKIEST ASSUMPTION. Slots 3, 6 and 7 only.
- Slot 3 (holding up the card, puzzled): the eye under the raised brow is enlarged and round, white showing above the iris. Keep the raised brow and pursed mouth; draw that eye as his medium-small almond eye opened slightly wider, upper lid touching the iris.
- Slot 6 (pointing at the card, brows furrowed): wide square jaw, broad chin, narrow grin with a thin strip of teeth. Taper to a rounded, fairly narrow chin; widen the grin to show the full upper row of teeth, with deep smile lines.
- Slot 7 ('found it!', mouth wide open): googly eyes, white all round small pupils, on a ball-round, puffy-cheeked, broad-jawed face. Draw almond eyes opened a little wider, still almond-shaped, irises touching the lids, in an inverted-egg face tapering to a rounded, fairly narrow chin; keep the open mouth.
Keep the gold-rimmed magnifying glass beside his head in slot 7 exactly as it is.
```

```text
S112 — RISK REGISTER. Slots 2, 3, 5 and 6 only.
- Slot 2 (sign beside his face, alert smile): wide square jaw, broad chin, and a narrow smile with lips closing over the teeth. Taper to a rounded, fairly narrow chin; widen the smile to show the full upper row of teeth, with deep smile lines.
- Slot 3 ('watch out!', brows up, 'oh' mouth): googly eyes, white discs round tiny irises, on a ball-round, puffy-cheeked, broad-jawed face. Draw almond eyes opened a little wider, irises touching the lids, in an inverted-egg face tapering to a rounded, fairly narrow chin; keep the 'oh' mouth.
- Slot 5 (waving the flag, frowning shout): face sides run nearly parallel down to a heavy, square jaw, with full cheeks. Keep the frown and open mouth; slim the cheeks and taper the jaw to a rounded, fairly narrow chin.
- Slot 6 (tiptoeing, side glance, pursed lips): both eyes bulge round, white showing all round the irises. Keep the sideways glance, but draw medium-small almond eyes with the lids touching the top and bottom of each iris.
Keep the yellow warning sign beside his face in slots 2 and 3, and the red flag above his head and his raised arm beside his face in slot 5, exactly as they are.
```

### Batch K

```text
S11 — SUNNY DAY. Slot 8 only.
- Slot 8 (peeking over lowered sunglasses, brows raised): the eyes are round and enlarged, white all round the iris; the face is long and narrow. Draw medium-small almond eyes opened a little wider with a sliver of white, broader cheekbones and a shorter, rounded chin.
Keep the finger on the sunglasses and the sunglasses sitting low on his nose exactly as they are.
```

```text
S20 — WINDY DAY. Slot 4 only.
- Slot 4 (surprised badge grab): eyes are googly circles, white all round a small iris; cheeks too round. Draw medium-small dark brown almond eyes opened a little wider, still almond-shaped, upper lids cutting the top of each iris, and taper the cheeks to a fairly rounded, fairly narrow chin.
```

```text
S22 — CLEAR NIGHT. Slot 6 only.
- Slot 6 (lowering the telescope, amazed): googly circular eyes ringed with white, puffed cheeks making the face ball-round. Draw his almond eyes only slightly widened, lower lids touching the irises, slim cheeks tapering to a rounded, fairly narrow chin; keep the raised brows and 'o' mouth.
Keep the telescope in slot 6 exactly as it is.
```

```text
S31 — IFTAR AT SUNSET. Slot 4 only.
- Slot 4 (cannon boom, hands at ears): huge googly eyes, white all round the iris; short, round face. Draw medium-small almond eyes, opened slightly wider, lower lids a little lifted; keep the raised brows and open laugh; jaw tapering to a rounded, fairly narrow chin.
Keep both hands cupped at his ears and the watch on his wrist exactly as they are.
```

```text
S36 — EID AL-ADHA. Slots 6 and 8 only.
- Slot 6 (eating a spoonful of fatta): eyes wide and round with white all round the irises, high arched brows, a narrow angular jaw. Draw medium-small almond eyes opened a touch wider, lower lids lifted, brows just lifted, nearly straight, a softer rounded jaw.
- Slot 8 (hand on heart, warm smile): a closed-lip smirk, high arched brows and a long, narrow chin stretch the face. Draw his wide smile showing the full upper row with deep smile lines, brows low and nearly straight, a shorter, rounded chin.
Keep his hand, the spoon and its fatta at his mouth in slot 6 exactly as they are.
```

```text
S41 — SHAM EL-NESSIM PICNIC. Slot 5 only.
- Slot 5 (pinching his nose, disgusted sideways glance): big round eyes showing too much white; brows raised into deep, ageing forehead creases. Draw almond eyes opened a little wider, still almond-shaped, lids touching the top and bottom of each dark brown iris, brows slightly lower, faint forehead lines, still disgusted.
Keep the hand pinching his nose exactly as it is.
```

```text
S44 — WATCHING FIREWORKS. Slot 8 only.
- Slot 8 (hands on cheeks, 'wow!' face): eyes are round googly cartoon eyeballs, white ringed all round tiny irises, dark-rimmed. Draw almond eyes opened a little wider, still almond-shaped with natural lids, dark brown irises touching the upper lid; keep the raised brows and small 'o' mouth.
Keep both hands pressed on his cheeks exactly as they are.
```

```text
S51 — SUMMER HOLIDAY. Slot 4 only.
- Slot 4 (holding the watermelon, eyes wide): round, white-ringed eyes, a full-cheeked, short face. Draw his medium-small almond eyes opened a little wider under the raised brows, lower lids touching the irises; slim the cheeks and jaw into an inverted egg with a rounded, fairly narrow chin.
```

```text
S62 — OUD AND DARBUKA. Slots 4 and 5 only.
- Slot 4 (drumming, the first frame): the same wide, square lower face as slot 5. Slim it the same way, so the two drum frames match.
- Slot 5 (tapping the darbuka, grinning): the face is too wide and square, nearly as wide as long, with full cheeks and a blunt jaw. Narrow the lower cheeks and jaw into a longer inverted egg tapering to a rounded, fairly narrow chin.
```

```text
S66 — SPRINT GOAL. Slot 2 only.
- Slot 2 (holding the target beside his face): full cheeks and a wide jaw leave a broad chin that barely tapers, and the brows are thin and arched. Taper the face to a rounded, fairly narrow chin; make the brows medium-thick, low and nearly straight.
Keep the red-and-white target board at the side of his face in slot 2 exactly as it is.
```

### Batch L

```text
S69 — RELEASE FORECAST. Slot 6 only.
- Slot 6 (calendar in hand, so-so 'probably' face): eyes are round stares, white all round the irises; the chin is pointed. Keep the raised brows and closed smirk; draw medium-small almond eyes, lids touching the irises top and bottom, and a rounded, fairly narrow chin.
```

```text
S71 — EPIC ROADMAP. Slot 6 only.
- Slot 6 (rolled map as a spyglass): the uncovered eye is a big round stare, white all round the iris. Keep the raised brow and O-mouth; draw that eye as a medium-small almond, opened a little wider, lids touching the iris top and bottom.
Keep the rolled map and the hand holding it to his other eye in slot 6 exactly as they are.
```

```text
S72 — SCRUM OF SCRUMS. Slot 6 only.
- Slot 6 (walkie-talkie at arm's length, surprised): both eyes are huge round googly cartoon eyes, white circles round tiny dot irises. Keep the alarm, raised brows and O-mouth; draw human, medium-small dark brown almond eyes opened a little wider, upper lids lifted, lower lids touching the irises.
```

```text
S76 — RETRO ACTIONS. Slot 6 only.
- Slot 6 (holding up the ticked notepad, delighted): the wide-open eyes go round, with white showing all round the iris, and the cheeks are a touch full. Draw medium-small almond eyes, opened a little wider, with lower lids lifting into the big open smile, and cheeks flat along the jaw.
```

```text
S93 — ONE-ON-ONE. Slot 5 only.
- Slot 5 (laughing, hand on belly): the face goes broad: puffed cheeks, wide jaw, barely tapering chin. Keep the laugh and squint; taper the jaw to a rounded, fairly narrow chin, cheeks lifted not puffed, full upper row of teeth, only a hint of the lower.
```

```text
S94 — STAKEHOLDER MAP. Slots 3 and 5 only.
- Slot 3 (three-quarter smirk, studying a chip): full cheeks and a wide square jaw lose a rounded, fairly narrow chin; the raised brow arches too high. Keep the smirk; slim cheeks and jaw to his tapered chin, the brow low, nearly straight, only gently lifted.
- Slot 5 (frowning down, lips pushed out): sagging, jowly cheeks and jaw and a short, blobby nose with no clear bridge tip make him heavier and older. Keep the knitted brows and pout; restore firm cheekbones tapering to a rounded, fairly narrow chin, no jowls, nose tip broad, not bulbous.
```

```text
S95 — ADKAR CHANGE. Slot 7 only.
- Slot 7 (delighted, figure at the top step): the eyes go large and round, white showing round the irises. Keep the raised brows and open smile; draw his medium-small dark brown almond eyes, opened a little wider, lids touching the iris top and bottom.
```

```text
S98 — MOSCOW. Slot 5 only.
- Slot 5 (ball over the bin, hesitating): huge round googly eyes, white ringed round tiny pupils, and wide round cheeks. Draw two equal medium-small almond eyes opened a little wider under the raised brows, cheeks slimmed to his tapering chin; keep the sideways smirk.
```

```text
S102 — BUY A FEATURE. Slot 8 only.
- Slot 8 (empty palms, 'all spent!' shrug): round eyes ringed with white, bigger than his, and the face wide with full cheeks and a blunt chin. Keep the 'o' mouth and raised brows, but draw almond eyes opened a little wider and taper the jaw to a rounded, fairly narrow chin.
```

---

## 5. Left out of this round

- **Already his face** (13 sheets): S15, S19, S23, S27, S30, S37, S42, S43, S67, S68, S75, S83, S113.
- **No source sheet** (S16, S17, S18, S45 and S50): an umbrella, a party hat or a hard hat covers his hair there, so they were never in the hair rounds and their source PNGs are gone; the packs ship from their own cells. S16 and S50 match the original. S17 slot 5, S18 slots 3 and 7 and S45 slots 4 and 6 drift a little (round lower face, big eyes). If you want them in, Claude can rebuild a sheet for each from the shipped cells for you to edit.
- **S02 slots 2 to 7**: they ship with the S01 heads, so batch A fixes them.
- **Slot 1 of the context, tool and companion sheets**: his standing pose there only sets the scale and never shows.

---

## 6. Check every edit before you keep it

Put the edited sheet next to the one you started from, next to `ref-face.png` and next to `S01-approved.png`.

- [ ] In every slot you edited it is the original's face: the inverted-egg shape tapering to a soft U chin a clear step below his mouth, firm cheeks, low straight brows, almond eyes, the long nose with its broad tip, the wide smile with the upper row of teeth, the big ears.
- [ ] No round cartoon eyes, no white all round an iris, no grey shadow on his lip or chin, no heavy wrinkles.
- [ ] The same expression as before in each slot (the same look, smile, squint or laugh), apart from any change its slot line asks for.
- [ ] Nothing else moved: the same hair, head size and tilt, pose, hands, props, clothes, colleagues, the band on his right wrist and the watch on his left.
- [ ] Transparent background, 4 × 2 slots, nothing touching a slot edge.

A small shift in skin colour or head size is fine: the build corrects both, except in the companion scenes, which ship as drawn, so watch his skin and head size there. **One or two slots still wrong:** edit again with _"Keep every slot exactly as it is except slot N. In slot N change only his face, to match ref-face.png and the other slots. The same 1536 x 1024 image, fully transparent background, his hair, body, props and every other slot unchanged."_ **His hair or body changed:** start again from the sheet in the zip, not from the edit.

---

## 7. Hand back

Send each batch's edited sheets back as one zip, under their usual names (`S01-faces.png`, `N02-dinosaur-priorities.png` …). Only the sheets you redid are needed. Batch A comes back on its own, before anything else; the rest can come back one at a time.

Claude will then rebuild the packs (`scripts/build-mascot-packs.py`, which also matches head size, skin and clothes as before) and the companion scenes (`scripts/build-mascot-scenes.py`, after updating each returned sheet's sha256 in `companion-scenes.json`). It will also crop every face again beside the original for the same three-judge review, run the head audit and the tests, and republish the review page. The code doesn't change.
