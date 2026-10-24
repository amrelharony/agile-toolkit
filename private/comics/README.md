# Private comic files

Put the colour edition here as **`agile-at-work-color.pdf`**. Never put it in `public/`, because the CDN serves anything there to anyone.

- It opens only for readers who scanned the QR code in the printed book. That link sets a cookie, which `/agile-at-work/color/edition.pdf` checks before streaming the file (see `src/lib/comic/color-edition-access.ts`).
- The build picks it up through `scripts/comic-asset.mjs`, and `next.config.mjs` bundles it into the PDF route. Restart `next dev` after adding or replacing it.
- Same export advice as the free edition: single portrait pages, "Fast Web View" (linearized), and under about 50 MB. GitHub warns at 50 MB and rejects files over 100 MB.
