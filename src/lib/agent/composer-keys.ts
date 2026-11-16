/**
 * What a key press in the chat's message box does (design 1.3 item 8), one
 * rule for both chats' composer, worked out without React or the DOM:
 *
 *   send     Ctrl+Enter or Cmd+Enter, on every device, so a tablet or a phone
 *            with a keyboard plugged in still has a way to send; and a bare
 *            Enter with a fine pointer (a mouse or a trackpad), as chats on a
 *            computer do. The composer calls preventDefault and sends, when it
 *            can: never while Amr answers, never an empty box.
 *   newline  Shift+Enter, and a bare Enter on a touch screen, whose return key
 *            says "new line" there (the box's enterKeyHint is "enter"): the
 *            Send button sends. The box takes the line as it would anyway, so
 *            the composer leaves the event alone.
 *   null     anything else, which the composer leaves alone too: another key;
 *            every key while an input method is composing (isComposing, or
 *            keyCode 229, which Safari sends for the Enter that ends a
 *            composition after its compositionend), so a half-converted
 *            Japanese, Chinese or Korean word, or an Android keyboard's word,
 *            is never sent; and the repeats of a held press that sends: the
 *            first keydown sends, its repeats send nothing more (as the Send
 *            button ignores activations with `repeat` set), so holding the
 *            key down never sends twice. The box types what a held key types,
 *            as it does for any key held down.
 *
 * The pointer is read as the key comes (chat-context onTouchScreen), not when
 * the box renders, so plugging a keyboard or a mouse in is picked up and
 * nothing is read on the server.
 *
 * Pure, with no imports, so the visitor chat may use it
 * (test/agent/bundle-boundary.test.ts).
 */

/** What a press means in the message box: see the top of this file. */
export type ComposerKeyAction = "send" | "newline" | null;

/** The pointer the reader has: a mouse or a trackpad (`fine`), or a finger (`coarse`). */
export type PointerKind = "fine" | "coarse";

/** The parts of a keydown the rule reads (a React or a DOM KeyboardEvent has them all). */
export interface ComposerKeyPress {
  key: string;
  /** Set while an input method is composing (React: `e.nativeEvent.isComposing`). */
  isComposing?: boolean;
  /** 229 while an input method has the key. */
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** The key is held down and this keydown is one of its repeats. */
  repeat?: boolean;
}

/** The keyCode browsers give a key an input method is handling. */
const IME_KEY_CODE = 229;

/** What `press` does in the message box, with this pointer. */
export function composerKey(press: ComposerKeyPress, pointer: PointerKind): ComposerKeyAction {
  if (press.isComposing || press.keyCode === IME_KEY_CODE) return null;
  if (press.key !== "Enter") return null;
  const sends = !!(press.ctrlKey || press.metaKey) || (!press.shiftKey && pointer === "fine");
  if (!sends) return "newline";
  return press.repeat ? null : "send";
}
