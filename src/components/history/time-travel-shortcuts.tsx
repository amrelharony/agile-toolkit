"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getToolByPath } from "@/lib/constants/tools";
import { timeTravelRegistry } from "@/lib/stores/with-time-travel";

/**
 * Global keyboard handler for time-travel.
 *
 * Active only on tool pages where the current tool has opted into the
 * `withTimeTravel` middleware. Bindings:
 *   - Cmd/Ctrl + Z         → undo
 *   - Cmd/Ctrl + Shift + Z → redo (also Cmd/Ctrl + Y on non-Mac)
 *
 * Skips when a contenteditable / input / textarea is focused so we don't
 * eat browser-native undo on form fields.
 */
export function TimeTravelShortcuts() {
  const pathname = usePathname();

  useEffect(() => {
    const tool = getToolByPath(pathname);
    if (!tool) return;
    const toolId = tool.id;

    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (isEditable(e.target)) return;
      // BUG-C1: Cmd+Y on Mac is the browser's History menu, NOT redo;
      // ignore it entirely on Mac so we neither trigger undo nor
      // preventDefault the native shortcut.
      if (key === "y" && e.metaKey) return;

      const controls = timeTravelRegistry.get(toolId);
      if (!controls) return;

      const isRedo = (key === "z" && e.shiftKey) || (key === "y" && !e.metaKey);
      const did = isRedo ? controls.redo() : controls.undo();
      if (did) e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  return null;
}
