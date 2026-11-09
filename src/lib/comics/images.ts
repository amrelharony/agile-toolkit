/**
 * The public address of a stored panel image. The table keeps paths rather than
 * URLs, so moving the art behind a CDN later changes only this function.
 */

const BUCKET = "comic-panels";

export function panelImageUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

/**
 * How a page's comic art loads, as <img> props. Art below the fold waits until
 * it nears the screen. The one picture a page opens on (`first`) starts with
 * the HTML at high priority instead: it's the page's largest paint, and lazy
 * loading would hold it back until layout.
 */
export function artLoading(first: boolean) {
  return first
    ? ({ loading: "eager", fetchPriority: "high" } as const)
    : ({ loading: "lazy" } as const);
}
