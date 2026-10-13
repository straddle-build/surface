import { expect, test } from 'bun:test'
import { readInitOption } from './read-init-option'

type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

const MODES = ['popup', 'redirect'] as const
type Mode = (typeof MODES)[number]
type Options = { mode?: Mode; url?: string }

test('returns undefined when options are undefined', () => {
  expect(
    readInitOption<Options, 'mode', Mode>(undefined, 'mode', MODES),
  ).toBeUndefined()
})

test('returns undefined when the key is absent', () => {
  expect(
    readInitOption<Options, 'mode', Mode>({}, 'mode', MODES),
  ).toBeUndefined()
  expect(
    readInitOption<Options, 'mode', Mode>({ mode: undefined }, 'mode', MODES),
  ).toBeUndefined()
})

test('returns an allowed value as-is', () => {
  const options: Options = { mode: 'redirect' }
  expect(readInitOption(options, 'mode', MODES)).toBe('redirect')
})

test('throws on a string outside the allowed set, naming key, set and value', () => {
  const options = { mode: 'carrier-pigeon' } as Record<string, unknown>
  expect(() => readInitOption(options, 'mode', MODES)).toThrow(
    'init option "mode" must be one of "popup", "redirect"; got "carrier-pigeon"',
  )
})

test('throws on non-string values instead of coercing', () => {
  const cases: Array<[unknown, string]> = [
    [null, 'null'],
    [1, 'number'],
    [true, 'boolean'],
    [{}, 'an object'],
    [['popup'], 'an array'],
  ]
  for (const [value, described] of cases) {
    expect(() => readInitOption({ mode: value }, 'mode', MODES)).toThrow(
      `got ${described}`,
    )
  }
})

test('works against untyped Record<string, unknown> options', () => {
  const options: Record<string, unknown> = { mode: 'popup' }
  const mode = readInitOption(options, 'mode', MODES)
  expect(mode).toBe('popup')
  type _Narrowed = Assert<Equal<typeof mode, Mode | undefined>>
})

// --- type-level guarantees -------------------------------------------------

declare const typed: Options | undefined
declare const flagged: { on?: boolean } | undefined

// The return type is the allowed union (plus undefined), not string.
type _ReturnIsUnion = Assert<
  Equal<
    ReturnType<typeof readInitOption<Options, 'mode', Mode>>,
    Mode | undefined
  >
>

// Type-only negative cases: wrapped in a function that is never called, so
// the runtime never evaluates the (throwing) calls.
function _rejectsAtCompileTime(): void {
  // A key the options type doesn't declare is rejected.
  // @ts-expect-error 'nope' is not a key of Options
  readInitOption(typed, 'nope', MODES)

  // An allowed list outside the option's declared union is rejected — this is
  // what makes a contract rename fail the surface's build.
  // @ts-expect-error 'popover' is not a Mode
  readInitOption(typed, 'mode', ['popup', 'popover'] as const)

  // The helper is for enum-like string options; a non-string option has no
  // allowed set that can satisfy it.
  // @ts-expect-error boolean options have no string allowed set
  readInitOption(flagged, 'on', ['true'] as const)
}
