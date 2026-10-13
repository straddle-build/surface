// Opt-in JSX typing for React consumers — NOT referenced from index.d.ts, so
// plain-JS and non-React TypeScript consumers see no JSX augmentation at all.
// Enable it with a triple-slash directive or tsconfig `compilerOptions.types`:
//
//   /// <reference types="@straddlecom/straddle-js/react" />
//
// Requires @types/react (it builds on React.DetailedHTMLProps). Augments both
// `React.JSX` (React 19 — and 18.2+, which also exposes it) and the legacy
// global `JSX` namespace (React ≤18), so <straddle-bridge> type-checks under
// either. Events are not props here: React does not bind listeners for custom
// events, so attach them via a ref with the typed addEventListener overloads
// on StraddleBridgeElement.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type {
  BridgeOAuthMode,
  StraddleBridgeElement,
  StraddleMode,
} from './index.js'

/** The `<straddle-bridge>` attributes, as JSX props (all kebab-case). */
export interface StraddleBridgeAttributes {
  /**
   * Required. Which Straddle environment the element connects to. A missing or invalid value
   * dispatches `straddleerror` (`code: "INTERNAL"`) synchronously on connect and does not mount.
   */
  mode: StraddleMode
  /** The `bridge_token` from `POST /v1/bridge/initialize`. */
  token?: string
  /**
   * Preferred bank OAuth navigation: `popup` (default) or `redirect`. Redirect
   * mode relies on the return URL your backend supplied when it created the
   * session; there is no attribute for it.
   */
  'oauth-mode'?: BridgeOAuthMode
}

/** Full JSX props for `<straddle-bridge>`: standard HTML attributes plus its own. */
export type StraddleBridgeProps = DetailedHTMLProps<
  HTMLAttributes<StraddleBridgeElement>,
  StraddleBridgeElement
> &
  StraddleBridgeAttributes

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'straddle-bridge': StraddleBridgeProps
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'straddle-bridge': StraddleBridgeProps
    }
  }
}
