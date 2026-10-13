import { expect, test } from 'bun:test'
import { BRIDGE_OAUTH_MODES } from './bridge'
import type { BridgeInitOptions, BridgeOAuthMode } from './bridge'

type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

// The mode union is derived from the const array, so the two can't drift.
type _ModeUnion = Assert<Equal<BridgeOAuthMode, 'popup' | 'redirect'>>
type _ModeKey = Assert<
  Equal<NonNullable<BridgeInitOptions['oauth_mode']>, BridgeOAuthMode>
>
// Every key is optional: an INIT without options is a valid Bridge init.
type _AllOptional = Assert<Equal<Partial<BridgeInitOptions>, BridgeInitOptions>>
// Options must satisfy the wire type (Record<string, unknown>) so the runtime
// generics can carry them without a cast.
type _WireCompatible = Assert<
  BridgeInitOptions extends Record<string, unknown> ? true : false
>

test('BRIDGE_OAUTH_MODES lists popup and redirect', () => {
  expect(BRIDGE_OAUTH_MODES).toEqual(['popup', 'redirect'])
})
