// Handwritten public declaration for the published package. The implementation
// extends StraddleComponentElement from @straddlecom/runtime-client and takes
// its Bridge vocabulary from @straddlecom/surface-contracts, but both packages
// are bundled (not depended on), so the published types must be
// self-contained — the class hierarchy is flattened to HTMLElement and the
// vocabulary is restated here. api-check.ts asserts both stay in sync with the
// real public surface (the vocabulary is checked against surface-contracts).

/** Straddle environments the element can connect to. */
export declare const STRADDLE_MODES: readonly ['sandbox', 'production']

/**
 * Value of the required `mode` attribute: `sandbox` while integrating, `production` when live.
 * A missing or invalid `mode` dispatches `straddleerror` (`code: "INTERNAL"`) synchronously on connect, and the element does not mount.
 */
export type StraddleMode = (typeof STRADDLE_MODES)[number]

export declare const BRIDGE_OAUTH_MODES: readonly ['popup', 'redirect']

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

/** Stable error vocabulary carried on `straddleerror`. */
export type StraddleErrorCode =
  | 'INVALID_TOKEN'
  | 'ORIGIN_MISMATCH'
  | 'WRONG_SURFACE'
  | 'VERSION_MISMATCH'
  | 'INTERNAL'

/** `event.detail` of `straddleready` — always empty. */
export type StraddleReadyDetail = Record<never, never>

/** `event.detail` of `straddlecomplete`; `data` is defined by the surface. */
export interface StraddleCompleteDetail {
  data?: Record<string, unknown>
}

/** `event.detail` of `straddleexit` — the user left before completing. */
export interface StraddleExitDetail {
  reason?: string
}

/** `event.detail` of `straddleerror` — a failure, not a user choice. */
export interface StraddleErrorDetail {
  code: StraddleErrorCode
  message: string
}

/**
 * Events `<straddle-bridge>` dispatches (all bubbling CustomEvents), keyed by
 * event name. Consumed by the typed addEventListener/removeEventListener
 * overloads on StraddleBridgeElement — deliberately not merged into the
 * global HTMLElementEventMap, so the typing stays scoped to this element.
 */
export interface StraddleBridgeEventMap {
  straddleready: CustomEvent<StraddleReadyDetail>
  straddlecomplete: CustomEvent<StraddleCompleteDetail>
  straddleexit: CustomEvent<StraddleExitDetail>
  straddleerror: CustomEvent<StraddleErrorDetail>
}

export declare class StraddleBridgeElement extends HTMLElement {
  /** Instance id passed to the iframe via `#sid=<id>`; pairs messages to this element. */
  protected readonly instanceId: string

  /** Origin of the Straddle surface app selected by `mode`; '' when `mode` is missing or invalid. */
  get iframeOrigin(): string

  /** Server route of the Bridge surface on iframeOrigin — always '/bridge'. */
  protected get iframePath(): string

  /** OAuth navigation mode from the `oauth-mode` attribute; null when absent or invalid. */
  get oauthMode(): BridgeOAuthMode | null

  /**
   * Options forwarded to the surface in STRADDLE_INIT: the `oauth-mode`
   * attribute, validated and frozen at connect time. An invalid value emits
   * `straddleerror` and prevents mounting.
   */
  protected get initOptions(): BridgeInitOptions | undefined

  /** Performs a validated top-level navigation requested by the surface. */
  protected navigateTopLevel(url: string): void

  /**
   * Height applied to a host element the partner has not sized — '720px' for
   * the Bridge's fixed-height frame. Subclasses may override; null leaves
   * sizing to the surface's STRADDLE_HEIGHT reporting.
   */
  protected get defaultHeight(): string | null

  /**
   * Resolve the opaque session token forwarded in STRADDLE_INIT. Defaults to
   * the `token` attribute; subclasses may override to acquire it another way.
   */
  protected resolveToken(): Promise<string>

  connectedCallback(): Promise<void>
  disconnectedCallback(): void

  // Typed listener overloads: the Straddle event map first, then the inherited
  // HTMLElement events, then the untyped fallback.
  addEventListener<K extends keyof StraddleBridgeEventMap>(
    type: K,
    listener: (
      this: StraddleBridgeElement,
      ev: StraddleBridgeEventMap[K],
    ) => any,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void

  removeEventListener<K extends keyof StraddleBridgeEventMap>(
    type: K,
    listener: (
      this: StraddleBridgeElement,
      ev: StraddleBridgeEventMap[K],
    ) => any,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void
}

declare global {
  interface HTMLElementTagNameMap {
    'straddle-bridge': StraddleBridgeElement
  }
}
