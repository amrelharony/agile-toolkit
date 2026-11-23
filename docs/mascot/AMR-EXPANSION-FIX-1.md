# Amr: expansion sheets, fix round 1

**Status:** not sent yet. All 124 expansion sheets (`Amr_Refined_Expansion_124.zip`, 13 November 2026) are built as drawn and ship. This page lists what a redraw round would fix, found by a review of every frame on light and dark grounds, each finding checked again by independent skeptics (15–16 November 2026). Nothing here blocks the site: the worst cases are handled in the build until the art is fixed (section 1).

Every sheet is the right size, transparent, with eight filled slots and nothing touching a slot edge, and Amr's face, hair, skin and clothes match the live sprite. What follows is continuity and scale inside a sheet, and one prop that reads as a flag.

**For every redraw:** edit only the slots named; keep the canvas (1536 × 1024, transparent PNG, eight 384 × 512 slots), Amr's standing height (435 px, crown about y45, soles about y480 in every standing slot), his head the size the standing master draws it, and every prop the size, colour and place it has in the slots around it. A prop held in one hand stays in that hand unless the beat says otherwise. After a redraw, the sheet's new sha256 goes into `refined-expansion-release.json` and the spec (`scripts/build-expansion-spec.py`), and the pack is rebuilt.

---

## 1. Final beats (the scene ends early until these are redrawn)

The last beat is the pose a scene holds, its reduced-motion still and its Scenes-tab thumbnail. In these eight, beat 8 says or shows something the scene must not, so the build ends each one on beat 7 (`HOLD_EARLIER` in `scripts/build-expansion-spec.py`). Once a slot is redrawn, take its entry out.

| Sheet | Slot | What's wrong                                                                      | Redraw                                                                   |
| ----- | ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| X020  | 8    | Amr and the holder table drawn smaller and about 6 px lower than every other beat | Same pose at the sheet's scale, on the floor line                        |
| X038  | 8    | A clear thumbs-up: the pass sign the beat rules out                               | A restrained nod with a relaxed or open hand, hoop on the fourth key     |
| X052  | 8    | The incompatible purple cartridge is gone and his right hand waves                | Both items lowered to his waist, the cartridge kept outside the canister |
| X064  | 8    | The mixed source tray is gone                                                     | The tray beside him, still mixed, where slots 1–2 have it                |
| X068  | 8    | The easel and Amr swap sides of the cell                                          | Easel where slots 1–7 have it; Amr steps aside to its left               |
| X069  | 8    | The focus screen, its post, the tray and the folder are all gone                  | Everything from slot 7 kept, the folder still waiting in the tray        |
| X072  | 8    | Amr a fifth smaller, standing above the floor                                     | At the sheet's scale, feet on the floor line                             |
| X088  | 8    | A second, loose stencil plate in his hand while the jig keeps its own             | Hand empty or resting, looking at the folded face of the one stencil     |

## 2. A prop that reads as a flag

| Sheet | Slots | What's wrong                                                                                                                                                                   | Redraw                                                                                                     |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| X111  | 1–8   | The "content board" is a white rectangle with one big centred red disc: the flag of Japan. Frame 8, which a presentation would hold for as long as it lasts, shows it clearest | A content board with plain chart shapes (bars, a line, a few blocks) in the site's colours, no single disc |

Until it's redrawn, X111 plays only on request; nothing holds it while a presentation lasts.

## 3. Props that vanish, move or change hands for a beat

At 600 ms a beat these read as a blink or a jump.

| Sheet | Slots      | What's wrong                                                                                     |
| ----- | ---------- | ------------------------------------------------------------------------------------------------ |
| X010  | 7          | The pedestal table swells to about 1.7× its width, then shrinks back                             |
| X014  | 6          | Traces the thought-bubble panel again instead of the footprint panel (beat 6)                    |
| X015  | 2          | The blue bead jumps to the other end of the red ones, then back                                  |
| X016  | 2          | The capped pen disappears for one beat                                                           |
| X017  | 6          | The feedback box and its stand swing about 25 px in front of him for one beat                    |
| X019  | 3, 5       | The carousel stand (and his feet) slide 30–47 px sideways; it should stay put                    |
| X020  | 2, 5, 6    | The holder table jumps right in 2; the comic under his arm is gone in 5 and 6                    |
| X034  | 6, 7       | The triangular hub moves to his other hand and back                                              |
| X036  | 7          | The cream verification collar is gone                                                            |
| X037  | 8          | The two groups trade hands, and the hinged fan is drawn in separate pieces                       |
| X038  | 4, 6       | The blue hoop is gone in 4; the orange lip on the fob is gone in 6                               |
| X039  | 2–8        | The ladder changes size: floor-standing in 2–6, palm-sized in 8 (the catalog calls it compact)   |
| X044  | 3–7        | Two of the six token discs are missing; in 7 the disc is at his chin, not his chest              |
| X045  | 3–5        | One arm of the hinged specimen is missing; in 5 the caliper isn't around the purple shoulder     |
| X046  | 2–5        | The blue block is gone in 2–4; the open-latch case is gone in 5                                  |
| X050  | 4, 6       | A fourth circle on the three-circle tile in 4; the clamp on the wrong margin in 6                |
| X052  | 6, 7       | The canister and cartridge swap hands                                                            |
| X054  | 3–7        | The orange peg doesn't turn with the eye segment, and the ring's segment order changes           |
| X056  | 4          | His right arm is hidden, so the blue end cap juts out with no hand on it                         |
| X057  | 5          | The source cap is already open (that's beat 6)                                                   |
| X059  | 3–8        | The cradle hovers at hip height, then drops to the floor, then is gone                           |
| X060  | 6          | The whole scene sits about 15 px right of the beats around it                                    |
| X061  | 4          | The mask is already fully across, not halfway                                                    |
| X062  | 5–8        | The drawer chest jumps up and grows                                                              |
| X064  | 3, 4, 6, 7 | The source tray swaps sides of him almost every beat                                             |
| X071  | 2, 3       | The blue middle folder is missing                                                                |
| X073  | 3, 8       | The ring on the pedestal hook is gone in 3; the samples jump from the pedestal to a tray in 8    |
| X074  | 2–7        | The cradle is gone in 5; the handle faces the same way throughout, so the half-turn doesn't read |
| X076  | 6–8        | The preserved blue tile is gone from the return pocket                                           |
| X079  | 1–8        | The output pointer moves between three places and is missing in 3–5                              |
| X085  | 5          | The brace under the plank is gone, on the beat that shows it holding                             |
| X086  | 7, 8       | Four cubes in 7 (the scene has three); one in the rack in 8                                      |
| X089  | 4          | Two rings: one at the falcon's chest and one already on the floor (the scene has one)            |
| X090  | 2          | Two cubes: one on the chute and one in the fox's hands (the scene has one)                       |
| X093  | 3          | The long pin is gone from the socket, a beat before HiPPO pulls it out                           |
| X097  | 6          | The flat gold ring sinks 3–4 px below the floor line                                             |
| X098  | 7          | The cord guide's base and the trolley wheels sink 3–4 px below the floor line                    |
| X099  | 4          | His near shoe hangs about 11 px above the floor with nothing under it                            |
| X101  | 8          | The trolley he rolled forward in 7 is back behind where it started                               |
| X105  | 3, 4       | The metronome leans the same way in both, so the left-then-right swing never shows               |
| X106  | 7          | The arrow keycap leaves his left palm for the dock, then is back in his palm in 8                |
| X109  | 2          | The tuning fork and the felt sleeve swap hands, then swap back in 3                              |
| X112  | 2          | The arch-window stencil disappears (this beat is in the explanatory filter variant too)          |
| X113  | 2          | The lanyard isn't caught on the hook yet, so the snag appears from nowhere in 3                  |
| X120  | 1–8        | The blocks vanish in 2 and reappear built in 3; the pedestal slides left, then jumps back in 8   |
| X122  | 3–7        | The balloon jumps between his hands; every beat keeps it in his left                             |

## 4. Scale inside a sheet

The release draws his standing figure 435 px tall, and the build gives every slot of a sheet one transform, so a slot drawn at another size shows as a size jump.

**Second row drawn shorter or smaller** (slots 5–8 against 1–4): X012 (about 5%), X023 (4%, legs), X025 (5–6%), X029 (5%), X047 (legs about 13% shorter), X052 and X055 (about 4%), X106 (6%), X114 (7%), X122 and X123 (4–5%), X028 slots 6–8, X032 slots 5–8, and X113, X115, X116 and X120 slots 5–8 (3–4%), and X031 slots 5–8 (2.5% larger). Redraw the second row at the first row's scale.

**One slot at another size:** X095 slot 4 (the whole scene about 18% smaller), X082 slot 5 (about 5–8% larger), X097 slot 5 (his body shorter and narrower, head the same).

## 5. Head size (optional)

In these sheets his head is drawn 12–18% bigger than the live idle's in most slots, measured against the live idle with the build's head measure (the rest of the release is within about 10%). The build keeps heads as drawn, so a redraw is the only fix: X005 (+15%), X018 (+12%), X026 (+12%), X029 (+12%), X032 (+16%), X038 (+15%), X041 (+12%), X058 (+18%, the largest, growing to +21% in slot 7), X071 (+13%), X074 (+18%), X078 (+13%). In X073 slots 6–8 it grows to about +17% from about +11% in the first row.
