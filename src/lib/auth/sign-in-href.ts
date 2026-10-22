import { usePathname } from "next/navigation";
import { useReaderPageStore } from "@/lib/stores/reader-page-store";

/** Link to the owner sign-in that comes back to `pathname` afterwards. */
export function signInHref(pathname: string | null | undefined): string {
  return `/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`;
}

/**
 * signInHref for the current page — except a reader page (the private
 * comic, see lib/stores/reader-page-store), whose path is never carried
 * along: `next` rides through the OAuth round-trip — into the redirect URL
 * handed to Supabase Auth and its logs — and the token in that path must
 * not leave this site. Signing in from there lands on the home page instead.
 */
export function useSignInHref(): string {
  const pathname = usePathname();
  const onReaderPage = useReaderPageStore((s) => s.title !== null);
  return signInHref(onReaderPage ? null : pathname);
}
