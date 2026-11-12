/**
 * The wall-room kit's UI. Tools mount `WallRoomHost` (Audience Wall; its
 * own host controls go in the render prop); the `/join` page mounts
 * `WallJoinRoom` (lazily, after consent). `WallPostList` and
 * `WallPostForm` are the pieces both compose.
 */

export { WallRoomHost, type WallRoomHostProps } from "./wall-room-host";
export { WallJoinRoom, wallRefusalText, type WallJoinRoomProps } from "./wall-join-room";
export { WallPostList, type WallPostListProps, type ListedPost } from "./wall-post-list";
export { WallPostForm, wallSendError, type WallPostFormProps } from "./wall-post-form";
