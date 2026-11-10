# Design DNA: the Agile at Work comic

> The look of the Agile Toolkit. It comes from the comic's bible: "mature soft hand-inked" art with "confident fine dark outlines", "restrained warm watercolour washes", a "lightly textured off-white" setting and sentence-case hand lettering. The page paper carries that texture as a still grain in Comic and Night (section 1). The source of truth for values is `src/app/globals.css` and `tailwind.config.ts`; this document explains the rules.

---

## 1. Philosophy

**Style:** a warm, grown-up workplace comic.

**Not:** loud superhero. No halftone burst backgrounds, no ALL-CAPS display type, no starbursts. Also not the old look: no glass, no glow, no gradient blobs, no neon, no noise overlay, no particle field. The one texture is a still paper grain from `lib/ink/grain.ts`: the page's own background in Comic and Night, and the faces of a drawn book (the comic intros' books and the /book cover). It is never animated, never fixed, never a layer or pseudo-element laid over content or over the whole screen, never on a panel, card or anything that holds data, and absent in high contrast and print. Grain that moves, or that is laid over content, is the banned noise overlay.

The page is paper, the lines are ink, and colour is a wash used sparingly. A panel is drawn with a pen, so its corners are slightly uneven and its shadow is a hard offset, not light falling. Panels, cards and anything that holds data are flat paper on the grained page; tools are data-heavy, so everything that holds data stays plain and legible at small sizes. Comic light is allowed on a drawn book and, during an intro, on the poster's title window and on a page as it turns or lifts: a flat shade of the shadow ink (in Night, a flat lightening in the text ink) with one clear slanted stripe, changing in steps, and a flat, hard-edged ground shadow under the book. Never a gradient, never a glow.

---

## 2. Modes

| Mode | Class | Name in the UI | Paper | Ink |
| --- | --- | --- | --- | --- |
| Default | `.light` | Comic | `#f7f1e6` warm off-white | `#1d1a18` |
| Dark | `.dark` (and `:root`) | Night | `#13161e` deep ink-blue | `#f5efe4` chalk |
| Accessibility | `.hc` | High contrast | `#000000` | `#ffffff` |

- With nothing stored, a visitor gets Comic. A stored `ae-theme` is kept. "System" picks Comic or Night from the OS.
- The header button cycles Comic, Night, High contrast. Settings → Appearance also offers System.
- High contrast stays maximally legible: no offset shadows, no paper grain, no comic light, no ground shadow or page-edge lines, plain Inter for headings, plain corners, underlined links, heavy focus rings.
- `THEME_COLORS` in `lib/theme/boot-script.ts` must equal each mode's `--bg` (`test/theme/theme.test.ts` checks it).

---

## 3. Colour

Sampled with Pillow from twelve panels of Batch 1 Volume 2, then darkened (Comic) or lifted (Night) until each one clears the contrast rule in section 7.

| Token | Comic | Night | Sampled from |
| --- | --- | --- | --- |
| `--bg` | `#f7f1e6` | `#13161e` | Paper; the suits' navy |
| `--card`, `--bg2` | `#fffcf5` | `#1b1f2a` | Balloon white |
| `--surface` | `#fdf9f0` | `#1e2330` | |
| `--surface-deep` | `#f1eadd` | `#0e1117` | Sticky-note cream, form fills |
| `--text` | `#1d1a18` | `#f5efe4` | Ink |
| `--sub` | `#574e44` | `#bdb4a6` | Muted text |
| `--border` | `#2b2622` | `#a39b8e` | The outline |
| `--rule` | `#d8cfbf` | `#3a4050` | The quieter line: table rows, chart grids, `divide-border` |
| `--input` | `#574e44` | `#a39b8e` | Field edges |
| `--accent` | `#873a16` | `#eda86a` | Fox rust |
| `--accent2` | `#1c4f94` | `#94b8e6` | Lanyard blue |
| `--accent3` | `#6a3560` | `#d3a6cd` | Plum |
| `--success` | `#1c5f3d` | `#86cf74` | Office plants |
| `--warning` | `#6f510c` | `#e3c16e` | Ochre |
| `--danger`, `--destructive` | `#9c1c2e` | `#f2939b` | The tie's red, cooled so it stays apart from rust |
| `--info` | `#174f9c` | `#8fb9ee` | Lanyard blue |
| `--neon-green` | `#4c5b20` | `#b4c96a` | Moss. Name kept for `accent-green` |
| `--neon-amber` | `#784a10` | `#ecb45f` | Wood. Name kept for `accent-amber` |
| `--neon-magenta` | `#8a2a54` | `#ec94b8` | Dark plum. Name kept for `accent-magenta` |
| `--chart-1` … `--chart-5` | blue, plum-pink, green, amber, violet | same hues, lifted | Each keeps the hue `lib/roadmap/palette.ts` promises |

Rules:

- Use tokens in classes (`text-accent`, `bg-warning/10`), never hex. `check:ui` flags brand hexes in class names, old and new.
- Colours kept as hex in data (retro columns, tool status maps) go through `themed()` and `tint()` from `lib/utils/theme-color.ts`.
- Own-colour text sits on a tint of at most `/20`. `check:ui` flags anything stronger.

**Deliberate exceptions.** A saved Canvas board holds its own colours, and new text and pen default to near-white, which can't be read on paper. So `.board-stage` keeps Night's tokens in Comic too: a dark ground like a blackboard in the room, with its toolbars and selection colour following those tokens. Holiday art keeps its own colours. Kudos cards keep the printed Agile at Work cards' colours and fixed inks, on white paper, in every mode.

---

## 4. Line and shadow

- **Line width is a token** because a colour can't set it. Tailwind's plain `border` reads `--line-w` (1.5px, so one device pixel on a 1× screen and three on a 2× phone). Panels read `--panel-w` (2px). `border-2` and friends are as ever.
- **`--border` is solid.** Dividers inside dense data use `border-rule` or `divide-border` (both `--rule`) so a table doesn't turn into bars.
- **Shadows are hard offsets:** `--shadow-1` to `--shadow-6`, wired to Tailwind's `shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, and to the old `shadow-glow*`, `shadow-card` and `shadow-modal` keys. `shadow-neon-*` are 2px offsets in the colour the name promises. Form fields, switches and slider thumbs carry no shadow.
- **Radii are small:** 2–12px. `rounded-full` stays for avatars, dots and bars. Nothing else is pill-shaped.
- `backdrop-blur-*` emits nothing (`corePlugins.backdropBlur: false`).

---

## 5. Lettering

| Alias | Face | Used for |
| --- | --- | --- |
| `font-display` | Shantell Sans (`--font-hand`, through `--font-display-face`) | Page `h1`s (a base rule catches every one), card, dialog and section titles, speech balloons |
| `font-sans` | Inter | Body text and controls |
| `font-data`, `font-mono` | JetBrains Mono | Tables, numbers, code. Never hand-lettered |
| `font-serif` | Source Serif 4 | A couple of decorative spots, not preloaded |

Shantell Sans is drawn from a marker hand in real upper and lower case, close to the comic's balloon lettering and steady enough to read at heading sizes. It's variable (300–800), so `font-semibold` and `font-bold` are real weights. Keep headings in sentence case. `Eyebrow`, `.label-mono` and `.tag-mono` are sentence case too. All fonts are self-hosted by `next/font` with `display: swap`.

---

## 6. Components

- **`.panel`** (globals.css): paper fill, ink outline, uneven pen corners, hard shadow. `Card`, `ToolCard`, job cards, dialogs and page headers use it. It's in the components layer, so a call site's `border-*`, `bg-*`, `rounded-*` or `shadow-*` wins.
- **Page headers** (`PageHeader`, `ToolPageWrapper`, the History, Insights and Team pages) are panels with a hand-lettered title.
- **Buttons:** variants live in `ui/button.tsx`. Inked variants have an outline and a small shadow that grows on hover. On press every variant shrinks 3% (the `scale` property, never `transform`) and springs back on release; inked variants also move 1px into their shadow. High contrast and reduced motion keep only the inked 1px press. Ghost and link variants have no outline or shadow. `.active-press` owns the press and the transition list; rows and cards that open something press and spring back the same way (`.active-press`, `.card-press`). Hovers tint (`hover:bg-accent/10`), they never fill with accent.
- **Links** are underlined at rest in every mode: accent and muted text are almost the same lightness, so colour can't mark them. Links in `p`, `dd` and `figcaption`, and anything with `hover:underline`, get it from the base layer. A pill or a nav item opts out with `no-underline`.
- **Field focus** is a 2px `--ring` outline outside the edge, from the base layer, on every input, textarea, select and combobox. A Canvas board keeps its own editors.
- **Severity labels and series** use `SEVERITY_SCALE` (`lib/utils/severity-color.ts`): four tokens that stay apart in all three modes. Don't map severities through `themed()`, which folds high and medium into one colour.
- **Identity colours** (`lib/squads/colors.ts`) are bright in every mode. Words on them use `IDENTITY_INK`. A person's name stays in page text, with a coloured dot beside it.
- **Speech balloons** (`.balloon`, `EmptyState`): Amr's still `waiting` frame (`AmrStill`, a crop of the existing sheet, lazy loaded, alt text, no animation), standing on a small watercolour wash, beside a balloon holding the tool's own message. Don't write new lines for Amr.
- **Amr in the corner** stays visible on every page and stays draggable. On phones space is kept for Amr at the bottom, or just under the header if Amr is dragged up: `mascot-assistant.tsx` publishes its height on `<html>` as `--amr-band-bottom` and `--amr-band-top` (and `--amr-band-top-edge` for things placed against the viewport). Nothing is drawn there and the page shows behind Amr; main's padding and the scroll padding keep content clear of it, and anything pinned to the bottom of the screen adds `--amr-band-bottom`. While a comic intro plays, Amr is behind it for those seconds, and the intro shows Amr itself. During a page change Amr, Amr's speech bubble and chat panel, and the docked timer are lifted out of the moving picture: they stay where they are, fully opaque, live and on top.
- **Sound** stays off by default.

---

## 7. Contrast

`test/design/theme-contrast.test.ts` parses all three modes from `globals.css` and checks:

- Text, accent and status colours on their own 0–20% tints over `--card`, `--bg`, `--surface` and `--surface-deep`: 4.5:1.
- `--sub` on every surface: 4.5:1. Words on solid primary and destructive fills: 4.5:1.
- `--border` and `--input` on every surface, and each chart series on the paper: 3:1, with all five series distinct.

Lighthouse accessibility must stay at 0.95 or above.

---

## 8. Motion and performance

- Motion is small and physical: a panel lifts 1px, a button presses flat and springs back, and a thing you let go of settles with one small overshoot. Movement uses the shared easing and duration tokens (globals.css, MOTION FOUNDATIONS; `lib/motion/tokens.ts`): calm, glide, settle (about 8% past) and pop (about 16% past); the further a thing travels the less it overshoots, and presenting mode turns every overshoot into calm. A dragged board card's tilt and a released reader panel take the hand's speed through one live spring (lib/motion/spring.ts) built from the same constants as settle. Objects spring; data never does: chart marks, bars, progress and numbers ease out and stop on their value, and axes and figures never move. Page content that enters on its own moves by position only (a translate of 12px at most, never opacity or scale), holds nothing once it ends and is readable from the first paint without JavaScript. Every newer CSS feature has a fallback that is the finished state. These follow their own rules: a dialog, sheet, popover or menu opened on request may fade and scale from 96% (a centred dialog grows from its own centre, a popover or menu from the control that opened it, a sheet slides from its edge) and closes faster than it opens; Amr keeps Amr's own pop-in entrance; ink art draws itself in (section 9); page changes and the comics reader follow the lines below; and the comic intros may turn, scale and wipe, with landings that use the settle and pop springs only.
- Further down a page, a card may settle and a heading's ink underline may draw as it scrolls into view, with `animation-timeline: view()` where the browser supports it and otherwise one small IntersectionObserver (`lib/motion/when-seen.ts`) that only touches elements still below the screen; without either, everything is simply in place.
- A page change, which only happens with JavaScript running, may cross-fade the two pages (0.24 s) and, when a tool or job card opened the page, grow that card's frame into the page's header panel (0.36 s). Where the browser has no view transitions, the page is not ready in time, or the link does not load ahead, the header grows from the card's spot instead.
- In the comics reader a full-screen panel being dragged sideways follows the finger exactly and, when let go, finishes the step or settles back with a spring; Previous, Next and the arrow keys slide panels the same way, in 0.3 s at most. Next story and Previous story may turn the page: the old page lifts and turns over the visible page edge, or the earlier page turns back down over it, in 0.36 s, using transforms only, with an ink edge and a hard `var(--shadow-6)` shade, never a gradient, glow or fade. After a reader answers a guess, the 'What readers picked' bars fill once from empty to their share, in 0.4 s at most; this fill is the one keyframe that animates a clip instead of a transform, so its rounded ink front keeps its shape. Each ends in exactly the state an instant change would show.
- Reduced motion turns animation off globally. Amr shows a still frame. No comic intro plays, and drawings, washes and books show finished. Page changes are instant: no view transition starts, the header does not grow, and a CSS rule switches the transition layer off as a second lock. In the comics reader that means no finger-follow, no slide, no page turn and no bar fill: panels and stories change at once and the bars show their share.
- Nothing starts moving by itself in a quiet context (ceremony routes, presenting, Focus, quiet hours, a comic intro): charts appear already drawn, numbers change without a nudge, header art does not replay. What answers the hand (a press, a held card, a tapped bar, a held header) still moves, without overshoot while presenting. A loading placeholder may loop while it loads.
- Charts take their motion from `useChartMotion()` (`components/charts`): drawn in once over 0.45 s with no overshoot, decided when the chart mounts (from the route it mounts on) and never switched back on. Under a tap or hover, a bar narrows and takes an ink outline, a line's or radar's point grows in, a scatter point dips and springs back, a pie slice takes an ink outline, and the value box rises a few pixels with a small spring; reduced motion keeps only the plain tooltip. Bar heights, positions, axes and figures never move. A series that must stay still says `isAnimationActive={false}`, in a file named on the still-list in `test/charts/chart-motion-contract.test.ts`, or takes only the press. Printing turns motion off for anything drawn after printing starts.
- Dialogs, sheets, popovers and menus use `.surface-scrim`, `.surface-pop` and `.surface-sheet`, which animate `opacity`, `scale` and `translate`, never `transform`.
- No full-screen layers: the mesh blobs, noise overlay and particle canvas (and its worker) are gone, along with their main-thread and GPU cost. The paper grain is the page's own still background image, not a layer. The browser's own picture of the page during a page change is not a standing layer: it lasts under half a second, follows a tap and leaves nothing behind; between two comic stories it may be a page turn instead of a cross-fade (at most 0.36 s), with the header, the sidebar and Amr still above it and no shadow in high contrast (line 27). The one exception is a comic intro's overlay: it plays once per device, ends by itself within 3, 5 or 9 seconds, and never plays under reduced motion or Save-Data.
- Page changes run one at a time, and only to a page that is already loaded ahead. While it arrives, the screen, Amr included, holds still for at most 0.15 s (`HOLD_CAP_MS`, `lib/motion/page-transition.ts`); past that the change is skipped. During a change Amr, Amr's bubble and chat panel, the docked timer and the top bar stay put on top. Changes are instant under reduced motion, Save-Data or 2G, presenting, an intro, in a dialog or the open phone drawer, in a hidden tab, on the sign-in, guest and join pages, for links that do not load ahead (`prefetch={false}`, most comics links; the Next and Previous story buttons load their story on touch, and the next story when the buttons come into view, so the page turn can run) and for the force-dynamic pages, and on back and forward (where only the card's slide back may play). They are allowed on ceremony routes and in Focus and quiet hours. Only `lib/motion/view-transition.ts` calls `document.startViewTransition`, and `view-transition-name` appears only in the VIEW TRANSITIONS block of globals.css and the reader's `reader-motion.css`.
- The offline page in `public/sw.js` carries the same paper (flat, without the grain), ink and panel, inline.

---

## 9. Ink graphics

The pictures are drawn the way the comic is: with a pen. Spot art is hand-inked line drawing written in code (`lib/ink/drawings`), rendered by `components/ink` as inline SVG, so it takes the theme's tokens and reads in all three modes.

| Technique | How | Where |
| --- | --- | --- |
| Ink that draws itself | Strokes with `pathLength="1"` and a dash-offset keyframe, one after another | Tool and page headers, home hero, 404, errors, no-data |
| Hand-drawn highlight | A perfect-freehand outline revealed by a mask along its pen path; seeded, so server and browser agree | The home hero's tool count, the sprint goal, the 404 |
| Watercolour wash | A seeded blob with a darker rim; the three big scenes bleed theirs through `ink-bleed` | Behind spot art, tool-card icons, under Amr in empty states |
| Line boil | Three displacement filters stepped about eight times a second | Header and scene art, while a mouse hovers the `.ink-host` |
| Scribble | A pen writing, resting and lifting off, on a loop | Loading placeholders |
| Ink moments | A small mark drawn once, in place, when something gets finished (`InkMoment`, `InkTick`, a circle `InkHighlight`): a Done stamp, a heart, a flourish, a star, a tick | Sprint closed, retro at its actions, poker consensus, ceremony timer finished, kudos sent, an OKR at 100%, sprint start steps, achievement chips |

Rules:

- Drawings are data: centrelines that name a tone (`InkTone`), never a hex. Strokes are `ink-tone-*` and fills `ink-fill-*` classes in globals.css; Tailwind's safelist keeps those, since the content scan can't see a class built from data.
- Lines are slightly wavy and corners overshoot. One wash per drawing. A `paper` fill is opaque and covers what's behind it.
- Spot art sits on a 96-unit square, at most 24 strokes and 2 KB of path data; a 320 × 200 scene stays under 8 KB (`test/ink/drawings.test.ts`). One file per drawing, so a page imports only what it shows: drawings compute their paths when they load, which keeps a bundler from dropping unused ones from a shared map.
- Every tool has its own drawing (`lib/ink/drawings/tools/<id>.ts`), in its section's wash. Its route layout, written by `scripts/generate-tool-art.mjs`, hands the page that one drawing as data through `ToolArt`, so it is in the server HTML and no tool page downloads the other drawings. The map imports `server-only`; a client file never imports it (`test/ink/tool-art.test.tsx`). After adding a tool or a drawing, run `node scripts/generate-tool-art.mjs`.
- A tool's icon sits on its section's wash through `ToneIcon` (tool cards, job cards, "More in"); a client component that shows several section or page drawings gets them as props from its server page (home's section rows), never by importing `SECTION_ART` or `PAGE_ART`.
- The art is decorative: `aria-hidden`, never focusable, click-through, inside a panel or the page flow, never fixed or full-screen, and never over Amr. A tool header or the home hero board may answer a mouse over it, a finger held on it or a tap on its own panel (lean, re-ink); the art itself stays click-through, and neither gains a role, tab stop or key handler.
- Its box has a fixed size in the server HTML, so inking in moves nothing.
- Ink moments sit beside the text that states the fact, so they're `aria-hidden`; they ink in when they appear and stay still. Never fixed or full-screen, no sound, no extra XP or toast. A still mark in place interrupts nothing, so they're allowed on quiet routes (ceremonies, presenting, Focus). Amr stays the only celebration that moves.
- Motion: the ink-in plays once, as the page loads, or the first time a drawing further down is scrolled to (home's section rows); a drawing on screen when the page becomes interactive stays as it is. A tool header's drawing inks in again when its header is clicked or tapped (never in a quiet context) and may lean toward a mouse or lift under a held finger (see Lean). Boil only on a mouse hover, plus one short breath as a drawing that inked in dries; the scribble and the chart sketch's line only while loading. Reduced motion shows the finished drawing, still. High contrast drops washes, glazes, colour fills, drawn shadows, the breath, lean and boil, and inks every line and pressure outline in `--text`; paper fills stay, so a shape in front still hides what's behind it. Print leaves the art out.
- New pictures follow the same pen: draw them as strokes in `lib/ink/drawings`, never as raster images or icon fonts.
