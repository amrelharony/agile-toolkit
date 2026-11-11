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

| File                                        | What it does                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/motion/view-transition.ts`         | The one place a view transition starts: the wait cap, `html[data-vt]`, the clean-up, one at a time.                                                   |
| `src/lib/motion/page-transition.ts`         | The page-change rules, `HOLD_CAP_MS`, `DYNAMIC_PATHS`, `pushWithTransition`, `notifyRouteCommitted`, `isPageTransitionRunning`, the debug switches.   |
| `src/components/motion/transition-link.tsx` | next/link plus the cross-fade. Every internal link in `src` renders it.                                                                               |
| `src/components/motion/route-signal.tsx`    | Lends page changes the app router and reports each page's arrival from a layout effect. Rendered in both app-shell branches, inside its own Suspense. |
| `src/components/motion/vt-log.tsx`          | The `?vt-log=1` table. Loaded by a dynamic import only when the switch is on.                                                                         |
| `src/app/globals.css`, VIEW TRANSITIONS     | The held layers, the `--vt-ready` marker, the 240 ms root cross-fade (only under `html[data-vt="page"]`) and the reduced-motion lock.                 |

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
  `same-page`, `vt-off`, `save-data`, `unavailable` (no view transitions,
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

- [ ] Android Chrome: a tool card, a home job card, a sidebar link, a header
      link, a next-step link, a related-tool tile and a recent-tool row each
      cross-fade in about a quarter second.
- [ ] iPhone Safari 18 or later: the same.
- [ ] iPhone Safari 17 (or any phone with `?vt=off`): every one changes
      instantly, as before.
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
