# Design DNA: the Agile at Work comic

> The look of the Agile Toolkit. It comes from the comic's bible: "mature soft hand-inked" art with "confident fine dark outlines", "restrained warm watercolour washes", a "lightly textured off-white" setting and sentence-case hand lettering. The source of truth for values is `src/app/globals.css` and `tailwind.config.ts`; this document explains the rules.

---

## 1. Philosophy

**Style:** a warm, grown-up workplace comic.

**Not:** loud superhero. No halftone burst backgrounds, no ALL-CAPS display type, no starbursts. Also not the old look: no glass, no glow, no gradient blobs, no neon, no noise overlay, no particle field.

The page is paper, the lines are ink, and colour is a wash used sparingly. A panel is drawn with a pen, so its corners are slightly uneven and its shadow is a hard offset, not light falling. Tools are data-heavy, so everything that holds data stays plain and legible at small sizes.

---

## 2. Modes

| Mode | Class | Name in the UI | Paper | Ink |
| --- | --- | --- | --- | --- |
| Default | `.light` | Comic | `#f7f1e6` warm off-white | `#1d1a18` |
| Dark | `.dark` (and `:root`) | Night | `#13161e` deep ink-blue | `#f5efe4` chalk |
| Accessibility | `.hc` | High contrast | `#000000` | `#ffffff` |

- With nothing stored, a visitor gets Comic. A stored `ae-theme` is kept. "System" picks Comic or Night from the OS.
- The header button cycles Comic, Night, High contrast. Settings → Appearance also offers System.
- High contrast stays maximally legible: no offset shadows, plain Inter for headings, plain corners, underlined links, heavy focus rings.
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
- **Buttons:** variants live in `ui/button.tsx`. Inked variants have an outline and a small shadow that grows on hover and presses flat on click. Ghost and link variants stay plain. Hovers tint (`hover:bg-accent/10`), they never fill with accent.
- **Links** are underlined at rest in every mode: accent and muted text are almost the same lightness, so colour can't mark them. Links in `p`, `dd` and `figcaption`, and anything with `hover:underline`, get it from the base layer. A pill or a nav item opts out with `no-underline`.
- **Field focus** is a 2px `--ring` outline outside the edge, from the base layer, on every input, textarea, select and combobox. A Canvas board keeps its own editors.
- **Severity labels and series** use `SEVERITY_SCALE` (`lib/utils/severity-color.ts`): four tokens that stay apart in all three modes. Don't map severities through `themed()`, which folds high and medium into one colour.
- **Identity colours** (`lib/squads/colors.ts`) are bright in every mode. Words on them use `IDENTITY_INK`. A person's name stays in page text, with a coloured dot beside it.
- **Speech balloons** (`.balloon`, `EmptyState`): Amr's still `waiting` frame (`AmrStill`, a crop of the existing sheet, lazy loaded, alt text, no animation), standing on a small watercolour wash, beside a balloon holding the tool's own message. Don't write new lines for Amr.
- **Amr in the corner** stays visible on every page and stays draggable. On phones he stands in a strip of his own (`data-amr-band`), opaque, at the bottom or just under the header if he's dragged up, so the page passes behind the strip rather than behind him. The strip publishes `--amr-band-bottom` and `--amr-band-top`; anything pinned to the bottom of the screen adds `--amr-band-bottom`.
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

- Motion is small and physical: a panel lifts 1px, a button presses flat. Entrances stay translate-only so content is readable before JavaScript.
- Reduced motion turns animation off globally. Amr shows a still frame.
- No full-screen layers: the mesh blobs, noise overlay and particle canvas (and its worker) are gone, along with their main-thread and GPU cost.
- The offline page in `public/sw.js` carries the same paper, ink and panel, inline.

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
- The art is decorative: `aria-hidden`, never focusable, click-through, inside a panel or the page flow, never fixed or full-screen, and never over Amr.
- Its box has a fixed size in the server HTML, so inking in moves nothing.
- Ink moments sit beside the text that states the fact, so they're `aria-hidden`; they ink in when they appear and stay still. Never fixed or full-screen, no sound, no extra XP or toast. A still mark in place interrupts nothing, so they're allowed on quiet routes (ceremonies, presenting, Focus). Amr stays the only celebration that moves.
- Motion: the ink-in plays once; boil only on a mouse hover; the scribble only while loading. Reduced motion shows the finished drawing, still. High contrast drops washes, colour fills and boil and inks every line in `--text`; paper fills stay, so a shape in front still hides what's behind it. Print leaves the art out.
- New pictures follow the same pen: draw them as strokes in `lib/ink/drawings`, never as raster images or icon fonts.
