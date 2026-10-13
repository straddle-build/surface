// Compile-time assertions for the opt-in React JSX entry. Verified by
// `tsc --noEmit -p tsconfig.react.json`, NOT by `bun test`. This is the only
// program that includes react.d.ts; the main program (tsconfig.json) proves the
// entry is opt-in in events.type-test.ts by never seeing the augmentation.
/// <reference types="@straddlecom/straddle-js/react" />
import type { JSX as ReactJSX } from 'react'
import type { StraddleBridgeAttributes, StraddleBridgeProps } from './react'
import type {
  BridgeOAuthMode,
  StraddleBridgeElement,
  StraddleMode,
} from './index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Expect<T extends true> = T

// Both JSX namespaces React consumers might resolve carry the element.
type _reactJsx = Expect<
  Equal<ReactJSX.IntrinsicElements['straddle-bridge'], StraddleBridgeProps>
>
type _globalJsx = Expect<
  Equal<JSX.IntrinsicElements['straddle-bridge'], StraddleBridgeProps>
>

// The element's own attributes are exactly the documented ones, with `mode`
// the only required one.
type _attributeNames = Expect<
  Equal<keyof StraddleBridgeAttributes, 'mode' | 'token' | 'oauth-mode'>
>
type _required = Expect<
  Equal<
    {
      [K in keyof StraddleBridgeAttributes]-?: {} extends Pick<
        StraddleBridgeAttributes,
        K
      >
        ? never
        : K
    }[keyof StraddleBridgeAttributes],
    'mode'
  >
>
type _mode = Expect<Equal<StraddleBridgeAttributes['mode'], StraddleMode>>
type _oauthMode = Expect<
  Equal<StraddleBridgeAttributes['oauth-mode'], BridgeOAuthMode | undefined>
>

// Real JSX type-checks against the augmentation.
const full = (
  <straddle-bridge
    mode="production"
    token="bridge_token"
    oauth-mode="redirect"
    className="bridge"
    style={{ height: 640 }}
  />
)

const minimal = <straddle-bridge mode="sandbox" />

// @ts-expect-error — mode is required
const missingMode = <straddle-bridge token="bridge_token" />

// @ts-expect-error — only the documented environments are accepted
const badEnvironment = <straddle-bridge mode="prod" />

// @ts-expect-error — only the documented modes are accepted
const badMode = <straddle-bridge mode="sandbox" oauth-mode="tab" />

// Hyphenated JSX attribute names are exempt from excess-property checks, so
// the iframe-origin dev override still compiles without being typed.
const devOverride = (
  <straddle-bridge mode="sandbox" iframe-origin="http://localhost:5173" />
)

// The ref resolves to the element class, so the typed listener overloads are
// reachable from React — the documented way to receive its custom events.
function bindRef(el: StraddleBridgeElement | null): void {
  el?.addEventListener('straddleerror', (e) => {
    const code: string = e.detail.code
    void code
  })
}
const withRef = <straddle-bridge mode="sandbox" ref={bindRef} />

export type _Assertions = [
  _reactJsx,
  _globalJsx,
  _attributeNames,
  _required,
  _mode,
  _oauthMode,
  typeof full,
  typeof minimal,
  typeof missingMode,
  typeof badEnvironment,
  typeof badMode,
  typeof devOverride,
  typeof withRef,
]
