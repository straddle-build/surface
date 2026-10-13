/**
 * The wire version of the postMessage protocol. Receivers require an exact
 * match; a mismatch is reported via STRADDLE_VERSION_MISMATCH. Bumping the
 * protocol means bumping this single string.
 */
export const PROTOCOL_VERSION = '1'
