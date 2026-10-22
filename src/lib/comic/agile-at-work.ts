/**
 * "Agile at Work" comic — shared constants.
 *
 * The comic is private: it is listed nowhere and is only reachable through
 * the secret link /comic/<token> (see src/lib/comic/token.ts). The PDF
 * lives in a private Supabase Storage bucket (src/lib/comic/storage.ts).
 * Pure and isomorphic: safe to import from server and client components
 * alike — but only from the comic's own modules. Anything the shared
 * chrome imports ends up in the root layout chunk every visitor downloads,
 * so the chrome learns about the reader from lib/stores/reader-page-store
 * instead (test/comic/shared-bundle.test.ts keeps it that way).
 */

export const COMIC_ID = "agile-at-work";
export const COMIC_TITLE = "Agile at Work";
export const COMIC_LAST_PAGE_KEY = "agile-toolkit:comic:agile-at-work:last-page:v1";
export const COMIC_LAYOUT_KEY = "agile-toolkit:comic:layout:v1";
