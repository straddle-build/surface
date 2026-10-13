import { PROTOCOL_VERSION } from './protocol/version.js'
import type { Envelope, MessageType } from './protocol/messages.js'

/** A postMessage-capable target. A real `Window` satisfies this structurally. */
export interface PostMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

/** A received cross-window message. A real `MessageEvent` satisfies this. */
export interface ReceivedMessage {
  origin: string
  data: unknown
}

/** The payload type paired with a given message `type`. */
type PayloadFor<T extends MessageType> = Extract<
  Envelope,
  { type: T }
>['payload']

// Every MessageType, as a tuple. `satisfies` checks each entry is a real
// MessageType; the assertion below fails to compile if any variant is missing,
// so adding a new message type forces an update here (no silent drops).
const ALL_MESSAGE_TYPES = [
  'STRADDLE_HELLO',
  'STRADDLE_INIT',
  'STRADDLE_READY',
  'STRADDLE_HEIGHT',
  'STRADDLE_RESIZE',
  'STRADDLE_COMPLETE',
  'STRADDLE_EXIT',
  'STRADDLE_REDIRECT',
  'STRADDLE_ERROR',
  'STRADDLE_VERSION_MISMATCH',
] as const satisfies readonly MessageType[]

// Compile-time exhaustiveness: errors if a MessageType is missing above.
type _AllTypesCovered =
  Exclude<MessageType, (typeof ALL_MESSAGE_TYPES)[number]> extends never
    ? true
    : [
        'ALL_MESSAGE_TYPES is missing a MessageType',
        Exclude<MessageType, (typeof ALL_MESSAGE_TYPES)[number]>,
      ]
const _allTypesCovered: _AllTypesCovered = true
void _allTypesCovered

const KNOWN_TYPES: ReadonlySet<string> = new Set(ALL_MESSAGE_TYPES)

/**
 * Post a protocol message. Stamps `version`/`instanceId`/`nonce`. `targetOrigin`
 * must be explicit — `'*'` is contractually forbidden.
 */
export function send<T extends MessageType>(
  target: PostMessageTarget,
  targetOrigin: string,
  type: T,
  instanceId: string,
  payload: PayloadFor<T>,
): void {
  if (!targetOrigin || targetOrigin === '*') {
    throw new Error('targetOrigin must be explicit — never use "*"')
  }
  const envelope = {
    type,
    version: PROTOCOL_VERSION,
    instanceId,
    nonce: crypto.randomUUID(),
    payload,
  } as Envelope
  target.postMessage(envelope, targetOrigin)
}

/**
 * Build a message handler that drops anything failing origin / shape / type /
 * instance / nonce / version checks. STRADDLE_VERSION_MISMATCH bypasses the
 * version gate because it *is* the version-error signal; STRADDLE_HELLO bypasses
 * it too because it is the app's first contact and must reach the parent across
 * a version skew so the parent can detect and report it.
 */
export function createListener(
  expectedInstanceId: string,
  expectedOrigin: string | readonly string[],
  handler: (envelope: Envelope, origin: string) => void,
): (event: ReceivedMessage) => void {
  return (event: ReceivedMessage) => {
    const originOk =
      typeof expectedOrigin === 'string'
        ? event.origin === expectedOrigin
        : expectedOrigin.includes(event.origin)
    if (!originOk) return
    if (!event.data || typeof event.data !== 'object') return
    // The guards below validate the fields TypeScript cannot prove through a
    // Partial<discriminated-union> cast — they are what make the final
    // `as Envelope` sound, so keep them when touching these casts.
    const msg = event.data as Partial<Envelope>
    if (typeof msg.type !== 'string' || !KNOWN_TYPES.has(msg.type)) return
    if (msg.instanceId !== expectedInstanceId) return
    if (!msg.nonce) return
    // STRADDLE_VERSION_MISMATCH is the version-error signal itself; STRADDLE_HELLO
    // is the app's first contact. Both must survive a version skew.
    const versionExempt =
      msg.type === 'STRADDLE_VERSION_MISMATCH' || msg.type === 'STRADDLE_HELLO'
    if (!versionExempt && msg.version !== PROTOCOL_VERSION) return
    handler(msg as Envelope, event.origin)
  }
}
