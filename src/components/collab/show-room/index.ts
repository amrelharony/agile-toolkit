/**
 * The show-room kit's UI. Tools mount `ShowRoomHost` (with their controls
 * as its render prop); the `/join` page mounts `ShowJoinRoom` (lazily,
 * after consent). `ShowFrameView` draws a frame through the renderer
 * registry (`lib/realtime/show-room/renderers`).
 */

export { ShowBigScreenFrame, ShowRoomHost, type ShowRoomHostProps } from "./show-room-host";
export { ShowJoinRoom, type ShowJoinRoomProps } from "./show-join-room";
export { ShowFrameView, type ShowFrameViewProps } from "./show-frame-view";
