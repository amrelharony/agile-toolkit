# Lighthouse performance baselines

Lighthouse CI (`@lhci/cli`) captures performance / accessibility /
best-practices / SEO baselines for the app's **public routes**.

## What's covered

`lighthouserc.json` baselines three public routes:

| URL                 | Why                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | The landing page (hero, featured comic banner when the PDF exists, tool index).                                            |
| `/capacity-planner` | A representative tool. Every tool route is public and browser-only, so a visitor sees exactly what Lighthouse measures.    |
| `/agile-at-work`    | The comic reader. Until `public/comics/agile-at-work.pdf` is committed it renders the "coming soon" state, not the reader. |

The category-score + Core-Web-Vitals assertions are configured as **warnings**,
so the first run records the numbers without failing the build. Tighten them to
`error` once the known-good scores are established.

| Assertion                | Threshold (warn) |
| ------------------------ | ---------------- |
| Performance              | ≥ 0.80           |
| Accessibility            | ≥ 0.90           |
| Best Practices           | ≥ 0.90           |
| SEO                      | ≥ 0.90           |
| First Contentful Paint   | ≤ 2000 ms        |
| Largest Contentful Paint | ≤ 3000 ms        |
| Cumulative Layout Shift  | ≤ 0.1            |
| Total Blocking Time      | ≤ 300 ms         |

## What's NOT covered (and why)

- **Owner-only pages** (`/settings/access-tokens`, `/settings/squads`) and
  owner features (cloud sync, the agent, realtime multiplayer) still need the
  owner's Google sign-in. Baselining them needs an LHCI `puppeteerScript` that
  signs in first (and CI secrets for a test account) — deliberately out of
  scope here.
- **The comic reader with a real PDF.** CI only has the PDF once the owner
  commits it; after that, `/agile-at-work` measures the reader itself (pdf.js
  load and first-page render count toward LCP / TBT).
- **The other tool routes.** They share the app shell measured on `/` and
  `/capacity-planner`; add a URL to `collect.url` when a tool's own UI is worth
  a separate baseline.

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
