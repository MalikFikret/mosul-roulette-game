// Building blocks for the Realtime Database security rules. Every rule expression in
// database.rules.json is assembled from these pieces, so the same check reads the same way
// everywhere. Each helper returns a plain expression string.

// --- Combining expressions -------------------------------------------------------------------

/** a && b && c */
export const all = (...parts) => parts.join(' && ');

/** (a || b): a simple alternative, written without extra parentheses around a and b. */
export const either = (a, b) => `(${a} || ${b})`;

/** ((a) || (b) || ...): alternative branches, each in its own parentheses. */
export const anyOf = (...branches) => `(${branches.map((branch) => `(${branch})`).join(' || ')})`;

// --- Constant pieces -------------------------------------------------------------------------

export const SIGNED_IN = 'auth != null';

// Room codes: 6 characters without look-alikes (src/rooms/code.js; tests/room-code.test.js
// checks that both use the same alphabet).
export const CODE_OK = '$code.matches(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)';

// Seat ids s01..s15: the fixed set is how the 15-player limit is enforced.
export const SEAT_ID_PATTERN = '/^s(0[1-9]|1[0-5])$/';
export const SEAT_IDS = Array.from({ length: 15 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);

export const PIN_PATTERN = '/^[0-9]{4}$/';

/** `value` is a seat id (s01..s15). */
export const isSeatId = (value) => `${value}.matches(${SEAT_ID_PATTERN})`;

// Leaf rules used in many places.
export const REFUSE = { '.validate': false };
export const NUMBER = { '.validate': 'newData.isNumber()' };
export const BOOLEAN = { '.validate': 'newData.isBoolean()' };

// --- Where the room is -----------------------------------------------------------------------
// The room BEFORE the write is always reached through `root` (the data before the write, at any
// depth), never through data.parent() chains, so no rule depends on counting parent() calls.
// The room AFTER the write has no such shortcut: it is reached from `newData` with .parent()
// calls, so those helpers are named by the depth of the rule they are used in.

/** The room before the write, from any rule below rooms/$code. */
export const ROOM_BEFORE = "root.child('rooms').child($code)";

/** The room after the write, from a node one level below it (e.g. settings, match). */
export const NEW_ROOM_FROM_DEPTH_1 = 'newData.parent()';

/** The room after the write, from a node two levels below it (e.g. seats/$seatId, secrets/$seatId). */
export const NEW_ROOM_FROM_DEPTH_2 = 'newData.parent().parent()';

/** The room after the write, from a node three levels below it (seats/$seatId/uid). */
export const NEW_ROOM_FROM_DEPTH_3 = 'newData.parent().parent().parent()';

// --- Membership ------------------------------------------------------------------------------
// A user is a member only if members/{auth.uid} exists AND seats/{that seat}/uid === auth.uid.
// A members entry whose seat now has another uid (the seat was recovered on another device) is
// stale and grants nothing.

/** members/{auth.uid} of the given room. */
export const memberEntry = (room) => `${room}.child('members').child(auth.uid)`;

/** The writer / reader is a valid member of `room`. */
export const isMember = (room) =>
  `${memberEntry(room)}.exists() && ${room}.child('seats').child(${memberEntry(room)}.val()).child('uid').val() === auth.uid`;

/** The writer is not a valid member of `room` (no entry, or a stale one). */
export const isNotMember = (room) =>
  either(`!${memberEntry(room)}.exists()`, `${room}.child('seats').child(${memberEntry(room)}.val()).child('uid').val() !== auth.uid`);

/** The writer is a valid member AND sits on `seat` (an expression giving a seat id). */
export const sitsOn = (room, seat) =>
  `${memberEntry(room)}.val() === ${seat} && ${room}.child('seats').child(${seat}).child('uid').val() === auth.uid`;

// --- Leaving (between matches only) ------------------------------------------------------------

/** meta.status before the write: 'lobby' between matches, 'playing' while a match runs. */
export const STATUS_BEFORE = `${ROOM_BEFORE}.child('meta/status').val()`;

/** The room is in the lobby (no match running), before the write. */
export const IN_LOBBY = `${ROOM_BEFORE}.child('meta/status').val() === 'lobby'`;

/** The writer sits on `seat` before the write and the room is in the lobby. */
export const leaver = (seat) => `${sitsOn(ROOM_BEFORE, seat)} && ${IN_LOBBY}`;

/**
 * A node that belongs to `seat` is deleted while its owner leaves: the node is gone, the writer
 * is leaving that seat, and the seat itself is gone after the same write (`newSeats` is the
 * seats node after the write). So no secret / claim / presence / members entry outlives a seat.
 */
export const deletedWithOwnSeat = (seat, newSeats) => all('!newData.exists()', leaver(seat), `!${newSeats}.child(${seat}).exists()`);

// --- The host and kicking (between matches only) -----------------------------------------------

/** The host seat before the write. */
export const HOST_SEAT_BEFORE = `${ROOM_BEFORE}.child('meta/hostSeat').val()`;

/** The writer is the host: a valid member sitting on meta.hostSeat, before the write. */
export const IS_HOST = sitsOn(ROOM_BEFORE, HOST_SEAT_BEFORE);

/** The writer is the host kicking `seat`: not the host's own seat, and the room is in the lobby. */
export const kicker = (seat) => all(IS_HOST, `${seat} !== ${HOST_SEAT_BEFORE}`, IN_LOBBY);

/**
 * A node that belongs to `seat` is deleted while the host kicks that seat: the node is gone, the
 * writer may kick the seat, and the seat itself is gone after the same write.
 */
export const deletedByKick = (seat, newSeats) => all('!newData.exists()', kicker(seat), `!${newSeats}.child(${seat}).exists()`);

// --- Unique names --------------------------------------------------------------------------------
// names/{key} = seatId, key = the seat's name in lower case (String.toLowerCase() in the rules
// and in JavaScript agree for every name we tested, Turkish dotted / dotless i included). These
// characters are illegal in database keys, so they are refused in names.

export const NAME_KEY_FORBIDDEN = ['.', '$', '#', '[', ']', '/'];

/** The key in names/ of a name expression. */
export const nameKey = (name) => `${name}.toLowerCase()`;

/** The name expression contains none of the characters that are illegal in keys. */
export const noForbiddenKeyChars = (name) => all(...NAME_KEY_FORBIDDEN.map((ch) => `!${name}.contains('${ch}')`));
