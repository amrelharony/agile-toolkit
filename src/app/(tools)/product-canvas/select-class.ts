/**
 * Product Canvas's native selects (an idea's source, the idea to merge
 * into, a pitch's place on the betting table, its cycle), styled to line up
 * with <Input>: 44 px and 16 px text on touch, smaller only for a mouse at
 * md+ (test/design/form-fields-css.test.ts reads this constant).
 */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
