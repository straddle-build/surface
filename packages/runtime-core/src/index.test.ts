import { expect, test } from 'bun:test'
// Import via the package name (not a relative path) so this exercises the
// package.json "exports" map — the stable public entry point consumers use.
import { PROTOCOL_VERSION } from '@straddlecom/runtime-core'
import type { Envelope } from '@straddlecom/runtime-core'

test('package root barrel re-exports the protocol', () => {
  expect(PROTOCOL_VERSION).toBe('1')

  const ready: Envelope = {
    type: 'STRADDLE_READY',
    version: PROTOCOL_VERSION,
    instanceId: 'x',
    nonce: 'n',
    payload: {},
  }
  expect(ready.type).toBe('STRADDLE_READY')
})

test('package root barrel exposes the message bus', async () => {
  const { send, createListener } = await import('@straddlecom/runtime-core')
  expect(typeof send).toBe('function')
  expect(typeof createListener).toBe('function')
})
