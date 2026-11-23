/**
 * What a visitor's chat loads on its first message, as one import: the agent
 * runtime (lib/agent/visitor-runtime: the action registry and the streaming
 * client) and the strip kit (chat/strip-kit: the parts that draw messages).
 * One import, so webpack places the kit with the registry chunk that both
 * chats already load: no extra request for a visitor, and no cost for the
 * owner, whose chat imports the kit itself. The visitor's chat
 * (./visitor-agent-panel) is the only importer, with a dynamic import
 * (test/agent/bundle-boundary.test.ts).
 */

export * from "@/lib/agent/visitor-runtime";
export { STRIP_KIT } from "../chat/strip-kit";
