import { expect, test } from 'bun:test'
import { PROTOCOL_VERSION } from './version'

test('PROTOCOL_VERSION is the v1 string', () => {
  expect(PROTOCOL_VERSION).toBe('1')
})
