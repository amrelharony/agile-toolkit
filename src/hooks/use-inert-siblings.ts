"use client";

import { useEffect, type RefObject } from "react";

/**
 * Make everything outside the modal overlay `inert` while it is open, so
 * neither Tab nor a screen reader's virtual cursor can wander into the page
 * underneath. The overlay is portalled straight into <body>, so its
 * siblings are the whole app plus any other portals. Elements that were
 * already inert are left alone on restore.
 */
export function useInertSiblings(ref: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    const overlay = ref.current;
    if (!active || !overlay || overlay.parentElement !== document.body) return;
    const changed: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === overlay || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      changed.push(child);
    }
    return () => {
      for (const child of changed) child.removeAttribute("inert");
    };
  }, [ref, active]);
}
