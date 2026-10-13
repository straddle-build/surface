// The Bridge surface's init-option vocabulary. Both sides of the iframe import
// it — `<straddle-bridge>` (@straddlecom/straddle-js) to type what it sends in
// STRADDLE_INIT, and the Bridge surface app to type what its onInit receives —
// so a rename here fails both builds instead of drifting silently. Keys are
// snake_case because they travel on the wire as-is.
//
// Types only, plus the one const array the runtime validation needs. Nothing
// here may import a runtime package: the generic runtime layers stay
// surface-agnostic, and this package must stay free of behavior.

export const BRIDGE_OAUTH_MODES = ['popup', 'redirect'] as const

export type BridgeOAuthMode = (typeof BRIDGE_OAUTH_MODES)[number]

/**
 * Surface-defined initialization options forwarded to the Bridge app in
 * STRADDLE_INIT. Keys are snake_case on the wire; the surface app reads them from
 * its `onInit(token, options)` callback.
 */
export type BridgeInitOptions = {
  /** Bank OAuth navigation mode, honored as configured; popup when omitted. */
  oauth_mode?: BridgeOAuthMode
}

// Deliberately no return URL. The merchant's backend supplies it when it
// creates the Bridge session, the issuer binds it into the session token as a
// `redirect_url` claim, and Straddle's server derives the bank's
// return address from that claim — so neither side of the iframe carries it,
// and nothing on the page or in the surface app can substitute another.
