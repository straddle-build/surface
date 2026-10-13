import { afterEach, beforeEach, expect, test } from 'bun:test'
import { PROTOCOL_VERSION } from '@straddlecom/runtime-core'
import type { Envelope } from '@straddlecom/runtime-core'
import {
  APP_ORIGINS,
  MOUNT_TIMEOUT_MS,
  StraddleComponentElement,
  resolveAppOrigin,
} from './component-base'
import type { AppOriginResolution } from './component-base'

const IFRAME_ORIGIN = 'https://iframe.example'

class TestElement extends StraddleComponentElement {
  readonly navigations: string[] = []

  protected get initOptions() {
    return { test_option: 'value' }
  }
  // expose the protected instanceId for assertions
  getInstanceId() {
    return this.instanceId
  }
  protected navigateTopLevel(url: string) {
    this.navigations.push(url)
  }
}

// One macrotask tick suffices only because the default resolveToken is synchronous.
const tick = () => new Promise((r) => realSetTimeout(r, 0))

// Capture mount timeouts so tests can fire them deterministically instead of
// waiting MOUNT_TIMEOUT_MS in real time (Bun 1.2.x lacks setTimeout fake-timer
// advancement). We intercept only the mount timeout (matched by its delay) and
// pass every other setTimeout through to the real implementation. Each
// intercepted timeout gets its own fake handle and lives in a Map, rather than
// a single shared slot: a single slot would let a second, concurrently-armed
// mount timeout silently overwrite the first (and `clearTimeout` would clear
// whichever one happened to be captured), hiding a regression where
// component-base.ts's "already armed" guard (`if (this.mountTimeout === null)`)
// is removed and a timer is orphaned instead of replaced.
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
let nextMountTimeoutHandle = -1
let pendingMountTimeouts = new Map<ReturnType<typeof setTimeout>, () => void>()

beforeEach(() => {
  nextMountTimeoutHandle = -1
  pendingMountTimeouts = new Map()
  globalThis.setTimeout = ((
    fn: (...args: unknown[]) => void,
    delay?: number,
  ) => {
    if (delay === MOUNT_TIMEOUT_MS) {
      const handle = nextMountTimeoutHandle-- as unknown as ReturnType<
        typeof setTimeout
      >
      pendingMountTimeouts.set(handle, fn as () => void)
      return handle
    }
    return realSetTimeout(fn, delay)
  }) as typeof setTimeout
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle !== undefined && pendingMountTimeouts.has(handle)) {
      pendingMountTimeouts.delete(handle)
      return
    }
    return realClearTimeout(handle)
  }) as typeof clearTimeout
})

afterEach(() => {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
})

// Fire every pending mount timeout (simulates MOUNT_TIMEOUT_MS elapsing for
// all of them at once). Snapshot-then-clear so a callback that re-arms a new
// mount timeout during this call doesn't have its fresh entry wiped out.
function advancePastMountTimeout() {
  const callbacks = Array.from(pendingMountTimeouts.values())
  pendingMountTimeouts.clear()
  for (const fn of callbacks) fn()
}

let defined = false
beforeEach(() => {
  if (!defined) {
    customElements.define('straddle-test', TestElement)
    defined = true
  }
  document.body.innerHTML = ''
})

async function mount(token = 'tok-123') {
  const el = new TestElement()
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  el.setAttribute('token', token)
  document.body.appendChild(el)
  await tick() // let async connectedCallback resolveToken + mount
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  const sent: Array<{ message: unknown; origin: string }> = []
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (message: unknown, origin: string) =>
        sent.push({ message, origin }),
    },
  })
  return { el, iframe, sent, id: el.getInstanceId() }
}

// Build + deliver an inbound message, forcing event.origin (happy-dom may not
// populate it from the MessageEvent init).
function deliver(envelope: unknown, origin = IFRAME_ORIGIN) {
  const ev = new MessageEvent('message', { data: envelope })
  Object.defineProperty(ev, 'origin', { value: origin })
  window.dispatchEvent(ev)
}

function envelope(
  type: Envelope['type'],
  id: string,
  payload: unknown,
  version = PROTOCOL_VERSION,
) {
  return { type, version, instanceId: id, nonce: 'n-test', payload }
}

test('mounts the iframe with #sid=<instanceId> in its src', async () => {
  const { iframe, id } = await mount()
  expect(iframe.src).toContain(`#sid=${id}`)
})

test('a subclass can point the mount URL at a surface path', async () => {
  class PathElement extends StraddleComponentElement {
    protected get iframePath() {
      return '/bridge'
    }
  }
  if (!customElements.get('straddle-test-path')) {
    customElements.define('straddle-test-path', PathElement)
  }
  const el = new PathElement()
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  el.setAttribute('token', 'tok-path')
  document.body.appendChild(el)
  await tick()
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  expect(iframe.src).toContain(`${IFRAME_ORIGIN}/bridge#sid=`)
})

function connectWith(attributes: Record<string, string>) {
  const el = new TestElement()
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value)
  }
  const errors: Array<{ code?: string; message?: string }> = []
  el.addEventListener('straddleerror', (event) => {
    errors.push((event as CustomEvent).detail)
  })
  document.body.appendChild(el)
  return { el, errors }
}

test('mode="sandbox" mounts at the sandbox app origin', async () => {
  const { el, errors } = connectWith({ mode: 'sandbox', token: 'tok-1' })
  await tick()
  expect(errors).toEqual([])
  expect(el.iframeOrigin).toBe(APP_ORIGINS.sandbox)
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  expect(iframe.src).toContain(`${APP_ORIGINS.sandbox}/#sid=`)
})

test('a missing mode errors synchronously while connecting and does not mount', async () => {
  const { el, errors } = connectWith({ token: 'tok-1' })
  expect(errors).toEqual([
    {
      code: 'INTERNAL',
      message:
        'straddle-test requires a "mode" attribute: "sandbox" or "production"',
    },
  ])
  await tick()
  expect(el.querySelector('iframe')).toBeNull()
  expect(el.iframeOrigin).toBe('')
})

test('an unknown mode errors and does not mount', async () => {
  const { el, errors } = connectWith({ mode: 'bogus', token: 'tok-1' })
  expect(errors).toEqual([
    {
      code: 'INTERNAL',
      message: 'straddle-test "mode" must be "sandbox" or "production"',
    },
  ])
  await tick()
  expect(el.querySelector('iframe')).toBeNull()
})

test('iframe-origin overrides mode', async () => {
  const { el, errors } = connectWith({
    mode: 'production',
    'iframe-origin': IFRAME_ORIGIN,
    token: 'tok-1',
  })
  await tick()
  expect(errors).toEqual([])
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  expect(iframe.src).toContain(`${IFRAME_ORIGIN}/#sid=`)
})

test('a mode-resolved element completes the handshake without forwarding mode', async () => {
  const { el } = connectWith({ mode: 'sandbox', token: 'tok-1' })
  await tick()
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  const sent: Array<{ message: Envelope; origin: string }> = []
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (message: Envelope, origin: string) =>
        sent.push({ message, origin }),
    },
  })
  let ready = false
  el.addEventListener('straddleready', () => {
    ready = true
  })
  const id = el.getInstanceId()

  deliver(envelope('STRADDLE_HELLO', id, {}), APP_ORIGINS.sandbox)
  deliver(envelope('STRADDLE_READY', id, {}), APP_ORIGINS.sandbox)

  const init = sent.find((m) => m.message.type === 'STRADDLE_INIT')!
  expect(init.origin).toBe(APP_ORIGINS.sandbox)
  expect(init.message.payload).toEqual({
    token: 'tok-1',
    options: { test_option: 'value' },
  })
  expect(ready).toBe(true)
})

test('a subclass that overrides iframeOrigin mounts without mode', async () => {
  class FixedOriginElement extends StraddleComponentElement {
    get iframeOrigin() {
      return IFRAME_ORIGIN
    }
  }
  if (!customElements.get('straddle-test-fixed')) {
    customElements.define('straddle-test-fixed', FixedOriginElement)
  }
  const el = new FixedOriginElement()
  const errors: unknown[] = []
  el.addEventListener('straddleerror', (event) => {
    errors.push((event as CustomEvent).detail)
  })
  document.body.appendChild(el)
  await tick()
  expect(errors).toEqual([])
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  expect(iframe.src).toContain(`${IFRAME_ORIGIN}/#sid=`)
})

test('a subclass whose iframeOrigin override is empty errors and does not mount', async () => {
  class EmptyOriginElement extends StraddleComponentElement {
    get iframeOrigin() {
      return ''
    }
  }
  if (!customElements.get('straddle-test-empty')) {
    customElements.define('straddle-test-empty', EmptyOriginElement)
  }
  const el = new EmptyOriginElement()
  el.setAttribute('mode', 'sandbox')
  const errors: unknown[] = []
  el.addEventListener('straddleerror', (event) => {
    errors.push((event as CustomEvent).detail)
  })
  document.body.appendChild(el)
  expect(errors).toEqual([
    { code: 'INTERNAL', message: 'straddle-test-empty has no app origin' },
  ])
  await tick()
  expect(el.querySelector('iframe')).toBeNull()
})

class DeferredTokenElement extends StraddleComponentElement {
  static release: () => void = () => {}
  protected resolveToken(): Promise<string> {
    return new Promise((resolve) => {
      const previous = DeferredTokenElement.release
      DeferredTokenElement.release = () => {
        previous()
        resolve('tok-deferred')
      }
    })
  }
}

function connectDeferred(mode: string) {
  if (!customElements.get('straddle-test-deferred')) {
    customElements.define('straddle-test-deferred', DeferredTokenElement)
  }
  DeferredTokenElement.release = () => {}
  const el = new DeferredTokenElement()
  el.setAttribute('mode', mode)
  const errors: unknown[] = []
  el.addEventListener('straddleerror', (event) => {
    errors.push((event as CustomEvent).detail)
  })
  document.body.appendChild(el)
  return { el, errors }
}

test('a connection abandoned while its token resolves does not mount after an invalid reconnect', async () => {
  const { el, errors } = connectDeferred('sandbox')
  el.remove()
  el.setAttribute('mode', 'bogus')
  document.body.appendChild(el)
  expect(errors).toHaveLength(1)

  DeferredTokenElement.release()
  await tick()

  expect(el.querySelector('iframe')).toBeNull()
})

test('a reconnect while the token resolves mounts exactly one iframe', async () => {
  const { el, errors } = connectDeferred('sandbox')
  el.remove()
  document.body.appendChild(el)

  DeferredTokenElement.release()
  await tick()

  expect(errors).toEqual([])
  expect(el.querySelectorAll('iframe')).toHaveLength(1)
})

test('STRADDLE_HELLO triggers INIT without a load event', async () => {
  const { sent, id } = await mount('tok-123')
  deliver(envelope('STRADDLE_HELLO', id, {}))

  const inits = sent.filter(
    (m) => (m.message as Envelope).type === 'STRADDLE_INIT',
  )
  expect(inits).toHaveLength(1)
  expect(inits[0].origin).toBe(IFRAME_ORIGIN)
  const env = inits[0].message as Envelope
  expect(env.instanceId).toBe(id)
  expect((env.payload as { token: string }).token).toBe('tok-123')
  expect(
    (env.payload as { options?: Record<string, unknown> }).options,
  ).toEqual({ test_option: 'value' })
})

test('STRADDLE_INIT omits the options key when initOptions is undefined', async () => {
  class BareElement extends StraddleComponentElement {}
  if (!customElements.get('test-bare-element')) {
    customElements.define('test-bare-element', BareElement)
  }
  const el = document.createElement('test-bare-element') as BareElement
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  el.setAttribute('token', 'tok-bare')
  document.body.appendChild(el)
  await tick()
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  const id = new URL(iframe.src).hash.replace('#sid=', '')
  const sent: unknown[] = []
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: { postMessage: (message: unknown) => sent.push(message) },
  })
  deliver(envelope('STRADDLE_HELLO', id, {}))
  const inits = sent.filter((m) => (m as Envelope).type === 'STRADDLE_INIT')
  expect(inits).toHaveLength(1)
  expect((inits[0] as Envelope).payload).toEqual({ token: 'tok-bare' })
})

test('two HELLOs each elicit an INIT (idempotent ack)', async () => {
  const { sent, id } = await mount()
  deliver(envelope('STRADDLE_HELLO', id, {}))
  deliver(envelope('STRADDLE_HELLO', id, {}))

  const inits = sent.filter(
    (m) => (m.message as Envelope).type === 'STRADDLE_INIT',
  )
  expect(inits).toHaveLength(2)
})

test('a dropped first INIT is recovered by the next HELLO', async () => {
  // The app models a lost INIT by simply sending HELLO again; the parent answers
  // each one, so INIT count tracks HELLO count and the exchange converges.
  const { sent, id } = await mount()
  deliver(envelope('STRADDLE_HELLO', id, {})) // INIT #1 (modelled as lost)
  deliver(envelope('STRADDLE_HELLO', id, {})) // INIT #2

  const inits = sent.filter(
    (m) => (m.message as Envelope).type === 'STRADDLE_INIT',
  )
  expect(inits).toHaveLength(2)
})

test('applies STRADDLE_HEIGHT to the host element', async () => {
  const { el, id } = await mount()
  deliver(envelope('STRADDLE_HEIGHT', id, { height: 480 }))
  expect(el.style.height).toBe('480px')
})

test('STRADDLE_REDIRECT navigates the top-level page', async () => {
  const { el, id } = await mount()
  deliver(
    envelope('STRADDLE_REDIRECT', id, {
      url: 'https://redirect.example/continue',
    }),
  )
  expect(el.navigations).toEqual(['https://redirect.example/continue'])
})

for (const url of ['http://redirect.example/continue', 'javascript:alert(1)']) {
  test(`STRADDLE_REDIRECT rejects ${new URL(url).protocol} URLs`, async () => {
    const { el, id } = await mount()
    let detail: { code?: string; message?: string } | null = null
    el.addEventListener('straddleerror', (event) => {
      detail = (event as CustomEvent).detail
    })
    deliver(envelope('STRADDLE_REDIRECT', id, { url }))
    expect(el.navigations).toEqual([])
    expect(detail).not.toBeNull()
    expect(detail!.code).toBe('INTERNAL')
    expect(detail!.message).toBe('surface requested an invalid redirect URL')
  })
}

test('a navigation failure on a valid STRADDLE_REDIRECT URL is not reported as an invalid URL', async () => {
  class ThrowingNavigationElement extends TestElement {
    protected navigateTopLevel(url: string) {
      super.navigateTopLevel(url)
      throw new Error('router busy')
    }
  }
  customElements.define(
    'straddle-throwing-navigation',
    ThrowingNavigationElement,
  )
  const el = new ThrowingNavigationElement()
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  el.setAttribute('token', 'tok-123')
  document.body.appendChild(el)
  await tick()
  const errors: unknown[] = []
  el.addEventListener('straddleerror', (event) => {
    errors.push((event as CustomEvent).detail)
  })
  const unhandled: unknown[] = []
  const onError = (event: Event) => {
    event.preventDefault()
    unhandled.push(event)
  }
  window.addEventListener('error', onError)
  try {
    deliver(
      envelope('STRADDLE_REDIRECT', el.getInstanceId(), {
        url: 'https://redirect.example/continue',
      }),
    )
  } catch (error) {
    unhandled.push(error)
  } finally {
    window.removeEventListener('error', onError)
  }
  expect(el.navigations).toEqual(['https://redirect.example/continue'])
  expect(errors).toEqual([])
  expect(unhandled).toHaveLength(1)
})

test('maps READY/COMPLETE/EXIT/ERROR to straddle* events', async () => {
  const { el, id } = await mount()
  const seen: string[] = []
  for (const name of [
    'straddleready',
    'straddlecomplete',
    'straddleexit',
    'straddleerror',
  ]) {
    el.addEventListener(name, () => seen.push(name))
  }

  deliver(envelope('STRADDLE_READY', id, {}))
  deliver(envelope('STRADDLE_COMPLETE', id, { data: { ref: 'x' } }))
  deliver(envelope('STRADDLE_EXIT', id, { reason: 'closed' }))
  deliver(envelope('STRADDLE_ERROR', id, { code: 'INTERNAL', message: 'boom' }))

  expect(seen).toEqual([
    'straddleready',
    'straddlecomplete',
    'straddleexit',
    'straddleerror',
  ])
})

test('VERSION_MISMATCH surfaces a straddleerror with code VERSION_MISMATCH', async () => {
  const { el, id } = await mount()
  let detail: { code?: string } | null = null
  el.addEventListener('straddleerror', (e) => {
    detail = (e as CustomEvent).detail
  })

  // mismatched wire version is allowed through for this signal
  deliver(
    envelope(
      'STRADDLE_VERSION_MISMATCH',
      id,
      { ourVersion: '999', theirVersion: PROTOCOL_VERSION },
      '999',
    ),
  )

  expect(detail).not.toBeNull()
  expect(detail!.code).toBe('VERSION_MISMATCH')
})

test('drops messages from a foreign origin', async () => {
  const { el, id } = await mount()
  let fired = false
  el.addEventListener('straddleready', () => {
    fired = true
  })
  deliver(envelope('STRADDLE_READY', id, {}), 'https://evil.example')
  expect(fired).toBe(false)
})

test('drops messages for a different instanceId', async () => {
  const { el } = await mount()
  let fired = false
  el.addEventListener('straddleready', () => {
    fired = true
  })
  deliver(envelope('STRADDLE_READY', 'wrong-id', {}))
  expect(fired).toBe(false)
})

// Multiple surfaces: the platform site may host several on one page. Each
// component gates on its own instanceId (delivered to its iframe via #sid), so
// two elements — even of the same origin — must not cross-talk.
test('two same-origin elements on one page stay isolated', async () => {
  const a = await mount('tok-A')
  const b = await mount('tok-B')
  expect(a.id).not.toBe(b.id)
  const types = (s: Array<{ message: unknown; origin: string }>) =>
    s.map((m) => (m.message as Envelope).type)

  // A's HELLO elicits INIT from A only, carrying A's token.
  deliver(envelope('STRADDLE_HELLO', a.id, {}))
  expect(types(a.sent)).toEqual(['STRADDLE_INIT'])
  expect(
    ((a.sent[0].message as Envelope).payload as { token: string }).token,
  ).toBe('tok-A')
  expect(b.sent).toHaveLength(0)

  // B's READY fires straddleready on B only; B's catch-up RESIZE goes to B only.
  const readyOn: string[] = []
  a.el.addEventListener('straddleready', () => readyOn.push('A'))
  b.el.addEventListener('straddleready', () => readyOn.push('B'))
  deliver(envelope('STRADDLE_READY', b.id, {}))
  expect(readyOn).toEqual(['B'])
  expect(types(a.sent)).toEqual(['STRADDLE_INIT']) // unchanged
  expect(types(b.sent)).toEqual(['STRADDLE_RESIZE'])

  // HEIGHT for A resizes A's host element only.
  deliver(envelope('STRADDLE_HEIGHT', a.id, { height: 480 }))
  expect(a.el.style.height).toBe('480px')
  expect(b.el.style.height).toBe('')
})

test('disconnectedCallback removes the iframe and stops listening', async () => {
  const { el, id } = await mount()
  el.remove()
  let fired = false
  el.addEventListener('straddleready', () => {
    fired = true
  })
  deliver(envelope('STRADDLE_READY', id, {}))
  expect(fired).toBe(false)
  expect(el.querySelector('iframe')).toBeNull()
})

class MockResizeObserver {
  static last: MockResizeObserver | null = null
  callback: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    MockResizeObserver.last = this
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  emit(width: number, height: number, target: Element) {
    this.callback(
      [
        {
          contentRect: { width, height } as DOMRectReadOnly,
          target,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    )
  }
}

const resizes = (sent: Array<{ message: unknown; origin: string }>) =>
  sent.filter((m) => (m.message as Envelope).type === 'STRADDLE_RESIZE')

test('gates STRADDLE_RESIZE until READY, then forwards resizes', async () => {
  const originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
  try {
    const { el, sent, id } = await mount()

    // Resize before READY is dropped — the surface may not be listening yet.
    MockResizeObserver.last!.emit(320, 240, el)
    expect(resizes(sent)).toHaveLength(0)

    // READY sends exactly one RESIZE with the host's current size.
    deliver(envelope('STRADDLE_READY', id, {}))
    expect(resizes(sent)).toHaveLength(1)
    expect(resizes(sent)[0].origin).toBe(IFRAME_ORIGIN)

    // A later resize is now forwarded.
    MockResizeObserver.last!.emit(400, 300, el)
    expect(resizes(sent)).toHaveLength(2)
    expect((resizes(sent)[1].message as Envelope).payload).toEqual({
      width: 400,
      height: 300,
    })
  } finally {
    globalThis.ResizeObserver = originalRO
  }
})

test('mount timeout fires straddleerror{INTERNAL} when no READY arrives', async () => {
  const { el } = await mount()
  let detail: { code?: string; message?: string } | null = null
  el.addEventListener('straddleerror', (e) => {
    detail = (e as CustomEvent).detail
  })

  advancePastMountTimeout()

  expect(detail).not.toBeNull()
  expect(detail!.code).toBe('INTERNAL')
  expect(detail!.message).toBe('surface did not become ready')
})

test('READY before the mount timeout suppresses the error', async () => {
  const { el, id } = await mount()
  let errored = false
  el.addEventListener('straddleerror', () => {
    errored = true
  })

  deliver(envelope('STRADDLE_READY', id, {}))
  advancePastMountTimeout() // timeout was cleared on READY; nothing scheduled

  expect(errored).toBe(false)
})

test('disconnect before the mount timeout suppresses the error', async () => {
  const { el } = await mount()
  let errored = false
  el.addEventListener('straddleerror', () => {
    errored = true
  })

  el.remove()
  advancePastMountTimeout() // timeout was cleared on disconnect

  expect(errored).toBe(false)
})

// HELLO is version-gate-exempt (runtime-core), so a HELLO from an app speaking
// a different protocol version still reaches the parent and is answered with
// INIT — the handshake stays alive long enough for the skew to be reported.
test('a version-mismatched HELLO still elicits an INIT', async () => {
  const { sent, id } = await mount('tok-123')

  // App on a newer protocol version announces itself.
  deliver(envelope('STRADDLE_HELLO', id, {}, '999'))

  const inits = sent.filter(
    (m) => (m.message as Envelope).type === 'STRADDLE_INIT',
  )
  expect(inits).toHaveLength(1)
})

// A version-mismatched HELLO is the parent's single skew-detection point: it
// clears the mount timeout and reports a precise VERSION_MISMATCH instead of
// letting the generic INTERNAL timeout fire.
test('a cross-version handshake surfaces VERSION_MISMATCH, not a generic INTERNAL timeout', async () => {
  const { el, id } = await mount()
  let detail: { code?: string } | null = null
  el.addEventListener('straddleerror', (e) => {
    detail = (e as CustomEvent).detail
  })

  deliver(envelope('STRADDLE_HELLO', id, {}, '999'))
  advancePastMountTimeout()

  expect(detail).not.toBeNull()
  expect(detail!.code).toBe('VERSION_MISMATCH')
})

// An in-place iframe reload (user right-clicks → "Reload frame", or the surface
// app calls location.reload()) restarts the handshake: the new document sends
// HELLO again. That post-READY HELLO must re-arm the mount timeout — otherwise
// a reload that HELLOs but never becomes READY (onInit hangs, READY lost in
// transit) hangs with zero partner-facing signal, while the same failure on
// first load fires straddleerror. The surface's HELLO cap even comments that
// "the parent's mount timeout is the backstop" — this keeps that true.
// A reload whose document never boots far enough to HELLO is covered by the
// iframe `load` listener instead — see the tests below.
test('a HELLO after READY re-arms the mount timeout (iframe reload backstop)', async () => {
  const { el, id } = await mount()
  deliver(envelope('STRADDLE_HELLO', id, {}))
  deliver(envelope('STRADDLE_READY', id, {})) // first handshake completes

  let detail: { code?: string; message?: string } | null = null
  el.addEventListener('straddleerror', (e) => {
    detail = (e as CustomEvent).detail
  })

  // The reloaded iframe announces itself but never becomes READY.
  deliver(envelope('STRADDLE_HELLO', id, {}))
  advancePastMountTimeout()

  expect(detail).not.toBeNull()
  expect(detail!.code).toBe('INTERNAL')
  expect(detail!.message).toBe('surface did not become ready')
})

// A reload whose document never boots far enough to HELLO (surface server down,
// app crash before createSurfaceRuntime, #sid lost to hash routing) is
// invisible on the wire — the only parent-side signal is the iframe firing a
// SECOND `load` event. That too must reopen the handshake and re-arm the mount
// timeout; otherwise the element hangs with no partner-facing error.
test('a second iframe load with no HELLO re-arms the mount timeout', async () => {
  const { el, iframe, id } = await mount()
  // Same-document ordering: HELLO comes from synchronous script, which runs
  // before that document's own `load` event.
  deliver(envelope('STRADDLE_HELLO', id, {}))
  deliver(envelope('STRADDLE_READY', id, {}))
  iframe.dispatchEvent(new Event('load')) // the mount navigation's own load

  let detail: { code?: string; message?: string } | null = null
  el.addEventListener('straddleerror', (e) => {
    detail = (e as CustomEvent).detail
  })

  iframe.dispatchEvent(new Event('load')) // reloaded document; never HELLOs
  advancePastMountTimeout()

  expect(detail).not.toBeNull()
  expect(detail!.code).toBe('INTERNAL')
  expect(detail!.message).toBe('surface did not become ready')
})

// A document that crashes before ever sending HELLO has its own mount-navigation
// `load` land while the mount timeout armed at the end of mount() is still
// pending — the "already armed" guard must leave that timer alone instead of
// stacking a second one alongside it. Only the Map-backed harness above (rather
// than a single shared slot) can see the orphaned first timer still fire.
test('a mount-navigation load with no HELLO ever does not double-arm the mount timeout', async () => {
  const { el, iframe } = await mount()
  let errorCount = 0
  el.addEventListener('straddleerror', () => {
    errorCount++
  })

  iframe.dispatchEvent(new Event('load')) // document died before announcing itself
  advancePastMountTimeout()

  expect(errorCount).toBe(1)
})

// The FIRST load event must NOT reopen the handshake: with a fast handshake the
// initial document's `load` fires after READY (scripts run before subresources
// finish), and re-arming there would fire a spurious straddleerror 10s into a
// perfectly healthy surface — and permanently re-gate RESIZE.
test('the first iframe load after READY does not re-arm the mount timeout', async () => {
  const { el, iframe, id } = await mount()
  deliver(envelope('STRADDLE_HELLO', id, {}))
  deliver(envelope('STRADDLE_READY', id, {})) // handshake done before load

  let errored = false
  el.addEventListener('straddleerror', () => {
    errored = true
  })

  iframe.dispatchEvent(new Event('load')) // the mount navigation's late load
  advancePastMountTimeout()

  expect(errored).toBe(false)
})

// During the reload window the new document has not installed its listener yet
// (and has not been INIT'd), so container resizes must be gated again until the
// reloaded surface reports READY — the same gate the first mount gets.
test('a HELLO after READY re-gates RESIZE until the next READY', async () => {
  const originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
  try {
    const { el, sent, id } = await mount()
    deliver(envelope('STRADDLE_READY', id, {})) // catch-up RESIZE #1
    expect(resizes(sent)).toHaveLength(1)

    // Iframe reloads: HELLO from the new document re-opens the handshake.
    deliver(envelope('STRADDLE_HELLO', id, {}))
    MockResizeObserver.last!.emit(500, 400, el)
    expect(resizes(sent)).toHaveLength(1) // gated — still just the catch-up

    // The reloaded surface becomes READY → catch-up RESIZE resumes the flow.
    deliver(envelope('STRADDLE_READY', id, {}))
    expect(resizes(sent)).toHaveLength(2)
  } finally {
    globalThis.ResizeObserver = originalRO
  }
})

// resolveToken() is a documented async override point (e.g. fetch a token from
// a BFF). If it rejects, mount() never runs and no mount timeout is armed, so
// the rejection itself must surface a straddleerror — otherwise the partner has
// zero signal that the surface is stuck.
test('a rejected resolveToken() surfaces a straddleerror', async () => {
  class FailingTokenElement extends StraddleComponentElement {
    protected async resolveToken(): Promise<string> {
      throw new Error('token acquisition failed')
    }
  }
  if (!customElements.get('straddle-failtoken')) {
    customElements.define('straddle-failtoken', FailingTokenElement)
  }

  const el = new FailingTokenElement()
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  let message: string | undefined
  el.addEventListener('straddleerror', (event) => {
    message = (event as CustomEvent).detail.message
  })
  document.body.appendChild(el)
  await tick() // let connectedCallback run resolveToken() and catch the rejection
  advancePastMountTimeout() // no mount timeout was ever armed → no-op

  expect(message).toBe('token acquisition failed')
})

// The reload's full handshake (HELLO → INIT → READY) can complete before the
// reloaded document's `load` event fires — postMessage beats subresource
// loading. That late load must NOT reopen the handshake: no further READY is
// coming, so re-gating would stop RESIZE forever, and re-arming the (already
// cleared) mount timeout would fire a spurious straddleerror into a healthy
// surface.
test('a reload whose handshake completes before its load event stays healthy', async () => {
  const originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
  try {
    const { el, iframe, sent, id } = await mount()
    // First handshake, then the mount navigation's own late load.
    deliver(envelope('STRADDLE_HELLO', id, {}))
    deliver(envelope('STRADDLE_READY', id, {})) // catch-up RESIZE #1
    iframe.dispatchEvent(new Event('load'))

    let errored = false
    el.addEventListener('straddleerror', () => {
      errored = true
    })

    // Reload: the new document's handshake completes before its load fires.
    deliver(envelope('STRADDLE_HELLO', id, {}))
    deliver(envelope('STRADDLE_READY', id, {})) // catch-up RESIZE #2
    iframe.dispatchEvent(new Event('load'))

    advancePastMountTimeout()
    expect(errored).toBe(false)

    // RESIZE still flows — the late load must not have re-gated it.
    MockResizeObserver.last!.emit(500, 400, el)
    expect(resizes(sent)).toHaveLength(3)
  } finally {
    globalThis.ResizeObserver = originalRO
  }
})

// A load landing mid-handshake (reload HELLO seen, READY still pending) must
// not clobber the already-armed timeout: if the reload never becomes READY,
// the error still fires exactly once.
test('a reload that HELLOs but never becomes READY errors even when its load fires mid-handshake', async () => {
  const { el, iframe, id } = await mount()
  deliver(envelope('STRADDLE_HELLO', id, {}))
  deliver(envelope('STRADDLE_READY', id, {}))
  iframe.dispatchEvent(new Event('load')) // mount navigation's own load

  let errorCount = 0
  let lastDetail: { code?: string } | null = null
  el.addEventListener('straddleerror', (e) => {
    errorCount++
    lastDetail = (e as CustomEvent).detail
  })

  deliver(envelope('STRADDLE_HELLO', id, {})) // reload announces, re-arms
  iframe.dispatchEvent(new Event('load')) // its load lands mid-handshake
  advancePastMountTimeout() // READY never arrives; fires every pending timeout

  expect(errorCount).toBe(1)
  expect(lastDetail).not.toBeNull()
  expect(lastDetail!.code).toBe('INTERNAL')
})

// --- default host height ---------------------------------------------------

class FixedHeightElement extends StraddleComponentElement {
  protected get defaultHeight(): string | null {
    return '720px'
  }
}

let fixedDefined = false
beforeEach(() => {
  if (!fixedDefined) {
    customElements.define('straddle-fixed-test', FixedHeightElement)
    fixedDefined = true
  }
})

test('leaves host height alone when defaultHeight is null (base default)', async () => {
  const { el } = await mount()
  expect(el.style.height).toBe('')
  expect(el.style.minHeight).toBe('300px')
})

test('applies defaultHeight to an unsized host', async () => {
  const el = new FixedHeightElement()
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  el.setAttribute('token', 'tok-1')
  document.body.appendChild(el)
  await tick()
  expect(el.style.height).toBe('720px')
  expect(el.style.minHeight).toBe('300px')
})

test('respects a partner-set inline height over defaultHeight', async () => {
  const el = new FixedHeightElement()
  el.setAttribute('iframe-origin', IFRAME_ORIGIN)
  el.setAttribute('token', 'tok-1')
  el.style.height = '500px'
  document.body.appendChild(el)
  await tick()
  expect(el.style.height).toBe('500px')
})

test('respects a partner stylesheet height over defaultHeight', async () => {
  const style = document.createElement('style')
  style.textContent = 'straddle-fixed-test { height: 600px; }'
  document.head.appendChild(style)
  try {
    const el = new FixedHeightElement()
    el.setAttribute('iframe-origin', IFRAME_ORIGIN)
    el.setAttribute('token', 'tok-1')
    document.body.appendChild(el)
    await tick()
    // No inline override: the partner's CSS keeps control of the height.
    expect(el.style.height).toBe('')
  } finally {
    style.remove()
  }
})

// --- type-level guarantees for the TOptions generic --------------------------

type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

type Contract = { mode?: 'a' | 'b' }

// A subclass pinned to a contract sees initOptions typed to that contract.
class Pinned extends StraddleComponentElement<Contract> {
  probe() {
    return this.initOptions
  }
}
type _PinnedOptions = Assert<
  Equal<ReturnType<Pinned['probe']>, Contract | undefined>
>

// Returning a shape outside the contract fails the subclass's build.
class _Drifted extends StraddleComponentElement<Contract> {
  // @ts-expect-error 'c' is not in Contract['mode']
  protected get initOptions(): { mode: 'c' } | undefined {
    return undefined
  }
}

// The default generic leaves untyped subclasses exactly as before: initOptions
// is Record<string, unknown> | undefined and any record is accepted.
class Untyped extends StraddleComponentElement {
  protected get initOptions(): Record<string, unknown> | undefined {
    return { anything: 1 }
  }
  probe() {
    return this.initOptions
  }
}
type _DefaultOptions = Assert<
  Equal<ReturnType<Untyped['probe']>, Record<string, unknown> | undefined>
>

const OVERRIDE = 'http://localhost:5173'
const MISSING = {
  error: 'straddle-test requires a "mode" attribute: "sandbox" or "production"',
}
const INVALID = {
  error: 'straddle-test "mode" must be "sandbox" or "production"',
}

test.each([
  [null, null, MISSING],
  ['sandbox', null, { origin: APP_ORIGINS.sandbox }],
  ['production', null, { origin: APP_ORIGINS.production }],
  ['prod', null, INVALID],
  ['', null, INVALID],
  ['Sandbox', null, INVALID],
  [null, OVERRIDE, { origin: OVERRIDE }],
  ['sandbox', OVERRIDE, { origin: OVERRIDE }],
  ['prod', OVERRIDE, INVALID],
  [null, '', MISSING],
])(
  'resolves mode=%j with iframe-origin=%j to %j',
  (
    mode: string | null,
    override: string | null,
    expected: AppOriginResolution,
  ) => {
    expect(resolveAppOrigin('straddle-test', mode, override)).toEqual(expected)
  },
)

test('each mode points at its public surface origin', () => {
  expect(APP_ORIGINS).toEqual({
    sandbox: 'https://surface-sandbox.straddle.com',
    production: 'https://surface.straddle.com',
  })
})
