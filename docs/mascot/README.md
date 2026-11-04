# Amr, the interactive pet

Amr stands in the corner of every page. The live sheet (`public/mascot/amr.*.webp`) is his boot frame and his identity reference. The interactive pet adds ten art sheets drawn from [the art brief](AMR-ART-BRIEF.md), cut into small packs that load only when he needs them. Fifty-four more, [the context sheets](AMR-CONTEXT-BRIEF.md) S11–S64, give him the weather where the visitor is, their time of day, Cairo's holidays, the seasons, the toolkit's own moments and play.

## What's where

| Path                                                         | What it is                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `docs/mascot/AMR-ART-BRIEF.md`, `docs/mascot/reference/`     | The brief the sheets were generated from, and its reference images                |
| `docs/mascot/AMR-HAIR-EDITS.md`                              | Hair-only edits for sheets that came back with curly hair, and how to check them  |
| `scripts/build-mascot-packs.py`                              | Slices, cleans and registers the sheets, writes the packs and their manifest      |
| `public/mascot/amr-<pack>[@2x].<hash>.webp`                  | The packs: 192 × 224 cells, eight to a row, and 384 × 448 twins for sharp screens |
| `src/components/agent/mascot/mascot-packs.ts`                | The generated manifest: each pack's files and each frame's cell                   |
| `src/components/agent/mascot/engine/clips.ts`                | Every reaction and held pose, frame by frame                                      |
| `src/components/agent/mascot/engine/senses.ts`               | What he notices: the page, the phone's motion, nobody being around                |
| `src/components/agent/mascot/engine/interactions/`           | Taps, touch, page moments and the phone's motion                                  |
| `scripts/build-mascot-review.mjs`                            | The review page: every clip at real size on the site's light and dark grounds     |
| `docs/mascot/context-sheets.json`                            | The context sheets S11–S64: each sheet's props, poses and frame ids               |
| `docs/mascot/AMR-CONTEXT-BRIEF.md`                           | Their ChatGPT brief, generated from the JSON                                      |
| `docs/mascot/AMR-CONTEXT-CHATGPT.md`                         | The same, as one file to attach to ChatGPT with the reference images              |
| `scripts/build-mascot-context-brief.mjs`                     | Writes that brief, and a prompt page with a copy button per sheet                 |
| `src/components/agent/mascot/engine/scenes.ts`               | Every context scene, frame by frame                                               |
| `src/lib/agent/mascot/context/`                              | Cairo's occasions, sunset, the visitor's weather, and what's on now (moments)     |
| `src/components/agent/mascot/engine/interactions/context.ts` | When he greets, passes the time, reaches for a torch or frets about the battery   |
| `src/app/api/mascot/weather/route.ts`                        | The visitor's weather, from their rough place                                     |

The source sheets (`S01-faces.png` … `S10-stroll.png`, about 19 MB, and `S11-sun.png` … `S64-lights.png`, about 100 MB) are not committed. Keep the zips they came in.

## Rebuilding

New or corrected sheets: put all 64 in one folder, then

```bash
python -I scripts/build-mascot-packs.py <sheets folder> --preview <scratch folder>
```

It replaces every `amr-*.webp` pack, rewrites `mascot-packs.ts`, and writes contact sheets and the talking composites to the preview folder for a visual check. `hair@2x.png` there puts every frame's head under the live sprite's head from eight angles (the same angles as `reference/ref-hair.png`), so a haircut that drifts shows at a glance. `test/agent/mascot-asset.test.ts` checks that each pack's name matches its bytes.

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
- **Toolkit actions** have their own scenes where one fits: cards added, votes cast and revealed, timers, stand-up entries, kudos, sprints started and releases shipped (`use-tool-reactions.ts`).

Holidays follow amrelharony.com's engine, on Cairo's clock and the Umm al-Qura calendar, reusing the toolkit's own calendars, with the days that engine adds (Arafah, Ashura, Isra and Mi'raj, mid-Sha'ban, 26 July, 6 October, Nayrouz and the international days). Nayrouz falls on 12 September in the year before a Gregorian leap year, not in the leap year itself as amrelharony.com has it. During Ramadan his daytime food scenes stay away; iftar plays from 20 minutes before sunset where the visitor is (Cairo's when that isn't known), sweets after it, and the mesaharaty's drum before dawn.

The weather comes from `/api/mascot/weather`. It reads the rough place Vercel attaches to every request, rounds it to a tenth of a degree (about 11 km), asks Open-Meteo, and answers with the weather alone, never the place. Nothing asks the visitor for their location, and nothing is stored beyond the tab (30 minutes in sessionStorage). In local dev there is no place, so it answers 204; off production, `?at=lat,lon` tries one out. The route is an exact-match bypass in the middleware.

## How the frames line up

Each sheet's slot 1 (his standard stance) sets the scale: he stands 177 px tall on alpha above 32, rows 25 to 201 of the live sheet's 192 × 208 cell. A pack's cell is that cell with 16 more rows on top (192 × 224, his floor on row 218), because party hats, balloons, a trophy and a few other props reach up to 7 px above it. The clip layer stands on his floor and takes the height of the cell it paints, so a live-sheet cell and a pack cell put his feet in the same place. Every slot is then moved so it lines up on its own anchor:

- **feet**: most poses, so planted feet stay planted even where the generator shifted the body to fit an arm;
- **head**: the four carried poses, which hang from the collar;
- **shins**: the walk;
- **hip**: the one pose with a foot off the floor.

Every slot's lowest point goes on the floor row, except the carried ones.

Heads are then matched to the live head. The generator draws his head 2–9% bigger than the live sheet does, at the same height, with his shoulders lower to make room, so every new pose looked bigger than the live ones. The build measures each sheet's stance head against the live idle's and shrinks every frame's head by that much. It finds the head by its hair, shrinks it about the head's centre, and eases back to no change across the neck and shoulders. That leaves no seams, and a hand on his head shrinks with it while staying on its arm. The S01 heads also move onto the live head's position, because talking flips between them and the S02 gestures. The build prints each sheet's factor.

The S01 faces share one body: each face goes onto `face.default`'s body, with its own head lined up on the default head. An edit can move a head (the hair edits moved six of them by up to 11 px at 2×), and lip-sync flips between these faces many times a second, so a moved head would make him twitch. The build prints a note for any head it had to move more than 2 px.

Talking composites put the S01 heads (the smile and three mouths) on the S02 gestures. The cut is feathered at the neck, so one head stays on every talking frame.

## Decisions

- Generated heads go against the companion kit's pinned-head rule. The review page puts them beside the live idle for an identity check. If they drift, the strict-mode fallback in Appendix B of the brief still applies.
- His hair comes from the live sprite: short, smooth and close-cropped. The first round of sheets copied the curly hair of `ref-2-detail.png`, which the brief had pointed to; [the hair edits](AMR-HAIR-EDITS.md) fix those sheets without redrawing anything else.
- The bow was meant for hiding him, but Amr is never hidden, so he bows when he's thanked in the chat.
- Phone motion waits for the "Let Amr feel your phone" switch wherever the browser asks for permission: iOS, and current Chrome. Elsewhere it's on until it's switched off.
