"use client";

/**
 * Amr's scenes: every story he can act out, to play one on purpose.
 *
 * The companion stories the visitor may ask for (COMPANION_SCENES.play), then
 * the expansion scenes X001–X124 by family, each with a small picture of the
 * pose a tap leaves him in (one atlas for them all, engine/scene-thumbs.ts) and
 * its title. Only scenes whose packs ship. Tapping one plays it now and closes the
 * panel so he's in view (while a turn is still running, MascotAssistant goes back
 * to the chat instead, since closing would stop it): the visitor asked for it,
 * which is the one way these scenes play outside the real moments their rules
 * name. Reduced motion shows the scene's still (the engine's rule), and Quiet
 * silences his speech only.
 *
 * MascotAssistant loads this with next/dynamic when the view first opens, so
 * the titles and the atlas cost nothing until then.
 */

import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Play, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { EXPANSION_SHEETS, type ExpansionFamily } from "./engine/expansion-table";
import { EXPANSION_TITLES } from "./engine/expansion-titles";
import { SCENE_THUMBS, THUMB_INDEX } from "./engine/scene-thumbs";
import { COMPANION_SCENES, galleryScene, sceneReaction, type SceneName } from "./engine/scenes";
import { shippedScene } from "./engine/sprite-poses";
import { DOCK_END } from "./panel-context";

/** The companion stories' titles (docs/mascot/companion-scenes.json; a test keeps them equal). */
export const COMPANION_TITLES: Readonly<Record<string, string>> = {
  reviewer: "AI Reviewer",
  dino: "Dinosaur Priorities",
  rabbit: "Deadline Rabbit Rush",
  octopus: "Octopus Overload",
  ahwa: "Ahwa Debrief",
  escape: "Sticky Escape",
  comic: "Comic to Action",
  retry: "Graceful Retry",
  quiet: "Quiet Companion",
};

/** The expansion families, in the order the tab lists them, with their headings. */
const FAMILIES: ReadonlyArray<[ExpansionFamily, string]> = [
  ["reading", "Reading"],
  ["tools", "Tool lab"],
  ["team", "Team and decisions"],
  ["cast", "Cast encounters"],
  ["guides", "Guides"],
  ["play", "Play"],
];

/** A thumbnail's size in the list: the atlas cell (72 x 84) at three quarters. */
const THUMB = { w: 54, h: 63 };

interface SceneItem {
  /** The pack (or companion story) it's listed under. */
  key: string;
  /** The scene a tap plays (an expansion pack's gallery variant, where it has one). */
  scene: SceneName;
  title: string;
  /** Its cell in the thumbnail atlas, if it has one. */
  thumb: number | undefined;
}

interface SceneGroup {
  id: string;
  title: string;
  items: SceneItem[];
}

/** Every scene the site can play on request, grouped, leaving out any whose pack doesn't ship. */
function sceneGroups(): SceneGroup[] {
  const groups: SceneGroup[] = [
    {
      id: "companion",
      title: "Companion stories",
      items: COMPANION_SCENES.play
        .filter((name) => shippedScene(name) !== undefined)
        .map((name) => ({
          key: name,
          scene: name,
          title: COMPANION_TITLES[name] ?? name,
          thumb: THUMB_INDEX[name],
        })),
    },
    ...FAMILIES.map(([family, title]) => ({
      id: family,
      title,
      items: EXPANSION_SHEETS.filter((s) => s.family === family).flatMap(({ pack }) => {
        const scene = galleryScene(pack);
        if (shippedScene(scene) === undefined) return [];
        return [
          { key: pack, scene, title: EXPANSION_TITLES[pack] ?? pack, thumb: THUMB_INDEX[pack] },
        ];
      }),
    })),
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** For matching: lower case, curly apostrophes made straight. */
const fold = (s: string) => s.toLocaleLowerCase().replace(/[‘’]/g, "'").trim();

/** A thumbnail's piece of the atlas, scaled to THUMB. */
function thumbStyle(cell: number | undefined): CSSProperties {
  const size = { width: THUMB.w, height: THUMB.h };
  if (cell === undefined) return size;
  const col = cell % SCENE_THUMBS.columns;
  const row = Math.floor(cell / SCENE_THUMBS.columns);
  return {
    ...size,
    backgroundImage: `url(${SCENE_THUMBS.src})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${SCENE_THUMBS.columns * THUMB.w}px ${SCENE_THUMBS.rows * THUMB.h}px`,
    backgroundPosition: `-${col * THUMB.w}px -${row * THUMB.h}px`,
  };
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export default function ScenesTab({
  onPlay,
}: {
  /** Called once a scene starts: the panel closes so he's in view, or goes back to a running turn. */
  onPlay: () => void;
}) {
  const uid = useId();
  const groups = useMemo(sceneGroups, []);
  const total = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const wanted = fold(query);
  const shown = useMemo(() => {
    if (!wanted) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => fold(it.title).includes(wanted)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, wanted]);
  const count = shown.reduce((n, g) => n + g.items.length, 0);
  const typed = query.trim();
  const status = !wanted
    ? `${total} scenes. Tap one and Amr acts it out, just for fun.`
    : count === 0
      ? `No scenes match “${typed}”.`
      : `${count} ${count === 1 ? "scene matches" : "scenes match"} “${typed}”.`;

  const play = (scene: SceneName) => {
    useMascotStore.getState().playNow(sceneReaction(scene));
    onPlay();
  };

  // Up and down move through the list (and from the field into it), so the
  // keyboard needn't tab past every scene; Home and End jump to its ends.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    const filter = filterRef.current;
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-amr-scene]") ?? []
    );
    const inFilter = e.currentTarget === filter;
    const i = buttons.indexOf(e.currentTarget as HTMLButtonElement);
    if (!buttons.length || (!inFilter && i < 0)) return;
    // In the field, Home and End move the caret.
    if (inFilter && (e.key === "Home" || e.key === "End")) return;
    let next: HTMLElement | null | undefined;
    if (e.key === "ArrowDown") next = inFilter ? buttons[0] : buttons[i + 1];
    else if (e.key === "ArrowUp") next = inFilter ? undefined : i === 0 ? filter : buttons[i - 1];
    else if (e.key === "Home") next = buttons[0];
    else next = buttons[buttons.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  // Escape empties the field first; only an empty one lets it close the panel.
  const onFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
      return;
    }
    onKeyDown(e);
  };

  return (
    <div ref={rootRef} data-testid="mascot-scenes" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border px-4 py-2.5">
        <label htmlFor={`${uid}-filter`} className="sr-only">
          Find a scene
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub"
            aria-hidden="true"
          />
          <Input
            ref={filterRef}
            id={`${uid}-filter`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFilterKeyDown}
            placeholder="Find a scene"
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <p role="status" className="text-xs text-sub">
          {status}
        </p>
      </div>
      {/* In the phone's sheet it pans (data-amr-scroll) and ends above Amr
          docked there, so no scene scrolls under him. */}
      <div
        data-amr-scroll=""
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 ${DOCK_END}`}
      >
        {shown.map((group) => (
          <div key={group.id} className="pt-2">
            <h2
              id={`${uid}-${group.id}`}
              className="sticky top-0 z-10 bg-surface-deep px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sub"
            >
              {group.title}
            </h2>
            <ul aria-labelledby={`${uid}-${group.id}`} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    data-amr-scene
                    aria-label={`Play: ${item.title}`}
                    onClick={() => play(item.scene)}
                    onKeyDown={onKeyDown}
                    className="min-touch-coarse group flex w-full scroll-mt-8 items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span
                      aria-hidden="true"
                      data-amr-thumb
                      className="block shrink-0 rounded-md bg-card"
                      style={thumbStyle(item.thumb)}
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium text-text group-hover:text-accent">
                      {item.title}
                    </span>
                    <Play
                      className="h-4 w-4 shrink-0 text-sub group-hover:text-accent"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
