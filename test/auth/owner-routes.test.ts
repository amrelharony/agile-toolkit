import { describe, expect, it } from "vitest";
import { OWNER_ONLY_PAGES, isOwnerOnlyPage, routeKind } from "@/lib/auth/owner-routes";

describe("routeKind", () => {
  it.each(["/api", "/api/", "/api/kudos", "/api/squads/1/profiles", "/API/kudos", "/Api"])(
    "%s is the API",
    (path) => {
      expect(routeKind(path)).toBe("api");
    }
  );

  it.each([
    "/settings/access-tokens",
    "/settings/access-tokens/new",
    "/settings/squads",
    "/settings/squads/abc",
    "/Settings/Squads",
  ])("%s is an owner page", (path) => {
    expect(routeKind(path)).toBe("owner-page");
    expect(isOwnerOnlyPage(path)).toBe(true);
  });

  it.each([
    "/",
    "/planning-poker",
    // The private comic link: the token is the gate, not a session.
    "/comic/AbCdEf0123456789_-AbCdEf",
    "/settings",
    "/settings/appearance",
    "/settings/access-tokens-old",
    "/settings/squadsx",
    "/history",
    "/apix",
    "/x/api/kudos",
  ])("%s is a public page", (path) => {
    expect(routeKind(path)).toBe("public-page");
    expect(isOwnerOnlyPage(path)).toBe(false);
  });

  it("lists exactly the two owner management pages", () => {
    expect([...OWNER_ONLY_PAGES]).toEqual(["/settings/access-tokens", "/settings/squads"]);
  });
});
