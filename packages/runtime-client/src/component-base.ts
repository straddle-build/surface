import {
  HANDSHAKE_TIMEOUT_MS,
  PROTOCOL_VERSION,
  createListener,
  send,
} from '@straddlecom/runtime-core'
import type { Envelope } from '@straddlecom/runtime-core'
import { mountIframe } from './iframe-lifecycle.js'
import type { IframeHandle } from './iframe-lifecycle.js'

/** Straddle environments an embedding element can connect to. */
export const STRADDLE_MODES = ['sandbox', 'production'] as const

/** `sandbox` while integrating, `production` when live. */
export type StraddleMode = (typeof STRADDLE_MODES)[number]

/**
 * App origin per mode: the public sandbox and production hostnames. Dev
 * builds can reach any other app through the `iframe-origin` override.
 */
export const APP_ORIGINS: Record<StraddleMode, string> = {
  sandbox: 'https://surface-sandbox.straddle.com',
  production: 'https://surface.straddle.com',
}

export type AppOriginResolution = { origin: string } | { error: string }

declare const STRADDLE_IFRAME_ORIGIN_OVERRIDE: boolean | undefined

const isStraddleMode = (value: string): value is StraddleMode =>
  (STRADDLE_MODES as readonly string[]).includes(value)

const MODE_LIST = STRADDLE_MODES.map((m) => `"${m}"`).join(' or ')

/**
 * `override` is the `iframe-origin` development override. It wins over
 * `mode`, but an invalid `mode` is still rejected so a typo is never masked.
 * Published builds define `STRADDLE_IFRAME_ORIGIN_OVERRIDE` as false, so the
 * element never reads the attribute and always passes null here.
 */
export function resolveAppOrigin(
  tagName: string,
  mode: string | null,
  override: string | null,
): AppOriginResolution {
  if (mode !== null && !isStraddleMode(mode)) {
    return { error: `${tagName} "mode" must be ${MODE_LIST}` }
  }
  if (override) return { origin: override }
  if (mode !== null) return { origin: APP_ORIGINS[mode] }
  return { error: `${tagName} requires a "mode" attribute: ${MODE_LIST}` }
}

// Inbound message types that map 1:1 to a bubbling CustomEvent.
const EVENT_MAP: Partial<Record<Envelope['type'], string>> = {
  STRADDLE_READY: 'straddleready',
  STRADDLE_COMPLETE: 'straddlecomplete',
  STRADDLE_EXIT: 'straddleexit',
  STRADDLE_ERROR: 'straddleerror',
}

// How long to wait for the app to become ready before reporting a stuck
// handshake. Sourced from runtime-core's shared HANDSHAKE_TIMEOUT_MS so the
// parent's timeout and the surface's HELLO cap can't drift. Exported so tests
// can reason about the timeout without a real 10s wait.
export const MOUNT_TIMEOUT_MS = HANDSHAKE_TIMEOUT_MS

// Single source of truth for the partner-facing version-mismatch message, so the
// detect-on-HELLO branch and the inbound-VERSION_MISMATCH branch can't drift.
function formatVersionMismatch(
  iframeVersion: string,
  parentVersion: string,
): string {
  return `Protocol version mismatch: iframe speaks "${iframeVersion}", parent speaks "${parentVersion}"`
}

/**
 * Base class for embedding elements. `TOptions` is the shape of the
 * surface-defined `options` this element forwards in STRADDLE_INIT; concrete
 * elements pin it to their surface's contract (e.g. from
 * `@straddlecom/surface-contracts`). The default keeps untyped subclasses
 * compiling unchanged. The app origin comes from the `mode` attribute (or the
 * `iframe-origin` development override); an element that resolves neither
 * dispatches `straddleerror` synchronously while connecting and never mounts.
 */
export abstract class StraddleComponentElement<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> extends HTMLElement {
  protected readonly instanceId: string = crypto.randomUUID()
  private handle: IframeHandle | null = null
  private listener: ((event: MessageEvent) => void) | null = null
  private token = ''
  private ready = false
  private mountTimeout: ReturnType<typeof setTimeout> | null = null
  private versionMismatchReported = false
  private connection = 0
  // Whether the current iframe document has announced itself with HELLO since
  // the last `load` event — lets the load listener tell a booted document from
  // a silently dead one.
  private helloSinceLoad = false

  /**
   * Origin of the app, chosen by the `mode` attribute or the
   * `iframe-origin` development override; '' when neither resolves.
   */
  get iframeOrigin(): string {
    const resolution = this.resolveOrigin()
    return 'origin' in resolution ? resolution.origin : ''
  }

  private resolveOrigin(): AppOriginResolution {
    return resolveAppOrigin(
      this.localName,
      this.getAttribute('mode'),
      typeof STRADDLE_IFRAME_ORIGIN_OVERRIDE === 'undefined' ||
        STRADDLE_IFRAME_ORIGIN_OVERRIDE
        ? this.getAttribute('iframe-origin')
        : null,
    )
  }

  /**
   * Height applied to a host element the partner has not sized. Null (the
   * default) leaves sizing to the surface's STRADDLE_HEIGHT reporting.
   * Surfaces that render a fixed-height frame and never report content
   * height override this so an unsized host doesn't collapse to the
   * browser's default iframe height.
   */
  protected get defaultHeight(): string | null {
    return null
  }

  /**
   * A partner that sizes the element — inline or via stylesheet — always
   * wins; the default applies only when the computed height shows no one
   * sized the host. Must run before the min-height default below inflates
   * the computed height.
   */
  private applyDefaultHeight(): void {
    const defaultHeight = this.defaultHeight
    if (!defaultHeight || this.style.height) return
    const computed = getComputedStyle(this).height
    if (computed === '' || computed === 'auto' || computed === '0px') {
      this.style.height = defaultHeight
    }
  }

  /**
   * Path of the surface's server route on iframeOrigin, joined into the mount
   * URL. Must start with '/'. Each surface is its own server route, so
   * concrete elements pin their surface here (e.g. '/bridge').
   */
  protected get iframePath(): string {
    return '/'
  }

  /**
   * Optional surface-defined values forwarded alongside the token in every
   * STRADDLE_INIT. Subclasses validate their own attributes and return the
   * shape their surface expects; undefined omits the key from the wire.
   */
  protected get initOptions(): TOptions | undefined {
    return undefined
  }

  /**
   * Perform the top-level navigation requested by a validated STRADDLE_REDIRECT.
   * Overridable so tests (and hosts with custom routing) can intercept it.
   */
  protected navigateTopLevel(url: string): void {
    window.location.assign(url)
  }

  /**
   * Resolve the opaque session token forwarded in STRADDLE_INIT. Defaults to the
   * `token` attribute; subclasses may override to acquire it another way.
   */
  protected async resolveToken(): Promise<string> {
    return this.getAttribute('token') ?? ''
  }

  async connectedCallback(): Promise<void> {
    if (this.handle) return // already mounted; ignore re-entry
    const connection = ++this.connection
    // Read through the getter so a subclass that overrides iframeOrigin
    // supplies its origin without the mode attribute.
    if (!this.iframeOrigin) {
      const resolution = this.resolveOrigin()
      this.dispatchEvent(
        new CustomEvent('straddleerror', {
          bubbles: true,
          detail: {
            code: 'INTERNAL',
            message:
              'error' in resolution
                ? resolution.error
                : `${this.localName} has no app origin`,
          },
        }),
      )
      return
    }
    this.style.display = 'block'
    this.applyDefaultHeight()
    if (!this.style.minHeight) this.style.minHeight = '300px'
    let token: string
    try {
      token = await this.resolveToken()
    } catch (err) {
      // resolveToken is an async override point (e.g. fetch from a BFF). If it
      // rejects, mount() never runs and no mount timeout is armed — so without
      // this the partner gets no signal at all.
      this.dispatchEvent(
        new CustomEvent('straddleerror', {
          bubbles: true,
          detail: {
            code: 'INTERNAL',
            message:
              err instanceof Error ? err.message : 'token acquisition failed',
          },
        }),
      )
      return
    }
    // Bail if a later connect or a disconnect superseded this one while awaiting:
    // the element's attributes may no longer resolve to the origin validated above.
    if (connection !== this.connection || this.handle) return
    this.mount(token)
  }

  disconnectedCallback(): void {
    this.connection++
    if (this.listener) {
      window.removeEventListener('message', this.listener)
      this.listener = null
    }
    if (this.mountTimeout !== null) {
      clearTimeout(this.mountTimeout)
      this.mountTimeout = null
    }
    // Re-gate RESIZE until the next READY. An in-place iframe reload re-gates
    // too, via its HELLO (see handleMessage), which re-triggers INIT → READY.
    this.ready = false
    this.helloSinceLoad = false
    this.handle?.destroy()
    this.handle = null
  }

  private mount(token: string): void {
    this.token = token

    // Ordering invariant: token field set → listener registered → iframe
    // appended. A HELLO arriving the instant the app boots then always finds the
    // parent listening with the token in hand.
    this.listener = createListener(
      this.instanceId,
      this.iframeOrigin,
      (envelope) => this.handleMessage(envelope),
    )
    window.addEventListener('message', this.listener)

    this.handle = mountIframe(
      this,
      `${this.iframeOrigin}${this.iframePath}#sid=${this.instanceId}`,
      (width, height) => {
        // Gate RESIZE until the app is ready, so an early ResizeObserver fire
        // can't land before INIT (the app would drop it).
        if (!this.ready) return
        const win = this.handle?.element.contentWindow
        if (win)
          send(win, this.iframeOrigin, 'STRADDLE_RESIZE', this.instanceId, {
            width,
            height,
          })
      },
    )

    // A reloading document that boots far enough announces itself with HELLO
    // (handled in handleMessage), but one that never does — surface server down,
    // app crash before createSurfaceRuntime — is invisible on the wire. The
    // iframe's `load` event is the only parent-side signal for that, so reopen
    // the handshake from a load that arrives with NO HELLO before it. A
    // document's HELLO is sent from synchronous script, so it precedes that
    // document's own `load`; a load with helloSinceLoad set therefore belongs
    // to a document that announced itself, and HELLO handling already reopened
    // (and, if READY won the race against this load, re-closed) the handshake.
    // Re-arming here instead would fire a spurious error into a healthy surface
    // and permanently re-gate RESIZE. This also covers the mount navigation's
    // own load. Known limitation: an app that only HELLOs after its own load
    // event leaves the flag set for the NEXT load, masking one subsequent
    // silent-death reload — a missed error signal on a rare double edge case,
    // never a spurious one. The same masking can also arise from a HELLO
    // *resend* (the surface re-announces every 200ms until INIT): if a resend
    // lands after that document's load was already consumed mid-handshake, it
    // re-sets the flag and the next load is again read as "booted" rather than
    // silent. The listener dies with the iframe element on disconnect.
    this.handle.element.addEventListener('load', () => {
      if (this.helloSinceLoad) {
        this.helloSinceLoad = false
        return
      }
      this.ready = false
      // A silent load can land while the mount timeout is still pending (no
      // READY yet) — don't double-arm.
      if (this.mountTimeout === null) this.armMountTimeout()
    })

    // The single partner-facing signal for a stuck handshake. Cleared on READY
    // and on disconnect.
    this.armMountTimeout()
  }

  private armMountTimeout(): void {
    this.mountTimeout = setTimeout(() => {
      this.mountTimeout = null
      this.dispatchEvent(
        new CustomEvent('straddleerror', {
          bubbles: true,
          detail: {
            code: 'INTERNAL',
            message: 'surface did not become ready',
          },
        }),
      )
    }, MOUNT_TIMEOUT_MS)
  }

  // INIT only ever posts to the iframe's own contentWindow (security invariant —
  // never broadcast). No-ops if the iframe is gone (HELLO after teardown).
  //
  // Known limitation: after an in-place iframe reload the
  // HELLO → INIT re-handshake replays the token resolved at first mount —
  // resolveToken() is not re-invoked. If tokens are single-use or short-TTL,
  // the reloaded surface's init will fail server-side even though the protocol
  // handshake converges. Re-resolving per HELLO would make this path async and
  // needs a decision on token semantics (reusable-within-TTL vs single-use)
  // before the behavior here can be fixed.
  private sendInit(): void {
    const win = this.handle?.element.contentWindow
    if (!win) return
    const options = this.initOptions
    send(win, this.iframeOrigin, 'STRADDLE_INIT', this.instanceId, {
      token: this.token,
      ...(options === undefined ? {} : { options }),
    })
  }

  // A version-mismatched HELLO is the single detection point for protocol skew
  // (HELLO is version-exempt, so it always arrives). Answer every mismatched
  // HELLO with VERSION_MISMATCH (idempotent — the app stops on the first), but
  // surface the partner-facing error only once.
  private reportVersionMismatch(theirVersion: string): void {
    const win = this.handle?.element.contentWindow
    if (win)
      send(
        win,
        this.iframeOrigin,
        'STRADDLE_VERSION_MISMATCH',
        this.instanceId,
        { ourVersion: PROTOCOL_VERSION, theirVersion },
      )
    if (this.versionMismatchReported) return
    this.versionMismatchReported = true
    if (this.mountTimeout !== null) {
      clearTimeout(this.mountTimeout)
      this.mountTimeout = null
    }
    this.dispatchEvent(
      new CustomEvent('straddleerror', {
        bubbles: true,
        detail: {
          code: 'VERSION_MISMATCH',
          message: formatVersionMismatch(theirVersion, PROTOCOL_VERSION),
        },
      }),
    )
  }

  private handleMessage(envelope: Envelope): void {
    if (envelope.type === 'STRADDLE_HELLO') {
      // Mark this document generation as announced — the load listener in
      // mount() uses this to tell a booted document from a silent one.
      this.helloSinceLoad = true
      // A HELLO after READY means the iframe reloaded in place: a new document
      // is starting the handshake over. Reopen it — re-gate RESIZE until the
      // next READY and re-arm the mount timeout so a reload that never
      // converges surfaces straddleerror instead of hanging silently (the
      // surface's HELLO cap relies on this timeout as its backstop).
      if (this.ready) {
        this.ready = false
        this.armMountTimeout()
      }
      // INIT is the ack; answer every HELLO (idempotent for the app).
      this.sendInit()
      // HELLO is version-gate-exempt (runtime-core), so a cross-version HELLO
      // reaches us here — the one place a skew is detected in either direction.
      // Report it precisely instead of letting the mount timeout fire a generic
      // INTERNAL.
      if (envelope.version !== PROTOCOL_VERSION) {
        this.reportVersionMismatch(envelope.version)
      }
      return
    }

    if (envelope.type === 'STRADDLE_READY') {
      if (this.mountTimeout !== null) {
        clearTimeout(this.mountTimeout)
        this.mountTimeout = null
      }
      this.ready = true
      // ResizeObserver only re-fires on an actual size change; a fixed-layout
      // host may never change, so send the current size once now.
      const win = this.handle?.element.contentWindow
      if (win) {
        const { width, height } = this.getBoundingClientRect()
        send(win, this.iframeOrigin, 'STRADDLE_RESIZE', this.instanceId, {
          width,
          height,
        })
      }
      // Fall through to EVENT_MAP so `straddleready` still fires.
    }

    if (envelope.type === 'STRADDLE_HEIGHT') {
      this.style.height = `${envelope.payload.height}px`
      return
    }

    if (envelope.type === 'STRADDLE_REDIRECT') {
      let url: URL
      try {
        url = new URL(envelope.payload.url)
        if (url.protocol !== 'https:') {
          throw new Error('unsupported protocol')
        }
      } catch {
        this.dispatchEvent(
          new CustomEvent('straddleerror', {
            bubbles: true,
            detail: {
              code: 'INTERNAL',
              message: 'surface requested an invalid redirect URL',
            },
          }),
        )
        return
      }
      this.navigateTopLevel(url.toString())
      return
    }

    if (envelope.type === 'STRADDLE_VERSION_MISMATCH') {
      const { ourVersion, theirVersion } = envelope.payload
      this.dispatchEvent(
        new CustomEvent('straddleerror', {
          bubbles: true,
          detail: {
            code: 'VERSION_MISMATCH',
            message: formatVersionMismatch(
              ourVersion,
              theirVersion ?? PROTOCOL_VERSION,
            ),
          },
        }),
      )
      return
    }

    const eventName = EVENT_MAP[envelope.type]
    if (eventName) {
      this.dispatchEvent(
        new CustomEvent(eventName, { bubbles: true, detail: envelope.payload }),
      )
    }
  }
}
