import { expect, test } from 'bun:test'
import { createListener, send } from './message-bus'
import { PROTOCOL_VERSION } from './protocol'
import type { Envelope } from './protocol'

const ORIGIN = 'https://iframe.example'

const validReady = (): Envelope => ({
  type: 'STRADDLE_READY',
  version: PROTOCOL_VERSION,
  instanceId: 'inst-1',
  nonce: 'n1',
  payload: {},
})

test('send stamps version/instanceId/nonce and forwards to the target origin', () => {
  const calls: Array<{ message: unknown; origin: string }> = []
  const target = {
    postMessage: (message: unknown, origin: string) =>
      calls.push({ message, origin }),
  }

  send(target, 'https://parent.example', 'STRADDLE_HEIGHT', 'inst-1', {
    height: 200,
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].origin).toBe('https://parent.example')
  const env = calls[0].message as Envelope
  expect(env.type).toBe('STRADDLE_HEIGHT')
  expect(env.version).toBe(PROTOCOL_VERSION)
  expect(env.instanceId).toBe('inst-1')
  expect(typeof env.nonce).toBe('string')
  expect(env.nonce.length).toBeGreaterThan(0)
  expect(env.payload).toEqual({ height: 200 })
})

test('send stamps a well-formed STRADDLE_HELLO carrying the instanceId', () => {
  const calls: Array<{ message: unknown; origin: string }> = []
  const target = {
    postMessage: (message: unknown, origin: string) =>
      calls.push({ message, origin }),
  }

  send(target, 'https://parent.example', 'STRADDLE_HELLO', 'inst-1', {})

  expect(calls).toHaveLength(1)
  expect(calls[0].origin).toBe('https://parent.example')
  const env = calls[0].message as Envelope
  expect(env.type).toBe('STRADDLE_HELLO')
  expect(env.version).toBe(PROTOCOL_VERSION)
  expect(env.instanceId).toBe('inst-1')
  expect(typeof env.nonce).toBe('string')
  expect(env.nonce.length).toBeGreaterThan(0)
  expect(env.payload).toEqual({})
})

test('createListener forwards a STRADDLE_HELLO whose instanceId matches', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))

  const env: Envelope = {
    type: 'STRADDLE_HELLO',
    version: PROTOCOL_VERSION,
    instanceId: 'inst-1',
    nonce: 'n1',
    payload: {},
  }
  listen({ origin: ORIGIN, data: env })

  expect(received).toHaveLength(1)
  expect(received[0].type).toBe('STRADDLE_HELLO')
})

test('createListener drops a STRADDLE_HELLO for a different instance (no gate exemption)', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))

  const env: Envelope = {
    type: 'STRADDLE_HELLO',
    version: PROTOCOL_VERSION,
    instanceId: 'other',
    nonce: 'n1',
    payload: {},
  }
  listen({ origin: ORIGIN, data: env })

  expect(received).toHaveLength(0)
})

test('send throws on a wildcard or empty targetOrigin', () => {
  const target = { postMessage() {} }
  expect(() => send(target, '*', 'STRADDLE_READY', 'i', {})).toThrow()
  expect(() => send(target, '', 'STRADDLE_READY', 'i', {})).toThrow()
})

test('createListener forwards a well-formed matching message', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))

  const env: Envelope = {
    type: 'STRADDLE_READY',
    version: PROTOCOL_VERSION,
    instanceId: 'inst-1',
    nonce: 'n1',
    payload: {},
  }
  listen({ origin: ORIGIN, data: env })

  expect(received).toHaveLength(1)
  expect(received[0].type).toBe('STRADDLE_READY')
})

test('createListener drops a message from the wrong origin', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))
  listen({ origin: 'https://evil.example', data: validReady() })
  expect(received).toHaveLength(0)
})

test('createListener drops non-object data', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))
  listen({ origin: ORIGIN, data: null })
  listen({ origin: ORIGIN, data: 'nope' })
  expect(received).toHaveLength(0)
})

test('createListener drops an unknown message type', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))
  listen({ origin: ORIGIN, data: { ...validReady(), type: 'NOT_A_TYPE' } })
  expect(received).toHaveLength(0)
})

test('createListener drops a message for a different instance', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))
  listen({ origin: ORIGIN, data: { ...validReady(), instanceId: 'other' } })
  expect(received).toHaveLength(0)
})

test('createListener drops a message with no nonce', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))
  listen({ origin: ORIGIN, data: { ...validReady(), nonce: '' } })
  expect(received).toHaveLength(0)
})

test('createListener drops an ordinary message with a mismatched version', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))
  listen({ origin: ORIGIN, data: { ...validReady(), version: '999' } })
  expect(received).toHaveLength(0)
})

test('STRADDLE_VERSION_MISMATCH passes the version gate despite a mismatched version', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))

  listen({
    origin: ORIGIN,
    data: {
      type: 'STRADDLE_VERSION_MISMATCH',
      version: '999',
      instanceId: 'inst-1',
      nonce: 'n',
      payload: { ourVersion: '999', theirVersion: PROTOCOL_VERSION },
    },
  })

  expect(received).toHaveLength(1)
  expect(received[0].type).toBe('STRADDLE_VERSION_MISMATCH')
})

// STRADDLE_HELLO is the app's first contact in the app-driven handshake, so it
// is exempt from the version gate (like STRADDLE_VERSION_MISMATCH): a HELLO
// stamped with a different protocol version must still reach the parent, or a
// skew could never be detected and reported on either side.
test('createListener forwards a version-mismatched STRADDLE_HELLO so a skew is detectable', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ORIGIN, (e) => received.push(e))

  listen({
    origin: ORIGIN,
    data: {
      type: 'STRADDLE_HELLO',
      version: '999',
      instanceId: 'inst-1',
      nonce: 'n',
      payload: {},
    },
  })

  expect(received).toHaveLength(1)
  expect(received[0].type).toBe('STRADDLE_HELLO')
})

test('createListener accepts any origin in an allowed-origins array', () => {
  const received: Envelope[] = []
  const listen = createListener('inst-1', ['https://a.example', ORIGIN], (e) =>
    received.push(e),
  )
  listen({ origin: ORIGIN, data: validReady() })
  listen({ origin: 'https://a.example', data: validReady() })
  listen({ origin: 'https://evil.example', data: validReady() })
  expect(received).toHaveLength(2)
})

test('createListener passes the event origin to the handler', () => {
  let seenOrigin = ''
  const listen = createListener('inst-1', ORIGIN, (_e, origin) => {
    seenOrigin = origin
  })
  listen({ origin: ORIGIN, data: validReady() })
  expect(seenOrigin).toBe(ORIGIN)
})
