/**
 * The anonymous vote-round kit's logic, for server code and MCP actions:
 * the protocol (types, limits, readers), the aggregates, and the pair
 * (Kano), allocation (Buy-a-Feature, $100 Test), choice, rank and number
 * (Quick Vote) kinds of round. Pure, no browser globals.
 *
 * The client pieces import their own modules: `./crypto` (WebCrypto,
 * looked up when called) and `./use-vote-room` ("use client").
 */

export * from "./protocol";
export * from "./aggregate";
export * from "./pair";
export * from "./allocation";
export * from "./choice";
export * from "./rank";
export * from "./number";
export * from "./kinds";
