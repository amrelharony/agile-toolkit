# Amr: hair, round 3

[Round 2](AMR-HAIR-ROUND-2.md) gave six sheets the live haircut in every slot, S01's faces among them, and six more in one slot each. This round brings the rest to the same haircut, with S01 as the one to match: 53 sheets in all, in five batches. That is the 47 sheets round 2 didn't touch, and the six it edited in one slot only (S12, S14, S30, S36, S44 and S55), whose other seven slots still have round 1's hair. S16 to S18, S45 and S50 aren't in it: an umbrella, a party hat or a hard hat covers his hair in every slot.

**Status:** all 55 sheets came back on 7 November 2026 (`AMR_Hair_Round_3_{A..E}_Reviewed.zip`). 52 are built. S06, S41 and S62 keep their old versions: S06's hair came back coarse and curly, S41's faces and shirts came back with faceted shading, and S62's hair came back brown and curlier. Seven of the built sheets were marked as needing review only because figures shifted inside their slots, which the build's alignment absorbs. In the built sheets the hair now covers 123% as much of his head as the live idle's (129% before; live's own frames: 120%). A few slots still show some curl up close, most in S12, S14, S30 and S33. The new hair's finer highlights broke the head measure's hair patch into pieces, so `mascot_heads.py` now bridges 1 px gaps first.

The audit on 5 November 2026 measured these sheets against the live sprite (`public/mascot/amr.*.webp`):

- **Too much hair on top.** It covers 26% of his head instead of 22%, and rises in a round dome above his skull where the live cut sits close to it.
- **Flat near-black.** The brightest tenth of the hair is L\* 23 against live's 25: little of the soft highlight on top.
- **Curly texture on top** in some slots, most in S32, S36, S55, S59 and S63: the outline is smooth, but the hair inside it is coiled.

Three slots of sheets round 2 redid whole are still curly on top too: S33 slot 5 and S47 slots 6 and 7. They are in batch A.

One lesson from round 2: asking for sides cut "very short, ears sticking out clearly" made them thinner than live's. The build now thickens side hair that comes out thinner than live's, and the `S01-faces.png` in each zip is that corrected version. So this round asks for S01's sides, no shorter.

Skin colour and head size still don't need care in the art: the build matches both to the live sprite.

This page is for **ChatGPT image generation**, as **edits** of the sheets you already have.

---

## 1. The five zips

Each zip holds this page, the three references and its batch's sheets. Upload one zip per conversation.

| Image                                                          | Why                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `S01-faces.png`                                                | The haircut to match, from the front. Don't edit it                              |
| [`reference/ref-hair-fix-3.png`](reference/ref-hair-fix-3.png) | The live haircut and S01 (TARGET) above the hair in these sheets now (NOT THIS)  |
| [`reference/ref-hair.png`](reference/ref-hair.png)             | The live haircut from eight angles: front, turned both ways, looking up and down |

**Settings:** 1536 × 1024, transparent background, PNG, high quality, as before. If the image shows a select (brush) tool, paint over his hair in the slots you are fixing before you send the prompt, so nothing else is redrawn.

### Batch A: the core sheets, and three slots from round 2

These are on screen most: pointing, being touched, resting, page moments, waving and walking.

| Sheet | File                 | Slots              |
| ----- | -------------------- | ------------------ |
| S02   | `S02-explaining.png` | only slot 8        |
| S03   | `S03-pointing.png`   | all eight slots    |
| S04   | `S04-touch.png`      | all eight slots    |
| S06   | `S06-balance.png`    | all eight slots    |
| S07   | `S07-rest.png`       | all eight slots    |
| S08   | `S08-page.png`       | all eight slots    |
| S09   | `S09-social.png`     | all eight slots    |
| S10   | `S10-stroll.png`     | all eight slots    |
| S33   | `S33-sweets.png`     | only slot 5        |
| S47   | `S47-green.png`      | only slots 6 and 7 |

### Batch B

| Sheet | File              | Slots           |
| ----- | ----------------- | --------------- |
| S11   | `S11-sun.png`     | all eight slots |
| S12   | `S12-heat.png`    | all eight slots |
| S13   | `S13-scorch.png`  | all eight slots |
| S14   | `S14-cold.png`    | all eight slots |
| S15   | `S15-cosy.png`    | all eight slots |
| S19   | `S19-snow.png`    | all eight slots |
| S20   | `S20-wind.png`    | all eight slots |
| S21   | `S21-grey.png`    | all eight slots |
| S22   | `S22-stars.png`   | all eight slots |
| S24   | `S24-coffee.png`  | all eight slots |
| S26   | `S26-koshary.png` | all eight slots |
| S27   | `S27-evening.png` | all eight slots |

### Batch C

| Sheet | File              | Slots           |
| ----- | ----------------- | --------------- |
| S28   | `S28-late.png`    | all eight slots |
| S29   | `S29-weekend.png` | all eight slots |
| S30   | `S30-fanous.png`  | all eight slots |
| S31   | `S31-iftar.png`   | all eight slots |
| S32   | `S32-suhoor.png`  | all eight slots |
| S34   | `S34-kahk.png`    | all eight slots |
| S35   | `S35-eid.png`     | all eight slots |
| S36   | `S36-adha.png`    | all eight slots |
| S37   | `S37-blessed.png` | all eight slots |
| S38   | `S38-mawlid.png`  | all eight slots |
| S39   | `S39-xmas.png`    | all eight slots |

### Batch D

| Sheet | File                | Slots           |
| ----- | ------------------- | --------------- |
| S40   | `S40-eggs.png`      | all eight slots |
| S41   | `S41-picnic.png`    | all eight slots |
| S42   | `S42-nayrouz.png`   | all eight slots |
| S43   | `S43-flag.png`      | all eight slots |
| S44   | `S44-fireworks.png` | all eight slots |
| S46   | `S46-flowers.png`   | all eight slots |
| S48   | `S48-spooky.png`    | all eight slots |
| S49   | `S49-prank.png`     | all eight slots |
| S51   | `S51-summer.png`    | all eight slots |
| S52   | `S52-school.png`    | all eight slots |
| S53   | `S53-winter.png`    | all eight slots |

### Batch E

| Sheet | File              | Slots           |
| ----- | ----------------- | --------------- |
| S54   | `S54-sticky.png`  | all eight slots |
| S55   | `S55-poker.png`   | all eight slots |
| S56   | `S56-timer.png`   | all eight slots |
| S57   | `S57-ship.png`    | all eight slots |
| S58   | `S58-focus.png`   | all eight slots |
| S59   | `S59-kudos.png`   | all eight slots |
| S60   | `S60-ball.png`    | all eight slots |
| S61   | `S61-reading.png` | all eight slots |
| S62   | `S62-music.png`   | all eight slots |
| S63   | `S63-phone.png`   | all eight slots |
| S64   | `S64-lights.png`  | all eight slots |

---

## 2. The prompt

Paste the shared block, then the line for that sheet from [section 3](#3-the-sheets), in the same message.

```text
Edit the first attached image, an Amr sprite sheet. Change ONLY his hair, in the slots named below, and keep everything else exactly as it is.

THE HAIR. It must match the attached S01-faces.png exactly, and the TARGET row of ref-hair-fix-3. It must not look like the NOT THIS row.
- Short all over and close to the shape of his skull. No round dome, no helmet, no extra volume on top: the top of his hair sits low and close above his head.
- A little more length on top, brushed slightly up and back at the front, with gently receding temples.
- Short and tapered at the sides and back: a thin, even layer of hair down each side to the top of his ears, as on S01. His ears show just past it.
- Very dark brown, not flat black, with soft lighter-brown highlights on top where the light falls.
- A fine, smooth texture. No curls, coils, ringlets, waves, frizz or bumpy outline.
- The same haircut in every slot. Where his head turns, tilts, rises or lowers, draw that same haircut from that angle, like the matching view in ref-hair.

KEEP UNCHANGED: his face, expression, eyes, eyebrows, ears and skin colour; the size and position of his head; his body, pose, hands and fingers; every prop; his shirt, T-shirt, lanyard, badge, belt, trousers and shoes; the black fitness band on his right wrist and the silver watch on his left; and the size and placement of every figure in its slot. Where a hand or a prop touches his head, keep it exactly as it is and change only the hair around it. Slots not named below stay exactly as they are.

OUTPUT: the same 1536 x 1024 image with a fully transparent background, 4 columns x 2 rows, one figure per slot, nothing touching a slot edge. No background, floor, shadow, text, labels, grid lines, borders or effects. Do not mirror anything.
```

---

## 3. The sheets

Slots are numbered 1 to 4 along the top row and 5 to 8 along the bottom. Slot 1 is always his standing pose.

### Batch A

```text
S02 — EXPLAINING. Only slot 8, the shrug: change only his hair there and keep slots 1 to 7 exactly as they are (when he talks, the S01 heads go onto those bodies).
```

```text
S03 — POINTING. All eight slots. His head turns to look where he points: toward the viewer's left in slots 2 and 3, straight up in slot 4, toward the viewer's right in slots 5 and 6, and down in slots 7 and 8. Use the matching views in ref-hair. In slot 4 his raised hand is near his hair: keep it.
```

```text
S04 — TOUCH. All eight slots. In slot 3 a hand covers his mouth. Slots 4 to 7 tilt his head. In slot 8 his hand rubs the back of his head: keep that hand exactly as it is and show the short hair around it.
```

```text
S06 — BALANCE AND DIZZY. All eight slots. In slots 2 to 4 his whole body tips, so his head tips with it. In slots 6 and 7 one hand rests on his forehead: keep it and change only the hair around it. In slot 8 his head is turned a little.
```

```text
S07 — REST. All eight slots. In slot 2 a hand covers his mouth. In slot 3 his raised hands are just above his hair: keep them. In slots 6 and 7 his head droops forward, so the top of his head shows, as in the looking-down views of ref-hair. In slot 8 his head is raised.
```

```text
S08 — PAGE MOMENTS. All eight slots. In slots 2 and 3 he leans into the wind with a forearm raised to shield his eyes: keep the arm. His hair is too short for the wind to lift, so it stays neat. In slot 4 he looks up toward the viewer's left. In slot 8 he looks down at the floor, so the top of his head shows, as in the looking-down views of ref-hair.
```

```text
S09 — SOCIAL. All eight slots. In slots 2 to 4 his hand is raised near his head, in slot 5 his hands cover his eyes, and in slot 6 his hands are beside his face: keep every hand as it is. In slot 8 he bows, so his head is lowered and the top of his haircut shows, as in the looking-down views of ref-hair.
```

```text
S10 — STROLL. All eight slots. Slots 2 to 7 are three-quarter views: slots 2 to 4 turn toward the viewer's right and slots 5 to 7 toward the viewer's left, so use the turned views in ref-hair. Slot 8 is halfway between a turned view and facing us.
```

```text
S33 — KONAFA AND QATAYEF. Only slot 5: biting into the qatayef, eyes closed. The hair on top there is still curly: change only his hair in slot 5, to the S01 haircut, and keep every other slot exactly as it is.
```

```text
S47 — GREEN DAY. Only slots 6 and 7. Slot 6: spinning the globe on one fingertip, grinning. Slot 7: showing the globe to us with both hands. The hair on top there is still curly: change only his hair in slots 6 and 7, to the S01 haircut, and keep every other slot exactly as it is.
```

### Batch B

```text
S11 — SUNNY DAY. All eight slots. Keep the sunglasses exactly as they are, on his face or in his hand. In slot 3 his hands are at his temples: keep them.
```

```text
S12 — HOT DAY. All eight slots. In slot 4 he wipes his forehead with a handkerchief: keep it.
```

```text
S13 — SCORCHING DAY. All eight slots.
```

```text
S14 — COLD DAY. All eight slots.
```

```text
S15 — COSY WITH A SCARF AND TEA. All eight slots.
```

```text
S19 — SNOW. All eight slots.
```

```text
S20 — WINDY DAY. All eight slots.
```

```text
S21 — FOG AND GREY SKIES. All eight slots.
```

```text
S22 — CLEAR NIGHT. All eight slots.
```

```text
S24 — MORNING COFFEE. All eight slots.
```

```text
S26 — KOSHARY LUNCH. All eight slots.
```

```text
S27 — END OF THE WORKDAY. All eight slots.
```

### Batch C

```text
S28 — LATE NIGHT. All eight slots.
```

```text
S29 — WEEKEND. All eight slots.
```

```text
S30 — RAMADAN LANTERN. All eight slots.
```

```text
S31 — IFTAR AT SUNSET. All eight slots.
```

```text
S32 — SUHOOR BEFORE DAWN. All eight slots.
```

```text
S34 — EID KAHK. All eight slots.
```

```text
S35 — EID DAY. All eight slots.
```

```text
S36 — EID AL-ADHA. All eight slots.
```

```text
S37 — BLESSED DAYS. All eight slots.
```

```text
S38 — MAWLID SWEETS. All eight slots.
```

```text
S39 — CHRISTMAS. All eight slots.
```

### Batch D

```text
S40 — COLOURED EGGS. All eight slots.
```

```text
S41 — SHAM EL-NESSIM PICNIC. All eight slots.
```

```text
S42 — NAYROUZ. All eight slots.
```

```text
S43 — EGYPTIAN FLAG. All eight slots.
```

```text
S44 — WATCHING FIREWORKS. All eight slots. In slot 8 both his hands are on his cheeks: keep them.
```

```text
S46 — FLOWERS DAY. All eight slots.
```

```text
S48 — SPOOKY WEEK. All eight slots. Slot 4 is the ghost costume, with the sheet over his head: leave slot 4 exactly as it is.
```

```text
S49 — APRIL FOOLS AND PI DAY. All eight slots. Keep the joke glasses with the nose and moustache exactly as they are, on his face or in his hand.
```

```text
S51 — SUMMER HOLIDAY. All eight slots.
```

```text
S52 — BACK TO SCHOOL. All eight slots.
```

```text
S53 — SAHLAB AND SWEET POTATO. All eight slots.
```

### Batch E

```text
S54 — STICKY NOTES. All eight slots.
```

```text
S55 — PLANNING POKER. All eight slots.
```

```text
S56 — TIMEBOX. All eight slots.
```

```text
S57 — WE SHIPPED IT. All eight slots.
```

```text
S58 — FOCUS MODE. All eight slots. In slots 4 and 5 he wears the headphones on his head, and in slot 6 they hang around his neck: keep them exactly as they are and change only the hair that shows.
```

```text
S59 — KUDOS. All eight slots.
```

```text
S60 — FOOTBALL. All eight slots.
```

```text
S61 — READING A COMIC. All eight slots.
```

```text
S62 — OUD AND DARBUKA. All eight slots.
```

```text
S63 — PHONE. All eight slots.
```

```text
S64 — LIGHTS ON, LIGHTS OFF. All eight slots. In slot 7 he puts on the sunglasses: keep them.
```

---

## 4. Check every edit before you keep it

Put the edited sheet next to the one you started from, next to `S01-faces.png` and next to `ref-hair-fix-3.png`.

- [ ] The hair matches S01 and the TARGET row: short and close to his skull, no dome on top, a thin even layer down the sides to the top of his ears, a little skin at the temples.
- [ ] Very dark brown with soft highlights, not flat black. No curls anywhere.
- [ ] The same haircut in every slot you edited.
- [ ] Nothing else moved: the same faces and expressions, poses, hands, props, clothes, lanyard, band on his right wrist and watch on his left.
- [ ] Transparent background, 4 × 2 slots, one figure per slot, nothing touching a slot edge.

A small shift in skin colour or head size is fine: the build corrects both. **One or two slots still wrong:** edit again with _"Keep every slot exactly as it is except slot N. In slot N change only his hair, to match S01 and the other slots."_ **His face changed:** start again from the sheet in the zip, not from the edit.

---

## 5. Hand back

Send each batch's edited sheets back as one zip, under their usual names (`S03-pointing.png`, `S20-wind.png` …). Only the sheets you redid are needed; the rest come from the earlier rounds. Batches can come back one at a time.

Claude will then rebuild the packs (`scripts/build-mascot-packs.py`, which also matches skin and head size and thickens thin side hair), measure the hair against the live sprite again, republish the review page and rerun the tests. The code doesn't change.
