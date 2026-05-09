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
      if (e.key.toLowerCase() !== "z" && e.key.toLowerCase() !== "y") return;
      if (isEditable(e.target)) return;

      const controls = timeTravelRegistry.get(toolId);
      if (!controls) return;

      const isRedo =
        (e.key.toLowerCase() === "z" && e.shiftKey) ||
        (e.key.toLowerCase() === "y" && !e.metaKey);
      const did = isRedo ? controls.redo() : controls.undo();
      if (did) e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  return null;
}
