"use client";

import { DndContext, type DndContextProps } from "@dnd-kit/core";
import { emit } from "./emit";

/**
 * Drop-in replacement for `<DndContext>` that emits sonification events on
 * the drag lifecycle.  All other props/behavior are identical — original
 * callbacks still fire after the emit.
 */
export function SonifiedDndContext(props: DndContextProps) {
  const { onDragStart, onDragEnd, ...rest } = props;
  return (
    <DndContext
      {...rest}
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
