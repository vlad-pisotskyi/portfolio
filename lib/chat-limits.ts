// Client-safe chat limits. The single source of truth for the input cap, shared
// by the server guard in app/api/chat/route.ts (413 over the limit) and the
// client maxLength + character counter in ChatDrawer.
//
// MAX_INPUT_CHARS bounds ONE message (the client textarea cap). The server
// checks it against the newest user turn only. MAX_CONVERSATION_CHARS is the
// separate whole-transcript ceiling — assistant replies included — so a long
// back-and-forth is stopped with its own honest code instead of looking like an
// overlong single message.
export const MAX_INPUT_CHARS = 4000;
export const MAX_CONVERSATION_CHARS = 24_000;
