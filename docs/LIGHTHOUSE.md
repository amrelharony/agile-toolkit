# Lighthouse performance baselines

Lighthouse CI (`@lhci/cli`) captures performance / accessibility /
best-practices / SEO baselines for the app's **public routes**.

## What's covered

`lighthouserc.json` baselines `http://localhost:3000/` (the public landing).
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

The tool routes (`/(tools)/*`) are behind Google sign-in. Lighthouse hits the
unauthenticated redirect, not the real tool UI, so they're intentionally
excluded from the public-route baseline. To baseline an authenticated route you
need an LHCI `puppeteerScript` that signs in first (and CI secrets for a test
account) — that's deliberately out of scope here.

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
