/**
 * The show-room kit's UI. Tools mount `ShowRoomHost` (with their controls
 * as its render prop); the `/join` page mounts `ShowJoinRoom` (lazily,
 * after consent). `ShowFrameView` draws a frame through the renderer
 * registry (`lib/realtime/show-room/renderers`).
 *
 * Only `ShowRoomHost` is exported from here, with the others' types: a tool
 * page that imports this file would otherwise download the participant's
 * room and the frame view up front. Import those from their own files.
 */

export { ShowRoomHost, type ShowRoomHostProps } from "./show-room-host";
export type { ShowJoinRoomProps } from "./show-join-room";
export type { ShowFrameViewProps } from "./show-frame-view";
