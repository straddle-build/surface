/**
 * Read one enum-like init option out of the `options` an INIT carried.
 *
 * - Key absent (or explicitly `undefined`) → `undefined`; the caller applies
 *   its default.
 * - Value is one of `allowed` → that value, typed to the union.
 * - Anything else (a string outside the union, or a non-string) → throws. A
 *   throw inside `onInit` makes the runtime answer with STRADDLE_ERROR, so a
 *   parent that sends a value this surface doesn't understand fails loudly
 *   instead of silently falling back.
 *
 * `allowed` is pinned to the option's declared type, so passing a list that no
 * longer matches the surface's contract fails to compile.
 */
export function readInitOption<
  TOptions extends Record<string, unknown>,
  TKey extends keyof TOptions & string,
  const TValue extends string & NonNullable<TOptions[TKey]>,
>(
  options: TOptions | undefined,
  key: TKey,
  allowed: readonly TValue[],
): TValue | undefined {
  const value = options?.[key]
  if (value === undefined) return undefined
  if (
    typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as TValue
  }
  const expected = allowed.map((v) => JSON.stringify(v)).join(', ')
  throw new Error(
    `init option "${key}" must be one of ${expected}; got ${describe(value)}`,
  )
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (typeof value === 'object')
    return Array.isArray(value) ? 'an array' : 'an object'
  return typeof value
}
