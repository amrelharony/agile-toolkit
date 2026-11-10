# Page transitions

Tapping an internal link whose page is already loaded ahead cross-fades the
page in 0.24 s instead of cutting. Picking a tool in the Ctrl/Cmd+K finder does
the same. Amr, his speech bubble and chat panel, the docked timer and the top
bar stay where they are, fully opaque and live: they are held layers, outside
the moving picture. Everything else changes instantly, exactly as before.

The rule lines are in `design-system/DNA-SPEC.md` (section 8, "Page changes
run one at a time"). This page is how it is built, how to switch it off for a
check, and how to measure it.

## Where it lives

| File                                          | What it does                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/motion/view-transition.ts`           | The one place a view transition starts: the wait cap, `html[data-vt]`, the clean-up, one at a time.                                                                  |
| `src/lib/motion/page-transition.ts`           | The page-change rules, `HOLD_CAP_MS`, `DYNAMIC_PATHS`, `pushWithTransition`, `notifyRouteCommitted`, `isPageTransitionRunning`, the debug switches.                  |
| `src/components/motion/transition-link.tsx`   | next/link plus the cross-fade. Every internal link in `src` renders it.                                                                                              |
| `src/components/motion/route-signal.tsx`      | Lends page changes the app router and reports each page's arrival from a layout effect. Rendered in both app-shell branches, inside its own Suspense.                |
| `src/components/motion/vt-log.tsx`            | The `?vt-log=1` table. Loaded by a dynamic import only when the switch is on.                                                                                        |
| `src/app/globals.css`, VIEW TRANSITIONS       | The held layers, the `--vt-ready` marker, the 240 ms root cross-fade (only under `html[data-vt="page"]`), the card frame (`tool-frame`) and the reduced-motion lock. |
| `src/lib/motion/grow-from.ts`                 | The header grow: one Web Animations movement from the tapped card's spot, when no view transition carried the card's frame.                                          |
| `src/components/layout/tool-page-wrapper.tsx` | The header is the `data-vt-target` a card's frame grows into; the root drops its rise when a frame lands; the header grows from the card's spot otherwise.           |

`test/motion/link-coverage.test.ts` keeps it that way: only `transition-link.tsx`
and the named exceptions import `next/link`, and only the named exceptions call
`router.push` or `router.replace` themselves. Each exception carries its reason
in the test.

## How a change runs

1. `TransitionLink` runs the caller's `onClick` first. A modified, middle-button,
   new-tab or download click is left to the browser.
2. It asks `pushWithTransition`. If a rule below keeps the change instant, it
   returns false, the click is left alone and next/link changes the page as it
   always did.
3. Otherwise it calls `preventDefault` (next/link then stays out of it) and the
   browser keeps the old picture. The router push happens inside the update.
4. The update waits for `RouteSignal` to report the new page, from its layout
   effect, in the same commit that puts the page in place. Nothing on this path
   waits for `requestAnimationFrame`, an observer or an animation event: the
   browser pauses those while it holds the old picture.
5. If the page has not arrived after `HOLD_CAP_MS` (150 ms), the change is
   skipped, the screen comes back to life, and the page swaps plainly when it
   arrives. If the push throws, the page loads in full (`location.assign`).

A tap while a change runs skips that change, and its own page change happens
plainly, after the first one's push, so the last tap always wins.

## When it stays instant

- The browser has no view transitions (iPhone Safari 17), or the stylesheet's
  `--vt-ready` marker is missing.
- Reduced motion, Save-Data or 2G, presenting mode, a comic intro on stage, or
  a hidden tab.
- The link is modified, middle-clicked, opens a new tab or downloads.
- The link leaves the site, or keeps the same path and query (a hash link).
- The link sits in a `[role="dialog"]` or in a `data-vt-instant` zone. The
  sidebar is one while the phone menu is open.
- Either page is a bare route (`BARE_ROUTE_PREFIXES` in `app-shell.tsx`:
  sign-in, sign-out, callback, not-authorized, guest, join).
- The page is not loaded ahead: a link with `prefetch={false}` (most comics
  links), or one of the force-dynamic pages in `DYNAMIC_PATHS` (comics/early,
  meet-the-cast, squad-session, vip, which-colleague).
- `?vt=off` is on (below).

Ceremony routes, Focus and quiet hours do get the cross-fade. A new query on
the same path (`/comics` to `/comics?ep=30`) counts as a page change.

The tool finder starts loading the highlighted tool once it has stayed
highlighted for 150 ms, once per tool while the finder is open, with
`router.prefetch?.(path, { kind: "auto" })`. Never a bare `router.prefetch`
call: Next 14.2 defaults that to `full`, which throws away the `auto` copy a
link already loaded. The force-dynamic pages are not prefetched.

## A card grows into its page

A tool card, a home job card and a comic card pass `frame` to their main link
(`TransitionLink`). Their card element carries `data-vt-card`; a tool page's
header carries `data-vt-target`.

When the change may run (the rules above), the card's paper frame grows into
the new page's header panel in 0.36 s on the glide easing, under the top bar.
The card's words fade over the first 40%, the header's words come in between
15% and 60%, and the header's drawing then inks in as usual. The rest of the
page cross-fades as any change does. In high contrast the frame has no shadow
(`--shadow-3` is transparent there).

How it holds together:

- On the tap the card gets `data-vt-active` and `<html>` gets
  `data-vt-frame="exit"`. The VIEW TRANSITIONS block names whatever carries
  the mark `tool-frame`.
- When `RouteSignal` reports the new page (its layout effect, as for every
  change), the mark moves to the first `[data-vt-target]` and the frame turns
  `pair`. So exactly one element carries the name in the old picture (the
  card) and one in the new (the header). Two would make the browser skip the
  whole change.
- A new page with no header leaves `exit`: the card fades out where it was in
  120 ms. A new page with an intro on stage skips the change.
- Under `pair` the transition layer draws the `.panel` look itself (border,
  radius, paper, shadow) and clips what is inside. Both pictures keep their
  natural size, so no text scales: the growing frame uncovers the header.
- The new page's wrapper reads `isFrameLanding()` once, on its first render,
  and leaves its rise out: the frame is the entrance. A change capped or
  skipped clears the flag before the late page renders, so that page rises.
- Every mark and attribute goes when the change finishes, is capped or is
  skipped.

### The header grow, where no frame ran

Every frame link also leaves an arrival record: the card's box at the tap,
the time and whether a view transition carried the frame. When none did, the
new page's header grows out of the card's spot instead: it slides from there
while a clip-path inset widens from the card's size to its own, in 0.36 s.
This is what plays

- on iPhone Safari 17 (and with `?vt=off`),
- when the page missed the 150 ms hold,
- for comic cards (their links have `prefetch={false}`),
- for cards to the force-dynamic pages,
- for the related-tool tiles under a tool. They pass `frame="spot"`: they are
  1 px tiles, not panels, so they start no view transition at all (reason
  `spot`), still load ahead, and only lend their spot.

The page's own rise plays with it. It plays once, only on the card's own page,
up to 1.5 s after the tap (`GROW_WINDOW_MS`), and never under reduced motion,
Save-Data or 2G, while presenting or with an intro on stage. It starts in a
microtask from the wrapper's layout effect: after Next's scroll in the same
commit, before the first paint, and never waiting for a frame. It is a Web
Animations movement with no fill, so nothing stays on the header, and it uses
a cubic-bezier, which every engine with Web Animations takes.

Frame links ask the router for nothing of their own: next/link's prefetch, in
view and on touch, is all there is.

## Back: the card slides back

Back and Forward run no view transition: Next puts the page back in its own
popstate listener, and wrapping that would fight the browser's scroll
restoration and the iPhone's swipe. One thing may move. After a tool, job or
comic card opened a page, going Back from that page to the one the card sat
on slides the card from where that page's header was into its own slot, in
0.3 s on the glide easing, by translate alone.

It plays only when all of these hold:

- The browser played no Back animation of its own: the popstate event's
  `hasUAVisualTransition` is exactly `false`. It is `true` when the browser
  animated Back itself (a swipe, where the browser reports it), and a browser
  without the field leaves it undefined, so Back stays instant there.
- The step leaves the card's page for the page the card sat on (path and
  query; `/comics?ep=30` back to `/comics` counts). A page in between, or a
  newer page in its place in history, does not.
- A `[data-vt-card]` whose tapped link goes to that page is on screen once the
  browser has put the scroll back. Of several, the one nearest where the card
  was tapped slides. A job card's Other options link to the same tool does not
  count, and a related-tool tile, which is no card, leaves no record.
- No reduced motion, Save-Data or 2G, presenting mode or intro, and no page
  change running.

How it runs:

- Each card tap leaves a forward record (`page-transition.ts`): the page it
  sat on, the page it opened, which of its links was tapped and its box. Only
  the next card tap replaces it, so Back after Forward slides it again.
- `RouteSignal`'s popstate listener (`noteHistoryStep`) only reads. It never
  stops the event or prevents its default. It listens in the capture phase,
  so it runs before Next's listener whatever order they were added in, and
  measures the leaving page's header while it is still there. A header
  scrolled out of sight lends the top edge of the screen.
- Next puts the page back inside the popstate event, and `notifyRouteCommitted`
  sees it in RouteSignal's layout effect. The browser restores the scroll only
  after that event, so the card is measured and the slide starts in the next
  animation frame, still before the page's first paint. Nothing holds the
  screen on Back, so nothing pauses that frame. A newer page, a newer Back or
  a tap cancels it, and a page that comes back over a second after Back
  (`BACK_WAIT_MS`) does not slide.
- The slide is a Web Animations movement with no fill: nothing stays on the
  card once it ends.

## Debug switches

Both are kept in `sessionStorage` for the tab, inside try/catch. Storage that
throws (a blocked private window) leaves both off.

| Address     | Effect                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `?vt-log=1` | Shows a small table under the top bar, left: the last 20 taps on this visit, how each ended and how long the screen held. |
| `?vt-log=0` | Hides it again.                                                                                                           |
| `?vt=off`   | Changes pages without view transitions, the way Safari 17 does, so any phone can show that path.                          |
| `?vt=on`    | Clears `?vt=off`.                                                                                                         |

The table lets taps through and sits under Amr and the top bar. It reads a list
kept in memory, so a full reload starts it again. Nothing is sent anywhere.

The outcomes:

- **ran**: the cross-fade played.
- **capped**: the page missed the 150 ms hold; it swapped plainly.
- **fallback**: the browser or a newer tap skipped it, or the push threw
  (`assign`); the page changed plainly.
- **instant**: a rule said no. The reason is in brackets: `not-ahead`
  (prefetch off), `dynamic`, `bare`, `zone` (dialog or phone menu), `external`,
  `same-page`, `spot` (a related-tool tile), `vt-off`, `save-data`,
  `unavailable` (no view transitions,
  reduced motion, presenting, an intro or a hidden tab), `no-router`, `busy`
  (behind a running change).

Each tap also adds one `performance.measure("page-change")` entry whose
`detail` carries the outcome, the reason and the address. On Android it can be
read through `chrome://inspect` with
`performance.getEntriesByName("page-change")`.

## Measuring the hold cap

`HOLD_CAP_MS` stays at 150 ms until this is done. Development builds never
prefetch, so measure on a production build: a `preview/**` branch on Vercel.

1. Open the preview on a mid-range Android phone and on an iPhone, at
   `/?vt-log=1`. Note the iPhone's Safari version.
2. Make 20 real finger taps on tool cards and home job cards, going Back
   between taps. A scripted click sends no touchstart, so it understates how
   often the change runs.
3. Read the counts at the top of the table. Count only card taps, not instant
   rows.
4. Set `HOLD_CAP_MS` between 100 and 200 ms so that about three in four card
   taps run.

## Real-phone checklist

On the preview build, in Comic, Night and High contrast, upright and sideways:

- [ ] Android Chrome: a sidebar link, a header link, a next-step link and a
      recent-tool row each cross-fade in about a quarter second.
- [ ] Android Chrome: a tool card and a home job card lift their frame, which
      slides up and stretches into the tool's header in about a third of a
      second, passing under the top bar; the page does not rise a second time.
      An "Other options" link only cross-fades.
- [ ] A comic card, and a related-tool tile under a tool: the new page's
      header grows out of the spot where the card or tile was.
- [ ] iPhone Safari 18 or later: the same.
- [ ] iPhone Safari 17 (or any phone with `?vt=off`): every link changes
      instantly, as before, except that a card's page grows its header from
      the card's spot.
- [ ] High contrast: the frame has no offset shadow.
- [ ] Android Chrome (Back button or the toolbar's Back) and desktop Chrome:
      Back from a tool page opened by a card slides that card from the
      header's spot into its slot in about a third of a second, when the card
      is on screen. A back swipe that shows Chrome's own Back animation stays
      instant.
- [ ] iPhone Safari: a back swipe keeps Safari's own animation. Note whether
      the Back button slides the card: it does only if Safari reports
      `hasUAVisualTransition` as false, which is not checked.
- [ ] The finder (Ctrl/Cmd+K on a keyboard, the header search on a phone):
      picking a tool cross-fades; the finder's own close plays on top.
- [ ] Amr, his bubble, his open chat panel, the docked timer and the top bar
      never move, fade or blink during a change. Amr stays draggable straight
      after it.
- [ ] A comics link (banner, gallery, a story's previous or next), a link to
      `/meet-the-cast` or `/squad-session`, and any link in the open phone menu
      change instantly.
- [ ] Sign-in, guest and join pages: links change instantly.
- [ ] With reduced motion on in the phone's settings, nothing cross-fades.
- [ ] Two quick taps on two different cards end on the second card's page.
- [ ] A slow page (throttle the network on Android) changes plainly after a
      short hold and never hangs.
- [ ] The rail, opened by mouse hover on desktop, does not collapse in the
      middle of a change; it collapses after it if the pointer has left.
- [ ] `?vt-log=1` shows the table; `?vt-log=0` hides it.
