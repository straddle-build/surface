import { beforeEach, expect, test } from 'bun:test'
import { APP_ORIGINS } from '@straddlecom/runtime-client'
import { StraddleBridgeElement } from './index'

const ORIGIN = 'https://surface.example'
const RETURN_URL = 'https://merchant.example/bank-return'

type Envelope = { type: string; payload: Record<string, unknown> }

// One macrotask tick lets the base class's async connectedCallback
// (resolveToken + mount) settle.
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  document.body.innerHTML = ''
})

test('registers as <straddle-bridge>', () => {
  expect(customElements.get('straddle-bridge')).toBe(StraddleBridgeElement)
  const el = document.createElement('straddle-bridge')
  expect(el).toBeInstanceOf(StraddleBridgeElement)
})

test('iframeOrigin follows mode until iframe-origin overrides it', () => {
  const el = document.createElement('straddle-bridge')
  expect(el.iframeOrigin).toBe('')
  el.setAttribute('mode', 'production')
  expect(el.iframeOrigin).toBe(APP_ORIGINS.production)
  el.setAttribute('iframe-origin', ORIGIN)
  expect(el.iframeOrigin).toBe(ORIGIN)
})

test('oauthMode is null when omitted and reflects oauth-mode="redirect"', () => {
  const el = document.createElement('straddle-bridge')
  expect(el.oauthMode).toBeNull()
  el.setAttribute('oauth-mode', 'redirect')
  expect(el.oauthMode).toBe('redirect')
})

// Mount an element, then replace the iframe's contentWindow with a postMessage
// recorder and drive a HELLO through the base class's message handler, so the
// STRADDLE_INIT it answers with can be inspected. `hello()` sends another
// HELLO and returns the INIT the element answers it with, so later acks can be
// compared against the first.
async function mountAndInit(attributes: Record<string, string>) {
  const el = document.createElement('straddle-bridge') as StraddleBridgeElement
  el.setAttribute('iframe-origin', ORIGIN)
  el.setAttribute('token', 'tok-1')
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value)
  }
  document.body.appendChild(el)
  await tick()
  const iframe = el.querySelector('iframe') as HTMLIFrameElement
  const sent: Envelope[] = []
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: { postMessage: (message: Envelope) => sent.push(message) },
  })
  const sid = new URL(iframe.src).hash.replace('#sid=', '')
  const hello = () => {
    const before = sent.length
    // happy-dom may not populate event.origin from the init; force it.
    const ev = new MessageEvent('message', {
      data: {
        version: '1',
        type: 'STRADDLE_HELLO',
        instanceId: sid,
        nonce: 'n-test',
        payload: {},
      },
    })
    Object.defineProperty(ev, 'origin', { value: ORIGIN })
    window.dispatchEvent(ev)
    const answered = sent.slice(before)
    expect(answered.map((m) => m.type)).not.toContain(
      'STRADDLE_VERSION_MISMATCH',
    )
    return answered.find((m) => m.type === 'STRADDLE_INIT')
  }
  const init = hello()
  return { el, init, hello }
}

// Drive a connect that is expected to fail, and return the straddleerror detail.
async function connectExpectingError(attributes: Record<string, string>) {
  const el = document.createElement('straddle-bridge')
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value)
  }
  let detail: { code?: string; message?: string } | null = null
  el.addEventListener('straddleerror', (event) => {
    detail = (event as CustomEvent).detail
  })
  document.body.appendChild(el)
  await tick()
  expect(detail).not.toBeNull()
  expect(el.querySelector('iframe')).toBeNull()
  return detail!
}

test('forwards oauth_mode to the surface in STRADDLE_INIT, and nothing else', async () => {
  const { init } = await mountAndInit({ 'oauth-mode': 'redirect' })
  expect(init).toBeDefined()
  // The return URL never crosses this boundary: it travels inside the session
  // token and the server derives it there.
  expect(init!.payload).toEqual({
    token: 'tok-1',
    options: { oauth_mode: 'redirect' },
  })
})

test('forwards oauth_mode="popup"', async () => {
  const { init } = await mountAndInit({ 'oauth-mode': 'popup' })
  expect(init).toBeDefined()
  expect(init!.payload).toEqual({
    token: 'tok-1',
    options: { oauth_mode: 'popup' },
  })
})

test('omits options from STRADDLE_INIT when no option attributes are set', async () => {
  const { init } = await mountAndInit({})
  expect(init).toBeDefined()
  expect(init!.payload).toEqual({ token: 'tok-1' })
  expect('options' in init!.payload).toBe(false)
})

test('freezes options at connect: later attribute changes do not reach INIT', async () => {
  const { el, init, hello } = await mountAndInit({ 'oauth-mode': 'redirect' })
  const frozen = { token: 'tok-1', options: { oauth_mode: 'redirect' } }
  expect(init!.payload).toEqual(frozen)
  el.setAttribute('oauth-mode', 'popup')
  // The getter reflects the live attribute...
  expect(el.oauthMode).toBe('popup')
  // ...but the next HELLO is still acked with the value validated at connect.
  const second = hello()
  expect(second).toBeDefined()
  expect(second!.payload).toEqual(frozen)
})

// The attribute is gone, not deprecated: the element neither reads nor
// validates it, so a page still carrying one — valid or not — is unaffected.
for (const redirectUrl of [RETURN_URL, 'javascript:alert(1)']) {
  test(`ignores a leftover redirect-url attribute ${JSON.stringify(redirectUrl)}`, async () => {
    const { el, init } = await mountAndInit({
      'oauth-mode': 'redirect',
      'redirect-url': redirectUrl,
    })
    expect(init).toBeDefined()
    expect(init!.payload).toEqual({
      token: 'tok-1',
      options: { oauth_mode: 'redirect' },
    })
    expect('redirectUrl' in el).toBe(false)
  })
}

test('mounts in redirect mode with no redirect-url attribute — the return URL lives in the session token', async () => {
  const { init } = await mountAndInit({ 'oauth-mode': 'redirect' })
  expect(init).toBeDefined()
  expect(init!.payload).toEqual({
    token: 'tok-1',
    options: { oauth_mode: 'redirect' },
  })
})

test(`mounts an iframe at ${ORIGIN}/bridge with #sid=<instanceId> when the attribute is present`, async () => {
  const el = document.createElement('straddle-bridge')
  el.setAttribute('iframe-origin', ORIGIN)
  el.setAttribute('token', 'tok-1')
  document.body.appendChild(el)
  await tick()
  const iframe = el.querySelector('iframe')
  expect(iframe).not.toBeNull()
  // Bridge lives at a fixed server route on the surface origin; the base class
  // delivers its instanceId to the surface via the URL hash.
  expect(iframe!.src).toContain(`${ORIGIN}/bridge#sid=`)
})

for (const mode of ['sandbox', 'production'] as const) {
  test(`mode="${mode}" mounts at the ${mode} app origin`, async () => {
    const el = document.createElement('straddle-bridge')
    el.setAttribute('mode', mode)
    el.setAttribute('token', 'tok-1')
    let detail: unknown = null
    el.addEventListener('straddleerror', (e) => {
      detail = (e as CustomEvent).detail
    })
    document.body.appendChild(el)
    await tick()
    expect(detail).toBeNull()
    const iframe = el.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.src).toContain(`${APP_ORIGINS[mode]}/bridge#sid=`)
  })
}

test('emits straddleerror and does not mount without mode or iframe-origin', async () => {
  const detail = await connectExpectingError({ token: 'tok-1' })
  expect(detail).toEqual({
    code: 'INTERNAL',
    message:
      'straddle-bridge requires a "mode" attribute: "sandbox" or "production"',
  })
})

for (const mode of ['', 'prod']) {
  test(`emits straddleerror and does not mount for mode=${JSON.stringify(mode)}`, async () => {
    const detail = await connectExpectingError({ mode })
    expect(detail).toEqual({
      code: 'INTERNAL',
      message: 'straddle-bridge "mode" must be "sandbox" or "production"',
    })
  })
}

test('rejects an invalid mode even when iframe-origin is set', async () => {
  const detail = await connectExpectingError({
    mode: 'prod',
    'iframe-origin': ORIGIN,
  })
  expect(detail.message).toBe(
    'straddle-bridge "mode" must be "sandbox" or "production"',
  )
})

for (const oauthMode of ['', 'other']) {
  test(`emits straddleerror and does not mount for oauth-mode=${JSON.stringify(oauthMode)}`, async () => {
    const detail = await connectExpectingError({
      mode: 'sandbox',
      'oauth-mode': oauthMode,
    })
    expect(detail.code).toBe('INTERNAL')
    expect(detail.message).toBe(
      'straddle-bridge "oauth-mode" must be "popup" or "redirect"',
    )
  })
}

test('reports an invalid oauth-mode before a missing mode', async () => {
  const detail = await connectExpectingError({ 'oauth-mode': 'other' })
  expect(detail.message).toBe(
    'straddle-bridge "oauth-mode" must be "popup" or "redirect"',
  )
})

test('gives an unsized host the fixed-frame default height', async () => {
  const el = document.createElement('straddle-bridge')
  el.setAttribute('iframe-origin', ORIGIN)
  el.setAttribute('token', 'tok-1')
  document.body.appendChild(el)
  await tick()
  expect((el as HTMLElement).style.height).toBe('720px')
})

test('leaves a partner-sized host alone', async () => {
  const el = document.createElement('straddle-bridge') as HTMLElement
  el.setAttribute('iframe-origin', ORIGIN)
  el.setAttribute('token', 'tok-1')
  el.style.height = '480px'
  document.body.appendChild(el)
  await tick()
  expect(el.style.height).toBe('480px')
})
