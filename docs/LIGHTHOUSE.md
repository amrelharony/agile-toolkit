# Lighthouse performance baselines

Lighthouse CI (`@lhci/cli`) captures performance / accessibility /
best-practices / SEO baselines for the app's **public routes**.

## What's covered

`lighthouserc.json` runs Lighthouse's default **mobile** profile (a mid-range
phone on slow 4G): most visitors arrive on phones, and it's the harder target.
It covers eight public routes:

| URL                        | Why                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/`                        | The landing page (search, jobs, tool index by section).                                                                    |
| `/retro`                   | The most-used ceremony tool.                                                                                               |
| `/capacity-planner`        | A representative form-style tool. Every tool route is public and browser-only, so a visitor sees what Lighthouse measures. |
| `/burndown`                | A chart tool: shows whether Recharts stays out of the first load (charts load lazily).                                     |
| `/comics`                  | The comics gallery: the book's 26 episodes, and the weekly stories once they're out.                                       |
| `/comics?ep=01&src=poster` | A printed poster link, rewritten by the middleware to the episode's static page, which is text: the comic is in the book.  |
| `/meet-the-cast`           | A VIP tool's lock page. The build never renders a dynamic page, so this is the first time CI loads one.                    |
| `/comics/early`            | The early comics' lock page, for the same reason.                                                                          |

Lighthouse starts each run with a fresh profile, so `/comics` and the poster
link open with their intros: the book intro (5 s) and the poster intro (3 s)
are on screen while it measures. That's what a first-time visitor sees, so
their accessibility counts too.

**Accessibility is a hard gate.** Every tool passed a jsx-a11y sweep, and the
interaction and labelling rules are lint errors. Everything else warns until
the mobile baseline below is known-good.

| Assertion                | Threshold                                        |
| ------------------------ | ------------------------------------------------ |
| Accessibility            | ≥ 0.95 (**error**)                               |
| Performance              | ≥ 0.70 (warn)                                    |
| Best Practices           | ≥ 0.90 (warn)                                    |
| SEO                      | ≥ 0.90 (warn)                                    |
| First Contentful Paint   | ≤ 2500 ms (warn)                                 |
| Largest Contentful Paint | ≤ 4000 ms (warn)                                 |
| Cumulative Layout Shift  | ≤ 0.1 (warn)                                     |
| Total Blocking Time      | ≤ 400 ms (warn)                                  |
| JavaScript transferred   | ≤ 350 KB (warn)                                  |
| Total transferred        | ≤ 2 MB (warn): 1.5 MB page + ~0.5 MB Amr's sheet |

Amr's sprite sheet is content-hashed and served `immutable`, so the 0.5 MB is
paid once per browser; budgets count it because Lighthouse runs cold.

## Baseline (mobile, 19 Oct 2026, local production build, 1 run each)

| Route               | Perf | A11y | BP  | SEO | FCP   | LCP   | TBT    | CLS   |
| ------------------- | ---- | ---- | --- | --- | ----- | ----- | ------ | ----- |
| `/`                 | 74   | 100  | 100 | 100 | 2.1 s | 5.3 s | 227 ms | 0     |
| `/retro`            | 71   | 100  | 100 | 100 | 2.1 s | 5.6 s | 275 ms | 0.011 |
| `/capacity-planner` | 73   | 100  | 100 | 100 | 2.1 s | 5.6 s | 239 ms | 0.013 |
| `/burndown`         | 63   | 100  | 100 | 100 | 2.3 s | 7.1 s | 441 ms | 0.017 |

How it got here (same build profile, before → after the UX overhaul's fixes):

- **Layout shift** on tool pages was 0.41–0.73. The method-guide panel loaded
  late and opened on first visit; its header now renders at once, collapsed.
- **Total Blocking Time** was 600–1,200 ms. The 3D mascot's engine (~0.7 s of
  main-thread work on this profile) now starts on the first interaction or
  5 s after load instead of on the first idle moment.
- **Accessibility** was 94–98: a contrast miss on the retro format chips,
  guide headings out of order, a dangling `aria-controls`, and format cards
  whose names didn't match their text.
- **Chart tools** load Recharts with the chart, so their first-load JS
  dropped ~120 KB each.

The "JS transferred" figure includes the route prefetches `<Link>` makes for
tools in view.

### Reading LCP and TBT on this profile

The LCP column above (5–7 s) is Lighthouse's **simulated** throttling, and on
these pages it is an artifact. The unthrottled trace shows the LCP element
painting with the first paint (`observedLargestContentfulPaint` equals
`observedFirstContentfulPaint`, about 0.8 s). The simulation charges the
scripts requested early to LCP. With real throttling
(`--settings.throttlingMethod=devtools`), LCP is 2.2 s on `/retro`, the same
as FCP, and 3.2 s on `/`.

Real throttling shows the cost that matters, which is main-thread work. TBT is
about 2 s and TTI about 20 s, mostly from the 3D mascot starting up about 5 s
after load. Its chunk accounts for most of the script bootup, with three.js
and the shader compile on top. On 1 Nov 2026 Amr's 2D sprite replaced the 3D
mascot: one image and CSS frame steps, no three.js, no model parse, no shader
compile. These numbers predate that and need a fresh run.

Next step: lazy-loading Supabase for visitors (~61 KB gzipped of the initial
JS; it needs an owner sign-in check before merging).

## What's NOT covered (and why)

- **Owner-only pages** (`/settings/access-tokens`, `/settings/squads`) and
  owner features (cloud sync, the agent, realtime multiplayer) still need the
  owner's Google sign-in. Baselining them needs an LHCI `puppeteerScript` that
  signs in first (and CI secrets for a test account) — deliberately out of
  scope here.
- **The comics with real art.** CI builds against a placeholder Supabase, so
  it measures the text-only pages. Panels load lazily at 768 px from Supabase
  Storage; measure those against the real project after the first import.
- **The other tool routes.** They share the app shell measured above; add a
  URL to `collect.url` when a tool's own UI is worth a separate baseline.

## Running it

```bash
# Local: builds the app, boots `next start`, runs 3 Lighthouse passes,
# asserts the budgets, and prints a temporary-public-storage report URL.
npm run lighthouse
```

CI runs the same flow on pull requests and on demand via
`.github/workflows/lighthouse.yml` (using the same harmless placeholder Supabase
env as `ci.yml`). `npx --yes @lhci/cli@0.14.x` fetches the CLI at run time, so
there's no added project dependency.

## Tightening baselines

1. Run it, read the median scores from the report URL in the run log.
2. Set realistic `minScore` / `maxNumericValue` values in `lighthouserc.json`.
3. Flip the relevant assertions from `warn` to `error` so regressions fail CI.
4. Add more public URLs to `collect.url` as they appear.
