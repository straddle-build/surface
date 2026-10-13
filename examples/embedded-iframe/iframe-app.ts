import { createSurfaceRuntime } from '@straddlecom/runtime-surface'

// The embedded surface only trusts INIT from the known parent origin. In a real
// surface this list is the set of Straddle host origins that may embed it.
const ALLOWED_PARENT_ORIGIN = 'http://localhost:5173'

const statusEl = document.getElementById('status')!
const resizeHintEl = document.getElementById('resize-hint')!
const extraEl = document.getElementById('extra')!

// createSurfaceRuntime owns the whole handshake: it parses #sid, announces
// HELLO (resending until INIT), sends READY when onInit resolves, auto-reports
// height, and handles a protocol-version mismatch. The app supplies only
// surface-specific behavior.
const surface = createSurfaceRuntime({
  allowedParentOrigins: [ALLOWED_PARENT_ORIGIN],
  onInit(token) {
    statusEl.textContent = `INIT received (token: ${token}) — sent READY`
  },
  onResize({ width, height }) {
    resizeHintEl.textContent = `STRADDLE_RESIZE received — parent container ${Math.round(
      width,
    )}×${Math.round(height)}`
  },
})

document
  .getElementById('complete')!
  .addEventListener('click', () => surface.complete({ demo: true }))
document
  .getElementById('exit')!
  .addEventListener('click', () => surface.exit('user_cancelled'))
document
  .getElementById('error')!
  .addEventListener('click', () => surface.error('INTERNAL', 'demo error'))

// Grow/shrink content to exercise dynamic height: the runtime's ResizeObserver
// re-reports HEIGHT and the parent resizes its host element to match. The block
// is tall enough to clear the host's 300px min-height floor so the resize is
// actually visible.
const EXTRA_PARAGRAPHS = 10
document.getElementById('grow')!.addEventListener('click', () => {
  extraEl.innerHTML = extraEl.childElementCount
    ? ''
    : Array.from(
        { length: EXTRA_PARAGRAPHS },
        (_, i) => `<p>Extra content paragraph ${i + 1}.</p>`,
      ).join('')
})
