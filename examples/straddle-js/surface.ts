import { createSurfaceRuntime } from '@straddlecom/runtime-surface'

// Stub bridge surface, served at the fixed /bridge route. createSurfaceRuntime
// owns the whole handshake: it reads #sid, announces STRADDLE_HELLO (resending
// until INIT acks it), replies READY once onInit resolves, auto-reports
// height, and enforces the origin pinning a real surface must do. Deliberately
// minimal: this harness is about consuming the published straddle.js bundle on
// the host side. For the deeper origin-enforcement and dynamic-resize
// walkthrough, see examples/embedded-iframe.
const ALLOWED_PARENT_ORIGIN = 'http://localhost:5373'

const statusEl = document.getElementById('status')!

const surface = createSurfaceRuntime({
  allowedParentOrigins: [ALLOWED_PARENT_ORIGIN],
  onInit(token) {
    statusEl.textContent = `INIT received (token: ${token}) — sent READY`
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
