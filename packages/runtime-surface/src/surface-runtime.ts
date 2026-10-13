import {
  HANDSHAKE_TIMEOUT_MS,
  createListener,
  send,
} from '@straddlecom/runtime-core'
import type { StraddleErrorCode } from '@straddlecom/runtime-core'

/** How often the surface re-announces itself with HELLO until INIT acks it. */
const HELLO_RESEND_MS = 200

export interface SurfaceRuntimeConfig<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Parent origins this surface accepts INIT from. Exact-match; never '*'. */
  allowedParentOrigins: string[]
  /**
   * Called once, when a valid INIT arrives, with the token and any
   * surface-defined `options` the parent sent. Resolve → the runtime sends
   * READY. Reject → the runtime sends STRADDLE_ERROR (code INTERNAL).
   *
   * `options` is typed as `TOptions` but arrives from the parent unverified:
   * the type states the contract, not a guarantee. Validate enum-like values
   * with `readInitOption` — its throw becomes the STRADDLE_ERROR.
   */
  onInit: (token: string, options: TOptions | undefined) => void | Promise<void>
  /** Optional: parent container size hint (STRADDLE_RESIZE). */
  onResize?: (size: { width: number; height: number }) => void
  /** Auto-report content height via a ResizeObserver. Default true. */
  autoHeight?: boolean
  /** Element observed for auto-height. Default document.body. */
  heightTarget?: HTMLElement
}

export interface SurfaceRuntime {
  /** Report current content height now (STRADDLE_HEIGHT). */
  reportHeight(): void
  /** Flow finished successfully; `data` is surface-defined. */
  complete(data?: Record<string, unknown>): void
  /** User deliberately left before completing. */
  exit(reason?: string): void
  /** Request a top-level browser navigation from the embedding page. */
  redirect(url: string): void
  /** A failure (not a user choice). */
  error(code: StraddleErrorCode, message: string): void
  /**
   * Tear down: stop HELLO, remove listeners, disconnect the observer.
   * Permanent — unlike a `pagehide`, it is never undone by a back/forward-cache
   * restore.
   */
  destroy(): void
}

export function createSurfaceRuntime<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
>(config: SurfaceRuntimeConfig<TOptions>): SurfaceRuntime {
  const { allowedParentOrigins, onInit, onResize } = config
  const autoHeight = config.autoHeight ?? true
  const heightTarget = config.heightTarget ?? document.body

  const instanceId = new URLSearchParams(window.location.hash.slice(1)).get(
    'sid',
  )
  if (!instanceId) {
    throw new Error(
      'createSurfaceRuntime: missing #sid in the URL — this page is not embedded by the Straddle runtime',
    )
  }
  const sid = instanceId

  let parentOrigin: string | null = null
  let initSeen = false
  let terminated = false
  // A `pagehide` teardown is provisional: the page may only be frozen into the
  // back/forward cache, and `pageshow` then undoes it. An explicit destroy()
  // and a version mismatch are permanent and are never revived.
  let revivable = false
  let helloTimer: ReturnType<typeof setInterval> | null = null
  let capTimer: ReturnType<typeof setTimeout> | null = null

  function reportHeight(): void {
    if (terminated || !parentOrigin) return
    send(window.parent, parentOrigin, 'STRADDLE_HEIGHT', sid, {
      height: Math.ceil(heightTarget.getBoundingClientRect().height),
    })
  }

  function sendHello(): void {
    if (terminated) return
    // postMessage only delivers to a window whose origin matches targetOrigin,
    // so posting to every allowed origin is safe — only the real parent gets
    // it. HELLO precedes INIT, so the exact parent origin isn't known yet.
    for (const origin of allowedParentOrigins) {
      send(window.parent, origin, 'STRADDLE_HELLO', sid, {})
    }
  }

  function stopHello(): void {
    if (helloTimer !== null) {
      clearInterval(helloTimer)
      helloTimer = null
    }
    if (capTimer !== null) {
      clearTimeout(capTimer)
      capTimer = null
    }
  }

  /**
   * Announce now, then keep announcing until INIT acks it or the cap expires.
   * Idempotent — it clears any live timers first, so restarting the loop after
   * a revive can never leave two intervals or two caps running.
   */
  function startHello(): void {
    stopHello()
    sendHello()
    helloTimer = setInterval(sendHello, HELLO_RESEND_MS)
    capTimer = setTimeout(() => {
      capTimer = null
      stopHello() // give up announcing; the parent's mount timeout is the backstop
    }, HANDSHAKE_TIMEOUT_MS)
  }

  const observer =
    autoHeight && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (initSeen) reportHeight()
        })
      : null

  const listener = createListener(
    sid,
    allowedParentOrigins,
    (envelope, origin) => {
      if (terminated) return

      if (envelope.type === 'STRADDLE_INIT') {
        if (initSeen) return // parent acks every HELLO; act on the first only
        initSeen = true
        parentOrigin = origin
        stopHello() // INIT is the ack
        // The wire type is Record<string, unknown>; TOptions is the surface's
        // declared contract for it (see SurfaceRuntimeConfig.onInit).
        Promise.resolve(
          onInit(
            envelope.payload.token,
            envelope.payload.options as TOptions | undefined,
          ),
        ).then(
          () => {
            if (terminated) return
            send(window.parent, origin, 'STRADDLE_READY', sid, {})
            if (autoHeight) reportHeight()
          },
          (err: unknown) => {
            if (terminated) return
            send(window.parent, origin, 'STRADDLE_ERROR', sid, {
              code: 'INTERNAL',
              message:
                err instanceof Error ? err.message : 'surface init failed',
            })
          },
        )
        return
      }

      if (envelope.type === 'STRADDLE_RESIZE') {
        // The parent gates RESIZE until READY, but its gate reopens only on our
        // HELLO after an in-place reload — a resize sent in that window reaches
        // this new document before INIT. Drop it: onResize must not fire before
        // onInit has run.
        if (!initSeen) return
        onResize?.({
          width: envelope.payload.width,
          height: envelope.payload.height,
        })
        return
      }

      if (envelope.type === 'STRADDLE_VERSION_MISMATCH') {
        // The parent detected a protocol-version skew (it sees our HELLO, which is
        // version-exempt). Nothing the surface can do but stop trying.
        terminated = true
        stopHello()
      }
    },
  )

  function onMessage(event: MessageEvent): void {
    listener({ origin: event.origin, data: event.data })
  }

  function teardown(): void {
    terminated = true
    stopHello()
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pagehide', onPageHide)
    observer?.disconnect()
  }

  /**
   * The page is going away — or only says it is. `event.persisted` is true when
   * the browser is merely freezing it into the back/forward cache, which keeps
   * every variable (`terminated` included) exactly as it is: terminating there
   * would make a restored surface look alive but be inert, with both listeners
   * already removed so nothing is left to notice it came back. A genuine unload
   * still tears down exactly as before — but provisionally, because browsers
   * under-report `persisted` here and only `pageshow` reports it reliably.
   */
  function onPageHide(event: PageTransitionEvent): void {
    if (event.persisted || terminated) return
    revivable = true
    teardown()
  }

  /**
   * Restored from the back/forward cache: undo a provisional teardown by
   * re-attaching exactly what teardown() removed. Resume announcing only while
   * INIT is still outstanding — a HELLO after a completed handshake reads to
   * the parent as an in-place reload, so it drops `ready`, re-arms its mount
   * timeout and re-INITs, and this document ignores repeat INITs, leaving the
   * parent waiting for a READY that never comes.
   */
  function onPageShow(event: PageTransitionEvent): void {
    if (!event.persisted || !revivable) return
    revivable = false
    terminated = false
    window.addEventListener('message', onMessage)
    window.addEventListener('pagehide', onPageHide)
    observer?.observe(heightTarget)
    if (!initSeen) startHello()
  }

  function destroy(): void {
    revivable = false // an explicit teardown is permanent; pageshow won't undo it
    teardown()
    window.removeEventListener('pageshow', onPageShow)
  }

  // Ordering: listener installed → HELLO announced. An INIT arriving the instant
  // the parent sees our first HELLO always finds us listening.
  window.addEventListener('message', onMessage)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  observer?.observe(heightTarget)

  startHello()

  return {
    reportHeight,
    complete(data) {
      if (terminated || !parentOrigin) return
      send(window.parent, parentOrigin, 'STRADDLE_COMPLETE', sid, { data })
    },
    exit(reason) {
      if (terminated || !parentOrigin) return
      send(window.parent, parentOrigin, 'STRADDLE_EXIT', sid, { reason })
    },
    redirect(url) {
      if (terminated || !parentOrigin) return
      send(window.parent, parentOrigin, 'STRADDLE_REDIRECT', sid, { url })
    },
    error(code, message) {
      if (terminated || !parentOrigin) return
      send(window.parent, parentOrigin, 'STRADDLE_ERROR', sid, {
        code,
        message,
      })
    },
    destroy,
  }
}
