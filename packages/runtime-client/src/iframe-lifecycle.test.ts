import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mountIframe } from './iframe-lifecycle'

// A controllable ResizeObserver so the test can drive size changes.
class MockResizeObserver {
  static last: MockResizeObserver | null = null
  callback: ResizeObserverCallback
  disconnected = false
  observedTarget: Element | null = null
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    MockResizeObserver.last = this
  }
  observe(target: Element) {
    this.observedTarget = target
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
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

let originalRO: typeof ResizeObserver
beforeEach(() => {
  originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
  document.body.innerHTML = ''
})
afterEach(() => {
  globalThis.ResizeObserver = originalRO
})

test('mounts a sandboxed iframe that allows unrestricted OAuth popups', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const handle = mountIframe(container, 'https://iframe.example/', () => {})

  const iframe = container.querySelector('iframe')
  expect(iframe).not.toBeNull()
  expect(handle.element).toBe(iframe!)
  const sandbox = iframe!.getAttribute('sandbox')
  expect(sandbox).toBe(
    'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
  )
})

test('forwards resize observations to onSizeChange', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const sizes: Array<[number, number]> = []

  mountIframe(container, 'https://iframe.example/', (w, h) =>
    sizes.push([w, h]),
  )
  expect(MockResizeObserver.last!.observedTarget).toBe(container)
  MockResizeObserver.last!.emit(640, 480, container)

  expect(sizes).toEqual([[640, 480]])
})

test('destroy disconnects the observer and removes the iframe', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const handle = mountIframe(container, 'https://iframe.example/', () => {})
  handle.destroy()

  expect(MockResizeObserver.last!.disconnected).toBe(true)
  expect(container.querySelector('iframe')).toBeNull()
})
