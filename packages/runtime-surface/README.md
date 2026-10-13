# @straddlecom/runtime-surface

Surface-side runtime. The code that runs **inside** the surface iframe:
it performs the postMessage handshake with the parent (`@straddlecom/runtime-client`)
and exposes a small API for the surface app.

> **Internal package.** Internal to Straddle's SDKs and not for direct use.
> Straddle's hosted surface apps run it inside the iframe; partners integrate
> with [`@straddlecom/straddle-js`](../straddle-js) instead. It publishes
> `restricted` with `0.x` versioning and pairs with
> `@straddlecom/runtime-client` (page side) and `@straddlecom/runtime-core`
> (shared protocol and bus).

## Usage

```ts
import { createSurfaceRuntime } from '@straddlecom/runtime-surface'

const surface = createSurfaceRuntime({
  allowedParentOrigins: ['https://app.straddle.com'],
  async onInit(token, options) {
    await boot(token, options) // resolve → READY; throw → STRADDLE_ERROR
  },
  onResize({ width, height }) {
    // optional: reflow to the parent container size hint
  },
})

surface.complete({ paymentId })
surface.exit('user_cancelled')
surface.redirect('https://redirect.example/continue')
surface.error('INTERNAL', 'something broke')
surface.destroy() // SPA route change / unmount
```

The runtime owns the `#sid` parse, HELLO resend loop, INIT/READY, height
reporting, version-mismatch handling, and teardown.

`onInit` receives the opaque token and the surface-defined initialization
options forwarded by the parent (`undefined` when the parent sent none).
`createSurfaceRuntime<TOptions>` types that parameter; the default is
`Record<string, unknown>`, and a concrete surface pins it to its contract from
`@straddlecom/surface-contracts` (e.g. `BridgeInitOptions`). The type states
the contract, not a guarantee — the values arrive from the parent unverified,
so validate enum-like options with `readInitOption`:

```ts
import { readInitOption } from '@straddlecom/runtime-surface'
import { BRIDGE_OAUTH_MODES } from '@straddlecom/surface-contracts/bridge'
import type { BridgeInitOptions } from '@straddlecom/surface-contracts/bridge'

createSurfaceRuntime<BridgeInitOptions>({
  allowedParentOrigins: [...],
  onInit(token, options) {
    // 'popup' | 'redirect' | undefined; throws on anything else
    const mode = readInitOption(options, 'oauth_mode', BRIDGE_OAUTH_MODES)
  },
})
```

`readInitOption(options, key, allowed)` returns the value typed to the
`allowed` union, `undefined` when the key is absent, and throws a descriptive
error on any other value (including non-strings). A throw inside `onInit`
becomes `STRADDLE_ERROR` (code `INTERNAL`), so a parent sending a value this
surface doesn't understand fails loudly instead of silently falling back. The
`allowed` list is type-checked against the option's declared type, so a
contract rename fails the build. `redirect()` requests a top-level navigation
from the embedding page; the parent accepts HTTPS URLs only.

## Constraints for surface apps

- **Leave `location.hash` alone.** The parent delivers the element's instance id
  in the URL hash (`#sid=<id>`); the runtime reads it at creation and it must
  survive an in-place reload. Hash-based routing, or code that clears or
  rewrites the hash, breaks the handshake.
- **One runtime per page.** Call `createSurfaceRuntime` once at boot. Multiple
  surfaces on one parent page are supported — each iframe gets its own `#sid` and
  all messages are gated on it — but each iframe creates exactly one runtime.

## Back/forward cache

The runtime survives a back/forward-cache freeze. `pagehide` tears it down only
for a genuine unload (`event.persisted === false`); when the page turns out to
have been frozen rather than destroyed, `pageshow` re-attaches the listeners it
removed and resumes the HELLO loop if INIT had not yet landed. A surface the
user reaches again with Back can finish its handshake and keep calling
`complete()` / `exit()` / `redirect()` / `error()` — no frame reload needed.
This matters most in redirect mode, where `redirect()` navigates the top level
away and Back brings the whole page, iframe included, straight back.

Permanent teardowns are never revived: a runtime the app tore down itself
with `destroy()` stays down, as does one stopped by a protocol version
mismatch.

## Publishing

Published to npm as `@straddlecom/runtime-surface` (restricted, 0.x) with a
real dependency on `@straddlecom/runtime-core` — no bundling. `prepack` emits
`dist/` (JS + declarations) with tsc; the in-repo manifest exports raw `src/`
directly, so dev flows never need a build.
The src exports and `workspace:` dependency ranges are dev-only and must not
ship (`strip` rewrites each export to its `dist/` types/default pair, and
`workspace:^` to the caret range of the dependency's manifest version — bun's
own substitution reads the lockfile, which release-please never bumps): the
publish workflow runs `bun ../../scripts/publish-manifest.ts strip` before
publishing — `prepack` refuses to pack a manifest that still carries either.
`restore` puts a locally stripped manifest back (CI checkouts are ephemeral
and skip it).
