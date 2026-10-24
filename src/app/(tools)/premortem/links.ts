/**
 * What a premortem can be about: a release from Release Readiness or an
 * epic from the Epic Roadmap. Read-only lookups; the premortem keeps a
 * `{ kind, id, name }` snapshot, so a release renamed or removed later still
 * shows what the premortem was for.
 */

import { isExampleId } from "@/components/tool-frame/example-data";
import type { EpicRoadmap, ReleaseReadiness } from "@/lib/stores/workspace-types";
import type { PremortemLink } from "./model";

/** MUST match RR_ID in release-readiness-client.tsx and lib/actions/tools/release-readiness.ts. */
export const RELEASE_DOC_ID = "releaseReadiness:current";
/** MUST match ER_ID in epic-roadmap-client.tsx and lib/actions/tools/epic-roadmap.ts. */
export const EPIC_DOC_ID = "epicRoadmap:current";

export interface LinkOption extends PremortemLink {
  /** "planned 12 Nov", "2026 Q3 – 2026 Q4". */
  detail?: string;
}

export const KIND_LABEL: Record<PremortemLink["kind"], string> = {
  release: "Release",
  epic: "Epic",
};

/** The select's value for a link: "release:<id>". "" is "Not linked". */
export const linkValue = (link: Pick<PremortemLink, "kind" | "id"> | undefined): string =>
  link ? `${link.kind}:${link.id}` : "";

/**
 * Every release and epic a premortem can link to, releases first. Example
 * rows (a loaded example in those tools) aren't offered: a real premortem
 * about a made-up release would outlive the example.
 */
export function linkOptions(
  releaseDocs: readonly ReleaseReadiness[] | undefined,
  epicDocs: readonly EpicRoadmap[] | undefined
): LinkOption[] {
  const releases = (releaseDocs ?? []).find((d) => d.id === RELEASE_DOC_ID)?.releases ?? [];
  const epics = (epicDocs ?? []).find((d) => d.id === EPIC_DOC_ID)?.epics ?? [];
  return [
    ...releases
      .filter((r) => !isExampleId(r.id) && r.name?.trim())
      .map(
        (r): LinkOption => ({
          kind: "release",
          id: r.id,
          name: r.name.trim(),
          detail: r.plannedDate ? `planned ${r.plannedDate}` : undefined,
        })
      ),
    ...epics
      .filter((e) => !isExampleId(e.id) && e.title?.trim())
      .map(
        (e): LinkOption => ({
          kind: "epic",
          id: e.id,
          name: e.title.trim(),
          detail:
            e.startQuarter && e.endQuarter ? `${e.startQuarter} – ${e.endQuarter}` : undefined,
        })
      ),
  ];
}

export interface ResolvedLink {
  kind: PremortemLink["kind"];
  /** The current name, or the snapshot when the target is gone. */
  name: string;
  removed: boolean;
}

/** A premortem's link as it reads today: renamed targets show their new name. */
export function resolveLink(
  link: PremortemLink | undefined,
  options: readonly LinkOption[]
): ResolvedLink | null {
  if (!link) return null;
  const live = options.find((o) => o.kind === link.kind && o.id === link.id);
  return live
    ? { kind: link.kind, name: live.name, removed: false }
    : { kind: link.kind, name: link.name, removed: true };
}

/** "Release “2.0”", or "Release “2.0” (removed)". */
export function linkText(resolved: ResolvedLink | null): string {
  if (!resolved) return "Not linked";
  return `${KIND_LABEL[resolved.kind]} “${resolved.name}”${resolved.removed ? " (removed)" : ""}`;
}
