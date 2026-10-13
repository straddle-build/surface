import { StraddleComponentElement } from '@straddlecom/runtime-client'
import { BRIDGE_OAUTH_MODES } from '@straddlecom/surface-contracts/bridge'
import type {
  BridgeInitOptions,
  BridgeOAuthMode,
} from '@straddlecom/surface-contracts/bridge'
import type {
  CompletePayload,
  ErrorPayload,
  ExitPayload,
  ReadyPayload,
  StraddleErrorCode,
} from '@straddlecom/runtime-core'
import { version } from '../package.json'

export type { StraddleErrorCode }

/** `event.detail` of `straddleready` — always empty. */
export type StraddleReadyDetail = ReadyPayload

/** `event.detail` of `straddlecomplete`; `data` is defined by the surface. */
export type StraddleCompleteDetail = CompletePayload

/** `event.detail` of `straddleexit` — the user left before completing. */
export type StraddleExitDetail = ExitPayload

/** `event.detail` of `straddleerror` — a failure, not a user choice. */
export type StraddleErrorDetail = ErrorPayload

/**
 * Events `<straddle-bridge>` dispatches (all bubbling CustomEvents), keyed by
 * event name. Consumed by the typed addEventListener/removeEventListener
 * overloads on StraddleBridgeElement — deliberately not merged into the
 * global HTMLElementEventMap, so the typing stays scoped to this element.
 *
 * Nothing here is Bridge-specific: the base class re-dispatches these same
 * four events for every surface, so this map and the detail aliases above
 * would sit more naturally on StraddleComponentElement in runtime-client.
 * They live here for now because that move is not contained — it changes a
 * published runtime package's API, and every element package would need the
 * same treatment in its own handwritten declaration or its published types
 * would be worse than its implementation. It would also not shorten this package's shipped
 * `.d.ts`, which must spell these out regardless (runtime-client is bundled,
 * not depended on). Tracked as a follow-up rather than done here.
 */
export interface StraddleBridgeEventMap {
  straddleready: CustomEvent<StraddleReadyDetail>
  straddlecomplete: CustomEvent<StraddleCompleteDetail>
  straddleexit: CustomEvent<StraddleExitDetail>
  straddleerror: CustomEvent<StraddleErrorDetail>
}

const isOAuthMode = (value: string | null): value is BridgeOAuthMode =>
  (BRIDGE_OAUTH_MODES as readonly string[]).includes(value ?? '')

// Pinned to the Bridge contract: `initOptions` must return exactly the shape
// the Bridge surface app's onInit expects, so a vocabulary change in
// surface-contracts fails this build rather than drifting on the wire.
export class StraddleBridgeElement extends StraddleComponentElement<BridgeInitOptions> {
  static readonly version = version

  // Options are read and validated once in connectedCallback and frozen here,
  // so every HELLO → INIT ack carries the same validated values even if the
  // attributes are mutated after connect.
  #initOptions: BridgeInitOptions | undefined

  // Bridge is served at a fixed server route on the surface origin. The path is
  // part of the product contract between this element and the surface app, not
  // partner configuration.
  protected get iframePath(): string {
    return '/bridge'
  }

  /** OAuth navigation mode from the `oauth-mode` attribute; null when absent or invalid. */
  get oauthMode(): BridgeOAuthMode | null {
    const oauthMode = this.getAttribute('oauth-mode')
    return isOAuthMode(oauthMode) ? oauthMode : null
  }

  protected get initOptions(): BridgeInitOptions | undefined {
    return this.#initOptions
  }

  // Bridge renders a fixed-height frame and never reports content height, so
  // an unsized host needs a default matching the design's frame.
  protected get defaultHeight(): string | null {
    return '720px'
  }

  async connectedCallback(): Promise<void> {
    const options: BridgeInitOptions = {}

    const oauthMode = this.getAttribute('oauth-mode')
    if (oauthMode !== null) {
      if (!isOAuthMode(oauthMode)) {
        this.#fail(
          `straddle-bridge "oauth-mode" must be ${BRIDGE_OAUTH_MODES.map((m) => `"${m}"`).join(' or ')}`,
        )
        return
      }
      options.oauth_mode = oauthMode
    }

    this.#initOptions = Object.keys(options).length > 0 ? options : undefined
    return super.connectedCallback()
  }

  #fail(message: string): void {
    const detail: StraddleErrorDetail = { code: 'INTERNAL', message }
    this.dispatchEvent(
      new CustomEvent('straddleerror', { bubbles: true, detail }),
    )
  }

  // Typed listener overloads: the Straddle event map first, then the inherited
  // HTMLElement events, then the untyped fallback. The bodies only forward to
  // HTMLElement — the override exists so the overloads can live on the class.
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
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options)
  }

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
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options)
  }
}

// Guarded so a page can load both published artifacts (the <script>-tag IIFE
// and the ESM entry) without the second registration throwing.
const registered = customElements.get('straddle-bridge') as
  | { version?: string }
  | undefined
if (!registered) {
  customElements.define('straddle-bridge', StraddleBridgeElement)
} else if (registered.version !== version) {
  console.warn(
    `<straddle-bridge> is already registered by straddle-js ${registered.version}, so straddle-js ${version} did not register it. Load one copy of straddle-js per page.`,
  )
}
