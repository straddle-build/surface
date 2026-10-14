# @straddlecom/runtime-client

Parent-side surface runtime: the iframe lifecycle and the Web Component base
class that hosts a Straddle surface inside a partner page or the Straddle
dashboard.

> **Internal package.** Internal to Straddle's SDKs and not for direct use.
> Integrate with [`@straddlecom/straddle-js`](../straddle-js) instead, which
> builds `<straddle-bridge>` on this base class and bundles this package. It
> publishes `restricted` with `0.x` versioning and builds on
> [`@straddlecom/runtime-core`](../runtime-core) for the `postMessage`
> protocol.

## What's here

| Export                                | Role                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StraddleComponentElement`            | Abstract `HTMLElement` base class. Subclass it and you get a fully wired element: origin selection from `mode`, iframe mount, the HELLO/INIT handshake, resize, height, and lifecycle DOM events. |
| `STRADDLE_MODES`, `StraddleMode`      | The `mode` vocabulary: `sandbox` or `production`.                                                                                                                                                 |
| `APP_ORIGINS`                         | The app origin for each mode.                                                                                                                                                                     |
| `resolveAppOrigin`                    | Pure resolver behind the element: `(tagName, mode, override)` → `{ origin }` or `{ error }`.                                                                                                      |
| `mountIframe`                         | Lower-level helper that mounts a sandboxed iframe into a container and observes the container for size changes.                                                                                   |
| `IframeHandle`, `AppOriginResolution` | `{ element, destroy }` returned by `mountIframe`; the resolver's result.                                                                                                                          |

## `StraddleComponentElement`

Subclass it; the base class handles the whole lifecycle:

```ts
import { StraddleComponentElement } from '@straddlecom/runtime-client'

class ExampleElement extends StraddleComponentElement {}

customElements.define('straddle-example', ExampleElement)
```

```html
<straddle-example mode="sandbox" token="..."></straddle-example>
```

The `mode` attribute picks the surface app: `sandbox` or `production`
(`APP_ORIGINS`, exact and case-sensitive).

### `iframe-origin` (development only)

The `iframe-origin` attribute points a dev build at any other app origin, such
as a local stack. When set it wins over `mode` and is the only way to mount
without one, but an invalid `mode` is still rejected.

Every element package's published build ignores it. Those npm and CDN bundles,
straddle-js's among them, are built with `STRADDLE_IFRAME_ORIGIN_OVERRIDE`
defined as `false`, so the bundler drops the override and the attribute name,
and `mode` alone picks the origin. Builds that leave the constant undefined
honor it: `bun test`, the examples, any bundler that compiles this package
from source, and this package's own tsc-emitted `dist/`, which partners don't
install directly.

What it does on `connectedCallback`:

1. Resolves the app origin through `iframeOrigin` (from `mode` /
   `iframe-origin` unless a subclass overrides it). If `mode` is invalid, or
   absent with no `iframe-origin`, it dispatches `straddleerror`
   (`code: "INTERNAL"`) synchronously and does not mount. A reconnect
   supersedes any connection still resolving its token, so only the latest
   connection can mount.
2. Resolves a session token via `resolveToken()` (defaults to the `token`
   attribute; override it to acquire the token another way). If it rejects, the
   element dispatches `straddleerror` (`code: "INTERNAL"`) and stops.
3. Registers its `message` listener, then mounts a sandboxed iframe at
   `${iframeOrigin}${iframePath}#sid=<instanceId>` (default path `/`) — the
   hash delivers the instance id to the surface.
4. Answers every `STRADDLE_HELLO` from the surface with `STRADDLE_INIT`
   carrying the token and any surface-defined `initOptions`. The element never
   messages first: the surface announces itself once its own listener is
   installed, and INIT is the idempotent ack.
5. On `STRADDLE_READY`, sends one catch-up `STRADDLE_RESIZE` with the host's
   current size, then forwards later size changes as they happen (`RESIZE` is
   gated until READY so it cannot land before the surface is initialized).
6. Applies `STRADDLE_HEIGHT` from the iframe to its own `height`, and
   re-dispatches inbound lifecycle messages as bubbling `CustomEvent`s.
7. Handles `STRADDLE_REDIRECT` by navigating the top-level page when the
   requested URL uses HTTPS; invalid or non-HTTPS URLs emit `straddleerror`.
8. If the surface does not become ready within 10s (`MOUNT_TIMEOUT_MS`, shared
   with the surface's HELLO cap via runtime-core's `HANDSHAKE_TIMEOUT_MS`),
   dispatches `straddleerror` (`code: "INTERNAL"`). A surface speaking a
   different protocol version is detected from its HELLO and reported as
   `straddleerror` (`code: "VERSION_MISMATCH"`) instead.

The counterpart: the page at `iframeOrigin` must run Straddle's iframe-side
runtime at boot to complete the handshake.

### Known limitation: token reuse on iframe reload

If the iframe reloads in place (e.g. the user reloads just the frame, or the
surface app calls `location.reload()`), the new document re-announces itself
with `HELLO` and the element re-handshakes automatically — but it replays the
token from the original `resolveToken()` call rather than resolving a fresh
one. With single-use or short-lived tokens the reloaded surface's init can
fail server-side even though the handshake converges. The element doesn't
re-invoke `resolveToken()` per handshake, so treat a reload as potentially
requiring a remount of the element with a fresh token.

Separately, an in-place reload whose handshake converges re-fires
`straddleready` — `STRADDLE_READY` falls through to the event map on every
completed handshake, not just the first — so partners with one-shot ready
handlers should expect `straddleready` per handshake, not per element.

### Events

| DOM event          | Source message                                                                     | `event.detail`      |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------- |
| `straddleready`    | `STRADDLE_READY`                                                                   | (empty)             |
| `straddlecomplete` | `STRADDLE_COMPLETE`                                                                | `{ data? }`         |
| `straddleexit`     | `STRADDLE_EXIT`                                                                    | `{ reason? }`       |
| `straddleerror`    | `STRADDLE_ERROR`, `STRADDLE_VERSION_MISMATCH`, _or_ an invalid `STRADDLE_REDIRECT` | `{ code, message }` |

```ts
const el = document.querySelector('straddle-example')!
el.addEventListener('straddlecomplete', (e) =>
  console.log('done', e.detail.data),
)
el.addEventListener('straddleerror', (e) =>
  console.error(e.detail.code, e.detail.message),
)
```

### Overridable members

- `get iframeOrigin(): string` — origin of the embedded surface, resolved from
  `mode` / `iframe-origin` (`''` when neither resolves); also the only origin
  the runtime accepts replies from. An override that returns a non-empty
  origin replaces the `mode` / `iframe-origin` resolution, so the element
  mounts there without either attribute; an empty one errors at connect.
- `resolveToken(): Promise<string>` — override to supply the `STRADDLE_INIT`
  token from somewhere other than the `token` attribute.
- `initOptions: TOptions | undefined` (protected getter) — optional
  surface-defined values forwarded alongside the token in `STRADDLE_INIT`.
  `TOptions` is the class's type parameter
  (`StraddleComponentElement<TOptions = Record<string, unknown>>`); a
  concrete element pins it to its surface's contract from
  `@straddlecom/surface-contracts` so the shape it sends is the shape the
  surface's `onInit` expects. This package never imports that vocabulary
  itself.
- `navigateTopLevel(url: string): void` (protected) — performs the top-level
  navigation for a validated `STRADDLE_REDIRECT`. Defaults to
  `window.location.assign(url)`; override to intercept it (tests, hosts with
  custom routing).
- `iframePath: string` (protected getter) — path of the surface's server route
  on `iframeOrigin`, joined into the mount URL. Defaults to `/`; must start
  with `/`. Surface-specific elements pin their route here (e.g. `/bridge`).

## `mountIframe`

```ts
import { mountIframe } from '@straddlecom/runtime-client'

const handle = mountIframe(container, src, (width, height) => {
  /* size changed */
})
// ...later
handle.destroy()
```

The iframe is sandboxed with
`allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`.
`allow-same-origin` preserves the iframe's _own_ origin (so it can call its own
backend) without granting same-origin access to the parent. The popup tokens
allow embedded OAuth flows to open an unrestricted bank authorization window.

## Security notes

- Origins are always explicit. The component only sends to and accepts messages
  from `iframeOrigin`; `runtime-core`'s `send()` rejects a `'*'` target.
- Each instance gets a unique `instanceId`; messages addressed to a different
  instance are dropped.
- Top-level redirect requests accept HTTPS URLs only.

## Development

```bash
bun install        # from the repo root

bun run typecheck  # tsc --noEmit
bun run test       # bun test (DOM provided via happy-dom preload)
```

Tests run against [happy-dom](https://github.com/capricorn86/happy-dom) — see
`bunfig.toml` and `happy-dom.preload.ts`.

Source layout:

```
src/
  index.ts              # public exports
  component-base.ts     # StraddleComponentElement
  iframe-lifecycle.ts   # mountIframe / IframeHandle
```

## Publishing

Published to npm as `@straddlecom/runtime-client` (restricted, 0.x) with a
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

straddle-js doesn't depend on this package at runtime: it bundles it into its
self-contained artifacts and publishes its own flattened types.
