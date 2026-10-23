"use client";

import { useId } from "react";
import { DndContext, type DndContextProps } from "@dnd-kit/core";
import { emit } from "./emit";

/**
 * Drop-in replacement for `<DndContext>` that emits sonification events on
 * the drag lifecycle, with a hydration-safe default `id`. All other
 * props/behavior are identical — original callbacks still fire after the
 * emit.
 */
export function SonifiedDndContext(props: DndContextProps) {
  const { onDragStart, onDragEnd, id, ...rest } = props;
  // dnd-kit numbers its accessibility ids per page load ("DndDescribedBy-0"),
  // so the server and the browser disagreed and React warned on hydration.
  // useId is the same on both.
  const stableId = useId();
  return (
    <DndContext
      {...rest}
      id={id ?? stableId}
      onDragStart={(e) => {
        emit("ui", "drag-start");
        onDragStart?.(e);
      }}
      onDragEnd={(e) => {
        emit("ui", e.over ? "drag-drop" : "drag-end");
        onDragEnd?.(e);
      }}
    />
  );
}
