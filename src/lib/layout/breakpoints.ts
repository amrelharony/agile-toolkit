/**
 * Layout breakpoints shared by code that can't use Tailwind classes (media
 * queries in JS, toaster offsets, the mascot). They mirror Tailwind's
 * defaults: a phone is anything below `sm` (640px).
 */

/** Widest viewport, in CSS pixels, that counts as a phone. */
export const PHONE_MAX_PX = 639;

/** Media query matching a phone-width viewport. */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_PX}px)`;

/** True when the current viewport is phone width. False on the server. */
export function isPhoneViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(PHONE_MEDIA_QUERY).matches === true;
}
