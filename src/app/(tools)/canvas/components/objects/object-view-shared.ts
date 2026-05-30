import type React from "react";

/**
 * Shared prop shape for the per-type object-view components carved out of
 * object-renderer's `switch (o.type)`. Each view re-derives the same
 * `handle`/`dblClick`/`commitEdit`/`selectionStyle` locals the switch did, so
 * its render body stays byte-identical to the original case. Frame additionally
 * takes `onMutate` (extends this).
 */
export interface ObjectViewBaseProps {
  selected: boolean;
  editing?: boolean;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
  onDoubleClick?: (id: string) => void;
  onCommitEdit?: (id: string, text: string) => void;
}
