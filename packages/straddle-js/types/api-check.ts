// Compile-time drift guard for the handwritten declaration in index.d.ts: the
// declared public surface and the implementation's must be mutually assignable
// (extra or missing public members fail typecheck in one direction or the
// other). `keyof` only sees public members, so protected declarations
// (instanceId, defaultHeight, iframePath, initOptions, navigateTopLevel,
// resolveToken) are trusted, not verified. The restated Bridge vocabulary is
// checked for exact equality against its source in surface-contracts (via the
// src/index re-exports), so a contract change must be mirrored here.
import type {
  BridgeInitOptions as DeclaredInitOptions,
  BridgeOAuthMode as DeclaredOAuthMode,
  BRIDGE_OAUTH_MODES as DeclaredModes,
  STRADDLE_MODES as DeclaredStraddleModes,
  StraddleMode as DeclaredStraddleMode,
  StraddleBridgeElement as Declared,
  StraddleBridgeEventMap as DeclaredEventMap,
  StraddleCompleteDetail as DeclaredCompleteDetail,
  StraddleErrorCode as DeclaredErrorCode,
  StraddleErrorDetail as DeclaredErrorDetail,
  StraddleExitDetail as DeclaredExitDetail,
  StraddleReadyDetail as DeclaredReadyDetail,
} from './index'
import type {
  BridgeInitOptions as ImplementedInitOptions,
  BridgeOAuthMode as ImplementedOAuthMode,
  BRIDGE_OAUTH_MODES as ImplementedModes,
  STRADDLE_MODES as ImplementedStraddleModes,
  StraddleMode as ImplementedStraddleMode,
  StraddleBridgeElement as Implemented,
  StraddleBridgeEventMap as ImplementedEventMap,
  StraddleCompleteDetail as ImplementedCompleteDetail,
  StraddleErrorCode as ImplementedErrorCode,
  StraddleErrorDetail as ImplementedErrorDetail,
  StraddleExitDetail as ImplementedExitDetail,
  StraddleReadyDetail as ImplementedReadyDetail,
} from '../src/index'

type PublicShape<T> = { [K in keyof T]: T[K] }
type Assert<T extends true> = T
type Covers<A, B> = PublicShape<A> extends PublicShape<B> ? true : false
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

type _ImplementationCoversDeclaration = Assert<Covers<Implemented, Declared>>
type _DeclarationCoversImplementation = Assert<Covers<Declared, Implemented>>
type _OAuthModeMatches = Assert<Equal<ImplementedOAuthMode, DeclaredOAuthMode>>
type _OAuthModesMatch = Assert<
  Equal<typeof ImplementedModes, typeof DeclaredModes>
>
type _InitOptionsMatch = Assert<
  Equal<ImplementedInitOptions, DeclaredInitOptions>
>
type _StraddleModeMatches = Assert<
  Equal<ImplementedStraddleMode, DeclaredStraddleMode>
>
type _StraddleModesMatch = Assert<
  Equal<typeof ImplementedStraddleModes, typeof DeclaredStraddleModes>
>

// Event detail types are aliases of runtime-core's wire payloads in src; the
// declaration spells them out, so a payload change fails here until mirrored.
type _ErrorCodeMatches = Assert<Equal<ImplementedErrorCode, DeclaredErrorCode>>
type _ReadyDetailMatches = Assert<
  Equal<ImplementedReadyDetail, DeclaredReadyDetail>
>
type _CompleteDetailMatches = Assert<
  Equal<ImplementedCompleteDetail, DeclaredCompleteDetail>
>
type _ExitDetailMatches = Assert<
  Equal<ImplementedExitDetail, DeclaredExitDetail>
>
type _ErrorDetailMatches = Assert<
  Equal<ImplementedErrorDetail, DeclaredErrorDetail>
>
type _EventMapMatches = Assert<Equal<ImplementedEventMap, DeclaredEventMap>>

// `Covers` cannot see overload sets (HTMLElement's untyped signature satisfies
// either direction); events.type-test.ts pins the typed listener overloads by
// exercising them at call sites instead.

export {}
