import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { PROTOCOL_VERSION } from '@straddlecom/runtime-core'
import type { Envelope } from '@straddlecom/runtime-core'
import { createSurfaceRuntime } from './surface-runtime'
import type { SurfaceRuntime, SurfaceRuntimeConfig } from './surface-runtime'

const PARENT = 'https://parent.example'

// Capture outbound messages by stubbing window.parent.postMessage.
let sent: Array<{ message: Envelope; origin: string }>
function setParentSpy() {
  sent = []
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: {
      postMessage: (message: Envelope, origin: string) =>
        sent.push({ message, origin }),
    },
  })
}
const of = (type: string) => sent.filter((m) => m.message.type === type)

// Intercept the HELLO resend interval (200ms) and cap timeout (10s) by delay so
// tests fire them deterministically (Bun 1.2.x lacks fake-timer advancement).
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const HELLO_HANDLE = -11 as unknown as ReturnType<typeof setInterval>
const CAP_HANDLE = -22 as unknown as ReturnType<typeof setTimeout>
let helloTick: (() => void) | null = null
let capFire: (() => void) | null = null
// Live (uncleared) registrations of each. The handles above are shared, so a
// second registration would silently overwrite the captured callback; these
// counters make a revive that leaves two timers running visible instead.
// They count registrations minus clears, which tracks live timers only while
// the cap has not expired on its own: when it does, the runtime nulls its own
// capTimer before calling stopHello(), so stopHello() skips clearTimeout and
// capTimers stays at 1 for a cap that is already gone. A test that fires
// capFire?.() and then revives would therefore read capTimers === 2 and report
// a duplicate cap that does not exist — decrement it where the cap fires (wrap
// the captured callback) rather than trusting the raw count there.
let helloTimers = 0
let capTimers = 0

const tick = () => new Promise((r) => realSetTimeout(r, 0))

beforeEach(() => {
  helloTick = null
  capFire = null
  helloTimers = 0
  capTimers = 0
  globalThis.setInterval = ((fn: () => void, delay?: number) => {
    if (delay === 200) {
      helloTick = fn
      helloTimers += 1
      return HELLO_HANDLE
    }
    return realSetInterval(fn, delay)
  }) as typeof setInterval
  globalThis.clearInterval = ((h?: ReturnType<typeof setInterval>) => {
    if (h === HELLO_HANDLE) {
      helloTick = null
      helloTimers -= 1
      return
    }
    return realClearInterval(h)
  }) as typeof clearInterval
  globalThis.setTimeout = ((fn: () => void, delay?: number) => {
    if (delay === 10_000) {
      capFire = fn
      capTimers += 1
      return CAP_HANDLE
    }
    return realSetTimeout(fn, delay)
  }) as typeof setTimeout
  globalThis.clearTimeout = ((h?: ReturnType<typeof setTimeout>) => {
    if (h === CAP_HANDLE) {
      capFire = null
      capTimers -= 1
      return
    }
    return realClearTimeout(h)
  }) as typeof clearTimeout
  window.location.hash = '#sid=inst-1'
  setParentSpy()
})

afterEach(() => {
  active.forEach((r) => r.destroy())
  active = []
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
})

// Track created runtimes so each test's listeners are torn down (shared sid).
let active: SurfaceRuntime[] = []
function create(cfg: Partial<SurfaceRuntimeConfig> = {}): SurfaceRuntime {
  const rt = createSurfaceRuntime({
    allowedParentOrigins: [PARENT],
    onInit: () => {},
    ...cfg,
  })
  active.push(rt)
  return rt
}

function deliver(
  type: string,
  payload: unknown,
  opts: { id?: string; origin?: string; version?: string } = {},
) {
  const env = {
    type,
    version: opts.version ?? PROTOCOL_VERSION,
    instanceId: opts.id ?? 'inst-1',
    nonce: 'n',
    payload,
  }
  const ev = new MessageEvent('message', { data: env })
  Object.defineProperty(ev, 'origin', { value: opts.origin ?? PARENT })
  window.dispatchEvent(ev)
}

// happy-dom has no PageTransitionEvent constructor; `persisted` is the only
// property the runtime reads, so stamp it onto a plain Event.
function pageEvent(type: 'pagehide' | 'pageshow', persisted: boolean) {
  const ev = new Event(type)
  Object.defineProperty(ev, 'persisted', { value: persisted })
  window.dispatchEvent(ev)
}

test('throws when the URL has no #sid', () => {
  window.location.hash = ''
  expect(() =>
    createSurfaceRuntime({ allowedParentOrigins: [PARENT], onInit: () => {} }),
  ).toThrow(/sid/)
})

test('announces HELLO to every allowed origin on creation', () => {
  const OTHER = 'https://other.example'
  create({ allowedParentOrigins: [PARENT, OTHER] })
  const hellos = of('STRADDLE_HELLO')
  expect(hellos).toHaveLength(2)
  expect(hellos.map((h) => h.origin).sort()).toEqual([OTHER, PARENT].sort())
  expect(hellos[0].message.instanceId).toBe('inst-1')
})

test('INIT stops the HELLO loop and sends READY after onInit resolves', async () => {
  const onInit = mock((_token: string, _options?: Record<string, unknown>) =>
    Promise.resolve(),
  )
  create({ onInit })
  deliver('STRADDLE_INIT', {
    token: 'tok-1',
    options: { test_option: 'value' },
  })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(1)
  expect(onInit.mock.calls[0][0]).toBe('tok-1')
  expect(onInit.mock.calls[0][1]).toEqual({ test_option: 'value' })
  expect(of('STRADDLE_READY')).toHaveLength(1)
  expect(helloTick).toBeNull() // loop stopped on INIT
})

test('a rejected onInit sends STRADDLE_ERROR INTERNAL, not READY', async () => {
  create({ onInit: () => Promise.reject(new Error('boot failed')) })
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(of('STRADDLE_READY')).toHaveLength(0)
  const errors = of('STRADDLE_ERROR')
  expect(errors).toHaveLength(1)
  expect((errors[0].message.payload as { code: string }).code).toBe('INTERNAL')
  expect((errors[0].message.payload as { message: string }).message).toBe(
    'boot failed',
  )
})

test('acts on the first INIT only (parent acks every HELLO)', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  create({ onInit })
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  deliver('STRADDLE_INIT', { token: 'tok-2' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(1)
})

test('autoHeight sends one HEIGHT after READY', async () => {
  create()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(of('STRADDLE_HEIGHT')).toHaveLength(1)
  expect(
    typeof (of('STRADDLE_HEIGHT')[0].message.payload as { height: number })
      .height,
  ).toBe('number')
})

test('autoHeight:false sends no HEIGHT after READY', async () => {
  create({ autoHeight: false })
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(of('STRADDLE_HEIGHT')).toHaveLength(0)
})

test('RESIZE after INIT invokes onResize with the container size', async () => {
  const onResize = mock((_size: { width: number; height: number }) => {})
  create({ onResize })
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  deliver('STRADDLE_RESIZE', { width: 400, height: 300 })
  expect(onResize).toHaveBeenCalledTimes(1)
  expect(onResize.mock.calls[0][0]).toEqual({ width: 400, height: 300 })
})

// The parent gates RESIZE until READY, but its `ready` flag stays true across
// an in-place iframe reload — so a resize during the reload window reaches the
// NEW document before its INIT. The runtime-client comment promises "the app
// would drop it"; make that true: onResize must not fire before onInit has run.
test('RESIZE before INIT is dropped (surface not initialized yet)', () => {
  const onResize = mock((_size: { width: number; height: number }) => {})
  create({ onResize })
  deliver('STRADDLE_RESIZE', { width: 400, height: 300 })
  expect(onResize).toHaveBeenCalledTimes(0)
})

test('an inbound VERSION_MISMATCH stops the HELLO loop (terminal)', () => {
  create()
  deliver(
    'STRADDLE_VERSION_MISMATCH',
    { ourVersion: PROTOCOL_VERSION, theirVersion: '999' },
    { version: '999' },
  )
  expect(helloTick).toBeNull()
})

test('complete/exit/redirect/error post to the parent after INIT', async () => {
  const rt = create()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  rt.complete({ ref: 'x' })
  rt.exit('user_cancelled')
  rt.redirect('https://redirect.example/continue')
  rt.error('INTERNAL', 'boom')
  expect(of('STRADDLE_COMPLETE')[0].message.payload).toEqual({
    data: { ref: 'x' },
  })
  expect(of('STRADDLE_EXIT')[0].message.payload).toEqual({
    reason: 'user_cancelled',
  })
  expect(of('STRADDLE_REDIRECT')[0].message.payload).toEqual({
    url: 'https://redirect.example/continue',
  })
  expect(of('STRADDLE_ERROR')[0].message.payload).toEqual({
    code: 'INTERNAL',
    message: 'boom',
  })
})

test('outbound methods no-op before INIT (no parent origin yet)', () => {
  const rt = create()
  rt.complete({ ref: 'x' })
  expect(of('STRADDLE_COMPLETE')).toHaveLength(0)
})

test('the HELLO cap stops the loop', () => {
  create()
  expect(helloTick).not.toBeNull()
  capFire?.()
  expect(helloTick).toBeNull()
})

test('destroy stops HELLO and ignores later messages', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  const rt = create({ onInit })
  rt.destroy()
  expect(helloTick).toBeNull()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(0)
})

// --- back/forward cache --------------------------------------------------
// `pagehide` fires both when the page is being destroyed and when it is only
// being frozen into the back/forward cache, where every variable — `terminated`
// included — survives the freeze untouched. Terminating on a freeze leaves a
// restored surface looking alive but inert, with both listeners already gone,
// so nothing is left to notice the page came back.

test('a real unload (pagehide persisted:false) still terminates', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  const rt = create({ onInit })
  pageEvent('pagehide', false)
  expect(helloTick).toBeNull()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(0)
  rt.complete({ ref: 'x' })
  expect(of('STRADDLE_COMPLETE')).toHaveLength(0)
})

test('a freeze (pagehide persisted:true) leaves the runtime alive', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  const rt = create({ onInit })
  pageEvent('pagehide', true)
  expect(helloTick).not.toBeNull() // still announcing; nothing torn down
  expect(helloTimers).toBe(1)
  expect(capTimers).toBe(1)
  pageEvent('pageshow', true) // Back restores the page
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(1)
  expect(of('STRADDLE_READY')).toHaveLength(1)
  rt.complete({ ref: 'x' })
  expect(of('STRADDLE_COMPLETE')).toHaveLength(1)
})

test('a surface frozen after INIT can still use every outward method', async () => {
  const rt = create()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  pageEvent('pagehide', true)
  pageEvent('pageshow', true)
  rt.complete({ ref: 'x' })
  rt.exit('user_cancelled')
  rt.redirect('https://redirect.example/continue')
  rt.error('INTERNAL', 'boom')
  expect(of('STRADDLE_COMPLETE')).toHaveLength(1)
  expect(of('STRADDLE_EXIT')).toHaveLength(1)
  expect(of('STRADDLE_REDIRECT')).toHaveLength(1)
  expect(of('STRADDLE_ERROR')).toHaveLength(1)
  rt.reportHeight()
  expect(of('STRADDLE_HEIGHT')).toHaveLength(2) // the READY one, plus this
})

// Browsers under-report `pagehide.persisted` (it can be false for a page that
// is then restored); `pageshow.persisted` is the reliable signal, so it has to
// undo a teardown the pagehide should never have done.
test('pageshow revives a runtime a mis-reported pagehide tore down', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  const rt = create({ onInit })
  pageEvent('pagehide', false)
  expect(helloTick).toBeNull()
  pageEvent('pageshow', true)
  expect(helloTick).not.toBeNull() // announcing again
  expect(helloTimers).toBe(1) // exactly one interval…
  expect(capTimers).toBe(1) // …and one cap
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(1)
  expect(of('STRADDLE_READY')).toHaveLength(1)
  rt.complete({ ref: 'x' })
  expect(of('STRADDLE_COMPLETE')).toHaveLength(1)
})

// A HELLO after a completed handshake tells the parent the iframe reloaded in
// place: it drops `ready`, re-arms its mount timeout and re-INITs — an INIT
// this document ignores, so the parent would time out waiting for a READY that
// never comes. Revive must not re-announce once INIT has landed.
test('reviving after a completed handshake does not re-announce HELLO', async () => {
  const rt = create()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(of('STRADDLE_HELLO')).toHaveLength(1)
  pageEvent('pagehide', false)
  pageEvent('pageshow', true)
  expect(of('STRADDLE_HELLO')).toHaveLength(1)
  expect(helloTick).toBeNull()
  expect(helloTimers).toBe(0)
  expect(capTimers).toBe(0)
  rt.complete({ ref: 'x' })
  expect(of('STRADDLE_COMPLETE')).toHaveLength(1)
})

test('reviving re-registers the message and pagehide listeners exactly once', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  create({ onInit })
  const realAdd = window.addEventListener
  const realRemove = window.removeEventListener
  const live: Record<string, number> = {}
  window.addEventListener = ((type: string, ...rest: unknown[]) => {
    live[type] = (live[type] ?? 0) + 1
    return (realAdd as unknown as (...a: unknown[]) => void).call(
      window,
      type,
      ...rest,
    )
  }) as typeof window.addEventListener
  window.removeEventListener = ((type: string, ...rest: unknown[]) => {
    live[type] = (live[type] ?? 0) - 1
    return (realRemove as unknown as (...a: unknown[]) => void).call(
      window,
      type,
      ...rest,
    )
  }) as typeof window.removeEventListener
  try {
    pageEvent('pagehide', false) // removes message + pagehide
    pageEvent('pageshow', true) // re-adds them
    pageEvent('pageshow', true) // a second restore must not re-add
  } finally {
    window.addEventListener = realAdd
    window.removeEventListener = realRemove
  }
  expect(live.message).toBe(0) // one removed, one added: net zero
  expect(live.pagehide).toBe(0)
  // One live message listener, so one INIT is handled once.
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(1)
  expect(of('STRADDLE_READY')).toHaveLength(1)
})

test('pageshow does not revive a runtime destroy() tore down', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  const rt = create({ onInit })
  rt.destroy()
  pageEvent('pageshow', true)
  expect(helloTick).toBeNull()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(0)
})

test('pageshow does not revive after a VERSION_MISMATCH', async () => {
  const onInit = mock((_token: string) => Promise.resolve())
  create({ onInit })
  deliver(
    'STRADDLE_VERSION_MISMATCH',
    { ourVersion: PROTOCOL_VERSION, theirVersion: '999' },
    { version: '999' },
  )
  pageEvent('pagehide', false)
  pageEvent('pageshow', true)
  expect(helloTick).toBeNull()
  deliver('STRADDLE_INIT', { token: 'tok-1' })
  await tick()
  expect(onInit).toHaveBeenCalledTimes(0)
})

test('an ordinary load (pageshow persisted:false) does not revive', () => {
  create()
  pageEvent('pagehide', false)
  pageEvent('pageshow', false)
  expect(helloTick).toBeNull()
})

// --- type-level guarantees for the TOptions generic --------------------------

type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

type Contract = { mode?: 'a' | 'b' }

// Pinning TOptions types onInit's options parameter to the contract.
type _PinnedOnInit = Assert<
  Equal<
    Parameters<SurfaceRuntimeConfig<Contract>['onInit']>,
    [token: string, options: Contract | undefined]
  >
>

// The default keeps today's signature: an untyped Record.
type _DefaultOnInit = Assert<
  Equal<
    Parameters<SurfaceRuntimeConfig['onInit']>,
    [token: string, options: Record<string, unknown> | undefined]
  >
>

declare function acceptsConfig(config: SurfaceRuntimeConfig): void
declare function inferFrom<T extends Record<string, unknown>>(
  config: SurfaceRuntimeConfig<T>,
): T

// Type-only cases, wrapped in a function that is never called so the
// `declare`d helpers are never invoked at runtime.
function _compilesAtTypeLevel(): void {
  // Existing call shapes keep compiling: onInit that ignores options, and onInit
  // declared with the previous optional Record parameter.
  acceptsConfig({ allowedParentOrigins: [], onInit(_token) {} })
  acceptsConfig({
    allowedParentOrigins: [],
    onInit(_token, _options?: Record<string, unknown>) {},
  })

  // The generic is inferred from the config, and the callback sees the contract.
  const inferred = inferFrom<Contract>({
    allowedParentOrigins: [],
    onInit(_token, options) {
      type _Seen = Assert<Equal<typeof options, Contract | undefined>>
    },
  })
  type _Inferred = Assert<Equal<typeof inferred, Contract>>
}
