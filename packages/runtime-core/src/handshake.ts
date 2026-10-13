/**
 * How long either side waits for the handshake to complete before giving up:
 * the parent's mount timeout and the surface's HELLO-resend cap share this so
 * they cannot drift. Bumping the handshake budget means bumping this one value.
 */
export const HANDSHAKE_TIMEOUT_MS = 10_000
