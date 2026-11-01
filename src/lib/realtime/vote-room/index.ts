/**
 * The anonymous vote-round kit's logic, for server code and MCP actions:
 * the protocol (types, limits, readers) and the aggregates. Pure, no
 * browser globals.
 *
 * The client pieces import their own modules: `./crypto` (WebCrypto,
 * looked up when called) and `./use-vote-room` ("use client").
 */

export * from "./protocol";
export * from "./aggregate";
