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
