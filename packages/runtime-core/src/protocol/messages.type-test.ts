// Compile-time assertions for the protocol message types. Verified by
// `tsc --noEmit`, NOT by `bun test` (hence the .type-test.ts suffix).
import type {
  Direction,
  Envelope,
  ErrorPayload,
  HeightPayload,
  InitPayload,
  MessageType,
  StraddleErrorCode,
} from './messages'

// --- type-level equality helpers (no runtime, no dependency) ---
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Expect<T extends true> = T

// Narrowing on `type` selects the matching payload.
type _initPayload = Expect<
  Equal<Extract<Envelope, { type: 'STRADDLE_INIT' }>['payload'], InitPayload>
>
type _heightPayload = Expect<
  Equal<
    Extract<Envelope, { type: 'STRADDLE_HEIGHT' }>['payload'],
    HeightPayload
  >
>
type _errorPayload = Expect<
  Equal<Extract<Envelope, { type: 'STRADDLE_ERROR' }>['payload'], ErrorPayload>
>

// MessageType is exactly the ten wire types.
type _messageType = Expect<
  Equal<
    MessageType,
    | 'STRADDLE_HELLO'
    | 'STRADDLE_INIT'
    | 'STRADDLE_READY'
    | 'STRADDLE_HEIGHT'
    | 'STRADDLE_RESIZE'
    | 'STRADDLE_COMPLETE'
    | 'STRADDLE_EXIT'
    | 'STRADDLE_REDIRECT'
    | 'STRADDLE_ERROR'
    | 'STRADDLE_VERSION_MISMATCH'
  >
>

// Error codes are the agreed vocabulary.
type _errorCode = Expect<
  Equal<
    StraddleErrorCode,
    | 'INVALID_TOKEN'
    | 'ORIGIN_MISMATCH'
    | 'WRONG_SURFACE'
    | 'VERSION_MISMATCH'
    | 'INTERNAL'
  >
>

type _direction = Expect<Equal<Direction, 'parent->iframe' | 'iframe->parent'>>

// A well-formed INIT envelope assigns cleanly.
const initEnvelope: Envelope = {
  type: 'STRADDLE_INIT',
  version: '1',
  instanceId: 'abc',
  nonce: 'n-1',
  payload: { token: 'opaque' },
}

// Accessing the wrong payload field for a narrowed type must be rejected.
if (initEnvelope.type === 'STRADDLE_INIT') {
  // @ts-expect-error — INIT payload has `token`, not `height`
  initEnvelope.payload.height
}

// Referencing the asserted aliases so unused-locals stays quiet.
export type _Assertions = [
  _initPayload,
  _heightPayload,
  _errorPayload,
  _messageType,
  _errorCode,
  _direction,
]
