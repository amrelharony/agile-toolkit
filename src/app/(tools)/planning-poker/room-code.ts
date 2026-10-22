import { customAlphabet } from "nanoid";

/** The unambiguous alphabet room codes use: no 0/O/1/I/L. */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Owner and squad-guest Planning Poker rooms: 16 characters from a CSPRNG
 * (nanoid), about 79 bits. The code is the room's Realtime channel name, and
 * a public channel can be joined by anyone who knows its name, so the code
 * must not be guessable; 6 characters was about 30 bits. Not 12: that length
 * marks a visitor-room code.
 */
export const OWNER_ROOM_CODE_LENGTH = 16;

const roomCodeGenerator = customAlphabet(ROOM_CODE_ALPHABET, OWNER_ROOM_CODE_LENGTH);

export function generateRoomCode(): string {
  return roomCodeGenerator();
}
