/**
 * What pages need to know about VIP, apart from book-access.ts: client
 * components import from here, so the key hashes never reach the browser.
 */

/** The VIP landing page; the printed link redirects here. */
export const VIP_ROUTE = "/vip";
export const VIP_TITLE = "VIP access";
/** What a locked page says about itself: never which tool or story it holds. */
export const VIP_DESCRIPTION = "VIP access to the Agile Toolkit for readers of the printed book.";

/**
 * The display-only hint set beside the httpOnly access cookie. Browser code can
 * read it, so the menus know whether to list the VIP tools. It unlocks nothing:
 * the server only ever trusts the access cookie, and a forged hint gets names on
 * a menu that lead to a lock panel.
 */
export const VIP_HINT_COOKIE = "agile-toolkit:vip-hint";
export const VIP_HINT_VALUE = "1";
/** Lasts as long as the access cookie. */
export const VIP_HINT_MAX_AGE = 400 * 24 * 60 * 60;
