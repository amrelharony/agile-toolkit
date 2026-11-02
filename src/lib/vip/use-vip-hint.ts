"use client";

import { useSyncExternalStore } from "react";
import { readVipHint, subscribeVipHint } from "./hint";

const browserHint = () => readVipHint();
const onServer = () => false;

/**
 * Whether menus should list the VIP tools. False on the server and the first
 * render in the browser, so static pages hydrate the same for everyone.
 */
export function useVipHint(): boolean {
  return useSyncExternalStore(subscribeVipHint, browserHint, onServer);
}
