/**
 * Canon fields that are private to the bible: they never reach a page, a repo
 * file or a PR. Shared by the Meet the Cast whitelist test and the cast puppet
 * guard.
 */
export const PRIVATE_FIELDS = [
  "research_source_ids",
  "safe_comic_engine",
  "growth_arc",
  "expanded_story_uses",
  "avoid",
  "canonical_visual_preserve",
  "asset_path",
  "asset_sha256",
  "legacy_aliases",
  "voice",
  "visual_status",
  "palette",
  "lanyard",
] as const;
