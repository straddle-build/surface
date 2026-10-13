/** Which way a message travels across the parent<->iframe channel. */
export type Direction = 'parent->iframe' | 'iframe->parent'

/** Stable error vocabulary carried on STRADDLE_ERROR. */
export type StraddleErrorCode =
  | 'INVALID_TOKEN' // iframe rejected the INIT credential
  | 'ORIGIN_MISMATCH' // parent origin not permitted for this session
  | 'WRONG_SURFACE' // token/surface mismatch (onboarding vs bridge)
  | 'VERSION_MISMATCH' // surfaced from STRADDLE_VERSION_MISMATCH
  | 'INTERNAL' // unexpected iframe-side failure

/** Fields shared by every envelope. */
interface EnvelopeBase {
  /**
   * Protocol version. Receivers require an exact match against PROTOCOL_VERSION.
   * Typed `string` (not the literal '1') so a mismatched message still
   * deserializes far enough to be inspected and reported.
   */
  version: string
  /** Scopes a message to one component instance; mismatches are dropped. */
  instanceId: string
  /** Unique per message; presence-validated only in v1. Not a correlation token. */
  nonce: string
}

// --- Payloads ---------------------------------------------------------------

/**
 * STRADDLE_INIT — parent forwards the opaque session credential to the iframe,
 * plus any surface-defined initialization `options` (omitted when none).
 */
export interface InitPayload {
  token: string
  options?: Record<string, unknown>
}

/** STRADDLE_HELLO — iframe announces its listener is installed. Empty payload. */
export type HelloPayload = Record<never, never>

/** STRADDLE_READY — iframe is verified and live. Empty payload. */
export type ReadyPayload = Record<never, never>

/** STRADDLE_HEIGHT — iframe reports its content height for the parent to apply. */
export interface HeightPayload {
  height: number
}

/** STRADDLE_RESIZE — optional parent->iframe size hint. */
export interface ResizePayload {
  width: number
  height: number
}

/** STRADDLE_COMPLETE — flow finished successfully; `data` is surface-defined. */
export interface CompletePayload {
  data?: Record<string, unknown>
}

/** STRADDLE_EXIT — user deliberately left before completing. */
export interface ExitPayload {
  reason?: string
}

/** STRADDLE_REDIRECT — surface requests a top-level browser navigation. */
export interface RedirectPayload {
  url: string
}

/** STRADDLE_ERROR — a failure (not a user choice). */
export interface ErrorPayload {
  code: StraddleErrorCode
  message: string
}

/**
 * STRADDLE_VERSION_MISMATCH — one side detected it cannot speak the other's
 * protocol version. In v1 the parent is the detector (a version-mismatched
 * HELLO is exempt from the version gate) and sends this to the iframe.
 */
export interface VersionMismatchPayload {
  ourVersion: string
  theirVersion?: string
}

// --- Discriminated union ----------------------------------------------------

/**
 * Every protocol message. Narrowing on `type` narrows `payload` at compile time.
 */
export type Envelope =
  | (EnvelopeBase & { type: 'STRADDLE_HELLO'; payload: HelloPayload })
  | (EnvelopeBase & { type: 'STRADDLE_INIT'; payload: InitPayload })
  | (EnvelopeBase & { type: 'STRADDLE_READY'; payload: ReadyPayload })
  | (EnvelopeBase & { type: 'STRADDLE_HEIGHT'; payload: HeightPayload })
  | (EnvelopeBase & { type: 'STRADDLE_RESIZE'; payload: ResizePayload })
  | (EnvelopeBase & { type: 'STRADDLE_COMPLETE'; payload: CompletePayload })
  | (EnvelopeBase & { type: 'STRADDLE_EXIT'; payload: ExitPayload })
  | (EnvelopeBase & { type: 'STRADDLE_REDIRECT'; payload: RedirectPayload })
  | (EnvelopeBase & { type: 'STRADDLE_ERROR'; payload: ErrorPayload })
  | (EnvelopeBase & {
      type: 'STRADDLE_VERSION_MISMATCH'
      payload: VersionMismatchPayload
    })

/** The set of all message type strings. */
export type MessageType = Envelope['type']
