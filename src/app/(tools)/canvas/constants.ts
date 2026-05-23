// Default sizes for newly-created objects. Shared between the
// add-object-at factory (single-click create) and the pointer-up
// trivial-drag fallback (drag-to-create that didn't actually drag).
//
// Keep these here rather than in either consumer so the two stay in
// sync — if the sticky default ever bumps to 240×180, both code
// paths pick it up.

export const STICKY_DEFAULT = { w: 200, h: 160 } as const;
export const SHAPE_DEFAULT = { w: 160, h: 120 } as const;
export const TEXT_DEFAULT = { w: 240, h: 40 } as const;
