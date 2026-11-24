/**
 * Where keyboard focus goes after "Clear example". The notice and its
 * button go with the example, so focus would fall to <body> and a keyboard
 * or screen-reader user would start again from the top of the page.
 *
 * Once React has re-rendered: the empty state's "Load an example" when the
 * page is empty again, else the page's heading (made focusable for this).
 */

/** LoadExampleButton's default label, which the empty states use. */
const LOAD_EXAMPLE = "Load an example";

export function focusAfterClearingExample(): void {
  setTimeout(() => {
    if (typeof document === "undefined") return;
    const load = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === LOAD_EXAMPLE
    );
    if (load) {
      load.focus();
      return;
    }
    const heading = document.querySelector<HTMLElement>("h1");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus();
  }, 0);
}
