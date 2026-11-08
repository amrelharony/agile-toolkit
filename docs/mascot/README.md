# Amr, the interactive pet

Amr stands in the corner of every page. The live sheet (`public/mascot/amr.*.webp`) is his boot frame and his identity reference. The interactive pet adds ten art sheets drawn from [the art brief](AMR-ART-BRIEF.md), cut into small packs that load only when he needs them. Fifty-four more, [the context sheets](AMR-CONTEXT-BRIEF.md) S11–S64, give him the weather where the visitor is, their time of day, Cairo's holidays, the seasons, the toolkit's own moments and play. Fifty [tool sheets](AMR-TOOLS-BRIEF.md), S65–S114, give 50 of the site's tools a sheet of their own: he greets you with the tool's props when you open it and acts out its key moments.

## What's where

| Path                                                              | What it is                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `docs/mascot/AMR-ART-BRIEF.md`, `docs/mascot/reference/`          | The brief the sheets were generated from, and its reference images                |
| `docs/mascot/AMR-HAIR-EDITS.md`                                   | Hair-only edits for sheets that came back with curly hair, and how to check them  |
| `docs/mascot/AMR-HAIR-ROUND-2.md`, `reference/ref-hair-fix.png`   | The second hair round: the sides, the colour and the last curls                   |
| `docs/mascot/AMR-HAIR-ROUND-3.md`, `reference/ref-hair-fix-3.png` | The third hair round: S01's haircut for the other 53 sheets, in five zips         |
| `scripts/build-mascot-packs.py`                                   | Slices, cleans and registers the sheets, writes the packs and their manifest      |
| `scripts/mascot_heads.py`                                         | Measures his head, hair and skin in a cell; the builder and the audit share it    |
| `scripts/audit-mascot-heads.py`                                   | Checks the shipped packs' head size, skin and hair against the live sprite        |
| `public/mascot/amr-<pack>[@2x].<hash>.webp`                       | The packs: 192 × 224 cells, eight to a row, and 384 × 448 twins for sharp screens |
| `src/components/agent/mascot/mascot-packs.ts`                     | The generated manifest: each pack's files and each frame's cell                   |
| `src/components/agent/mascot/engine/clips.ts`                     | Every reaction and held pose, frame by frame                                      |
| `src/components/agent/mascot/engine/senses.ts`                    | What he notices: the page, the phone's motion, nobody being around                |
| `src/components/agent/mascot/engine/interactions/`                | Taps, touch, page moments and the phone's motion                                  |
| `scripts/build-mascot-review.mjs`                                 | The review page: every clip at real size on the site's light and dark grounds     |
| `docs/mascot/context-sheets.json`                                 | The context and tool sheets S11–S114: each sheet's props, poses and frame ids     |
| `docs/mascot/AMR-CONTEXT-BRIEF.md`                                | Their ChatGPT brief, generated from the JSON                                      |
| `docs/mascot/AMR-CONTEXT-CHATGPT.md`                              | The same, as one file to attach to ChatGPT with the reference images              |
| `scripts/build-mascot-context-brief.mjs`                          | Writes that brief, and a prompt page with a copy button per sheet                 |
| `docs/mascot/AMR-TOOLS-BRIEF.md`, `AMR-TOOLS-CHATGPT.md`          | The tool sheets' brief and ChatGPT file (`--tools`), with a kickoff per batch     |
| `docs/mascot/reference/ref-current.png`                           | Amr as the packs show him today, rendered by `scripts/build-mascot-reference.py`  |
| `docs/mascot/AMR-TOOLS-FIX-1.md`                                  | The first fix round for the returned tool sheets: hair edits and one redraw       |
| `src/lib/agent/mascot/context/tool-scenes.ts`                     | Each tool's greeting and the scenes its actions and moments play                  |
| `src/lib/agent/mascot/use-tool-reactions.ts`                      | Plays a tool's scene, or a pose, when it logs an action or announces a moment     |
| `src/lib/agent/mascot/tool-moments.ts`, `timer-watch.ts`          | Moments nothing logs: a vote revealed, an OKR achieved, the docked timer at zero  |
| `src/components/agent/mascot/engine/scenes.ts`                    | Every context scene, frame by frame                                               |
| `src/lib/agent/mascot/context/`                                   | Cairo's occasions, sunset, the visitor's weather, and what's on now (moments)     |
| `src/components/agent/mascot/engine/interactions/context.ts`      | When he greets, passes the time, reaches for a torch or frets about the battery   |
| `src/components/agent/mascot/mascot-fx.tsx`, `engine/scene-fx.ts` | The air the site draws behind him in a weather or fireworks scene                 |
| `src/app/api/mascot/weather/route.ts`                             | The visitor's weather, from their rough place                                     |

The source sheets (`S01-faces.png` … `S10-stroll.png`, about 19 MB, and `S11-sun.png` … `S64-lights.png`, about 100 MB) are not committed. Keep the zips they came in. Twelve of them (S01, S05, S12, S14, S23, S25, S30, S33, S36, S44, S47 and S55) are now the versions from [hair round 2](AMR-HAIR-ROUND-2.md), which replace the earlier ones. 52 more are the versions from [hair round 3](AMR-HAIR-ROUND-3.md) (`AMR_Hair_Round_3_{A..E}_Reviewed.zip`). S06, S41 and S62 keep their round-1 versions, and S01, S05, S23 and S25 their round-2 ones. The five sheets where a hat or an umbrella hides his hair (S16–S18, S45 and S50) no longer have source PNGs on hand: the zip of the context sheets is gone, so rebuilds keep their shipped packs (below).

## Rebuilding

New or corrected sheets: put all 64 in one folder, then

```bash
python -I scripts/build-mascot-packs.py <sheets folder> --preview <scratch folder>
```

With `--keep-missing`, a context sheet that isn't in the folder keeps the pack it ships with now (its files and frames, unchanged) instead of being left out. That is how the five covered sheets are built today: a folder of the other 59, plus `--keep-missing`.

It replaces every `amr-*.webp` pack it builds, rewrites `mascot-packs.ts`, and writes contact sheets and the talking composites to the preview folder for a visual check. `hair@2x.png` there puts every frame's head under the live sprite's head from eight angles (the same angles as `reference/ref-hair.png`), so a haircut that drifts shows at a glance. `test/agent/mascot-asset.test.ts` checks that each pack's name matches its bytes.

Then check the packs against the live sprite:

```bash
python -I scripts/audit-mascot-heads.py --check
```

It prints each pack's skin difference from the live idle (CIEDE2000, where about 1 is just visible side by side) and its head size, with the live sheet's own spread as the yardstick, and fails when a pack's skin is more than 3 from live or its head more than 5% off. It also prints two hair numbers against the live idle's, for reading rather than for the check: how thick the hair down his sides is, and how much of his head the hair covers (a dome on top shows as more).

Then the review page:

```bash
node --no-warnings scripts/build-mascot-review.mjs <out folder>
```

## Context sheets

The context sheets are drawn like the first ten, with props, from [their brief](AMR-CONTEXT-BRIEF.md). `docs/mascot/context-sheets.json` is the one source: the brief, the pack builder and the scene tests all read it. After changing it, run

```bash
node --no-warnings scripts/build-mascot-context-brief.mjs <page folder>
```

to rewrite the brief and the prompt page. Put the returned sheets (`S11-sun.png` … `S64-lights.png`) in the same folder as S01–S10 and run the pack builder as usual. Each context sheet present becomes a pack; the rest are left out. A scene plays only once every frame it uses is in the manifest (`shippedScene` in `engine/sprite-poses.ts`), so a sheet left out of a build just goes quiet. All 54 came back on 4 November 2026 and are built.

What he marks, and when:

- **Arriving**, he greets with one scene, the most important moment not yet marked today: Cairo's occasion of the day, then striking weather, the comics pages, the visitor's hour, a nice day, the season. Each moment greets once per Cairo day (`mascot_greeted` in localStorage).
- **Idle** for 15 to 30 seconds, he passes the time with one of the day's scenes or a game (football, the oud, his phone). It stands in for that stretch's stroll.
- **The theme** going dark brings out a torch; going light, sunglasses. **The battery** running low on a phone makes him fret, and charging cheers him up. **A long stretch of typing** gets him typing too.
- **Toolkit actions** have their own scenes where one fits: cards added, votes cast and revealed, timers, stand-up entries, kudos, sprints started and releases shipped (`use-tool-reactions.ts`). The tool sheets add each tool's own (below).
- **The air around him**: a rain, downpour, storm, snow, wind, fog, dust, starry-night or fireworks scene plays with the air the site draws behind him (rain round his umbrella, flakes, gusts, fog banks, a sandy haze, twinkling stars, bursts of sparks). It's a layer of CSS animations, wider than his box and reaching above it, shown only while the scene plays and never with reduced motion. A scene borrowed from another sheet keeps that sheet's air: shivering in the snow has none.

Holidays follow amrelharony.com's engine, on Cairo's clock and the Umm al-Qura calendar, reusing the toolkit's own calendars, with the days that engine adds (Arafah, Ashura, Isra and Mi'raj, mid-Sha'ban, 26 July, 6 October, Nayrouz and the international days). Nayrouz falls on 12 September in the year before a Gregorian leap year, not in the leap year itself as amrelharony.com has it. During Ramadan his daytime food scenes stay away; iftar plays from 20 minutes before sunset where the visitor is (Cairo's when that isn't known), sweets after it, and the mesaharaty's drum before dawn.

The weather comes from `/api/mascot/weather`. It reads the rough place Vercel attaches to every request, rounds it to a tenth of a degree (about 11 km), asks Open-Meteo, and answers with the weather alone, never the place. Nothing asks the visitor for their location, and nothing is stored beyond the tab (30 minutes in sessionStorage). In local dev there is no place, so it answers 204; off production, `?at=lat,lon` tries one out. The route is an exact-match bypass in the middleware.

## Tool sheets

The tool sheets S65–S114 are context sheets for one tool each, in eight `tools-*` groups by site section and five ChatGPT batches of ten (the `Tools, batch A…E` rounds in the JSON). Their brief carries tool rules on top of the context rules: S01's haircut, smooth shading like S01, simple props with no text. After changing the JSON, run

```bash
node --no-warnings scripts/build-mascot-context-brief.mjs --tools <page folder>
```

to rewrite `AMR-TOOLS-BRIEF.md`, `AMR-TOOLS-CHATGPT.md` and the prompt page, which has a kickoff message per batch. Each batch goes to ChatGPT as one zip (`AMR_Tool_Sheets_A.zip` … `E.zip`): the ChatGPT file, the kickoff, and the five references the image tool takes at most: `ref-1-stance.png`, `ref-current.png`, `ref-hair-fix-3.png`, `ref-3-range.png` and the corrected `S01-faces.png` from hair round 3. `ref-current.png` replaces `ref-2-detail.png`, whose curly hair isn't his; re-render it after a rebuild with `python -I scripts/build-mascot-reference.py`.

A returned batch is reviewed head by head against S01 before it goes in: the haircut and its colour, smooth shading, and only the props the sheet names. Numbers don't catch ChatGPT's curls in near-black hair; only looking at each head enlarged beside S01's does. Then put the batch's sheets with the 59 current sources and build with `--keep-missing`, as above. Each new pack's scenes go into `scenes.ts` with its sheet, since the tests ask that every built frame is in a scene and every scene has shipped; frames of sheets not built yet are left out of that check.

**Status:** all 50 are built (8 November 2026). 33 came back right the first time (`AMR_Tool_Sheets_{A..E}_Completed.zip`). The other 17 went through [fix round 1](AMR-TOOLS-FIX-1.md) (`AMR_Tool_Fix_{A,B}.zip`, back the same day): hair-only edits for 16, and S79 drawn again. To rebuild, put the 59 current sources, then the 50 sheets from the first zips, then the 17 from the fix zips over them, in one folder. Before building, clear the faint specks some sheets carry away from the figure (alpha 9–24, more than 10 px from anything solid): S68 had about 900, S83 about 350. The builder drops anything fainter itself.

The fix round's edits came back with hair a shade lighter or browner than the slots ChatGPT left alone, so his hair would change shade between two frames of one scene. On the tool sheets only, the build moves any frame's hair that is more than ΔE 3 from the live idle's toward it, keeping its highlights, and prints the frames it moved (`match_hair`). The other sheets were matched in the hair rounds and stay as they ship.

`tool-scenes.ts` says what each tool plays. Opening a tool's page (`/<tool id>`) loads its packs, greets once a day with its first `open` scene (ahead of the weather and the hour, after the day's occasion), and adds its `open` scenes to his pastimes there. Its logged actions (`event-actions.ts`) play their scenes through `use-tool-reactions.ts`, looked up by tool first, then the toolkit's shared scenes, then a pose. Three moments aren't logged: a vote round revealed (the vote rooms announce it), the named sounds listed in `EMITTED` (an OKR achieved, a hypothesis validated or not, a premortem completed), and the docked timer running out wherever the visitor is (its tool's scene, or the Ceremony Timer's). When an action and a moment land in the same tick, as a check-in that achieves its OKR does, only the moment plays. Seven more tools reuse a sheet: RICE and ICE the prioritizer's, the $100 test buy-a-feature's, DACI and RAPID the decision log's, maturity the health check's, burnup the burndown's.

Squad guests' pages (`/guest/*`) don't show Amr, so their actions get no reaction.

## How the frames line up

Each sheet's slot 1 (his standard stance) sets the scale: he stands 177 px tall on alpha above 32, rows 25 to 201 of the live sheet's 192 × 208 cell. A pack's cell is that cell with 16 more rows on top (192 × 224, his floor on row 218), because party hats, balloons, a trophy and a few other props reach up to 7 px above it. The clip layer stands on his floor and takes the height of the cell it paints, so a live-sheet cell and a pack cell put his feet in the same place. Every slot is then moved so it lines up on its own anchor:

- **feet**: most poses, so planted feet stay planted even where the generator shifted the body to fit an arm;
- **head**: the four carried poses, which hang from the collar;
- **shins**: the walk;
- **hip**: the one pose with a foot off the floor.

Every slot's lowest point goes on the floor row, except the carried ones.

Side hair comes next. Hair round 2 asked for the sides cut very short, and they came back thinner than the live idle's: about 7 px down each side of the S01 faces at 2×, against live's 9. Thin sides also fooled the head measure: the hair read narrow, so his ears looked like hands at his head. So wherever a head faces us, the build follows the hair down each side, from the top of his hair to his ear, and compares it with the live idle's, scaled to the head's width. A side below 95% of live's is stretched inward to live's thickness, row by row. Its soft edge and a little skin move with it, and the moved pixels are blended with the rows above and below, so the new edge stays smooth. Sides about as thick as live's, or thicker, stay as drawn. The build prints the frames it thickened.

Heads are then matched to the live head. The generator draws his head 2–9% bigger than the live sheet does, at the same height, with his shoulders lower to make room, so every new pose looked bigger than the live ones. The build measures each frame's head the way `mascot_heads.py` does: the head's width at the ears times the hair's width, which a tilt or a hand under the chin doesn't change. It scales that head to the live idle's, between 85% and 106%. It finds the head by its hair, scales it about the head's centre, and eases back to no change across the neck and shoulders. That leaves no seams, and a hand on his head shrinks with it while staying on its arm. A frame whose head is covered (a hat, headphones, an umbrella) or can't be measured takes its sheet's number, from the sheet's stance. The S01 faces all take one number, the median of their own, and their heads also move onto the live head's position, because talking flips between them and the S02 gestures.

The first build used the stance's number for every frame of a sheet. An audit on 5 November 2026 found heads up to 13% too big where a sheet drew some poses bigger than its stance, and six sheets 5–10% big overall; measuring frame by frame fixed that.

Skin is matched last. Each sheet came back from the generator with its own colour grade: next to the live sprite his face was about 5 points darker, 3 redder and 4 less yellow (CIELAB), with the same shading, so his face darkened every time a reaction cut in. The build measures the median colour of each sheet's faces and moves that sheet's skin (face, ears, neck and hands, not his props) by one shift onto the live idle's. Lit and shaded skin keep their difference, and a blush drawn on purpose, like the koshary's, stays a blush. The build prints each sheet's shift.

The S01 faces share one body: each face goes onto `face.default`'s body, with its own head lined up on the default head. An edit can move a head (the hair edits moved six of them by up to 11 px at 2×), and lip-sync flips between these faces many times a second, so a moved head would make him twitch. The build prints a note for any head it had to move more than 2 px.

Talking composites put the S01 heads (the smile and three mouths) on the S02 gestures. The cut is feathered at the neck, so one head stays on every talking frame. The gestures' own heads are cut away under the new one, and first go to 96% of the live size, so the S01 head always covers them: a body head any bigger peeks out as a ring round the new head or a notch at the jaw.

## Decisions

- Generated heads go against the companion kit's pinned-head rule. The review page puts them beside the live idle for an identity check. If they drift, the strict-mode fallback in Appendix B of the brief still applies.
- His hair comes from the live sprite: short, smooth and close-cropped. The first round of sheets copied the curly hair of `ref-2-detail.png`, which the brief had pointed to; [the hair edits](AMR-HAIR-EDITS.md) fix those sheets without redrawing anything else.
- The bow was meant for hiding him, but Amr is never hidden, so he bows when he's thanked in the chat.
- Phone motion waits for the "Let Amr feel your phone" switch wherever the browser asks for permission: iOS, and current Chrome. Elsewhere it's on until it's switched off.
