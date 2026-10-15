# @straddlecom/straddle-js

Straddle's merchant-facing widgets for payments and bank account connection.
Ships `<straddle-bridge>` as a standalone, self-registering bundle.

## `<straddle-bridge>`

Load the bundle, then use the element. It registers itself on load.

```html
<script src="/straddle.js"></script>
<straddle-bridge
  mode="sandbox"
  token="..."
  oauth-mode="popup"
></straddle-bridge>
```

| Attribute    | Required | Role                                                                                                                                                                                                                                                                             |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`       | yes      | Which Straddle environment to connect to: `sandbox` while you integrate, `production` when you go live. Any other value, or omitting it, emits `straddleerror` (`code: "INTERNAL"`) and does not mount.                                                                          |
| `token`      | no\*     | The session token, forwarded to the surface in `STRADDLE_INIT`: the `client_secret` from `POST /v1/bridge/sessions`, or the `bridge_token` from the legacy `POST /v1/bridge/initialize`. The return URL your backend supplied at session creation travels inside it (see below). |
| `oauth-mode` | no       | Bank OAuth navigation: `popup` (the default when omitted) or `redirect`. Any other value emits `straddleerror` (`code: "INTERNAL"`) and does not mount. See "OAuth navigation" below.                                                                                            |

\* The host page's backend initializes the Bridge session and passes the token
down; the element reads it via the base class's `resolveToken()`.

`mode` decides which Straddle surface app the element connects to, and it must
match the environment your backend issued the session token in: a sandbox
token mounted with `mode="production"` (or the reverse) is rejected by
Straddle once the flow starts, not by the element. Every copy of the script —
npm or CDN — is the same bundle; `mode` is the only switch.

The Bridge surface is served at the fixed `/bridge` route on the surface origin
— the element mounts its iframe at `<surface origin>/bridge#sid=<instanceId>`.
The route is part of the product contract and is not configurable.

### Sizing

The Bridge surface renders a fixed-height frame — it fills the element's box
and scrolls internally instead of growing with its content. The element sizes
itself accordingly at connect time:

- **If you size the element** — an inline `height` or any stylesheet rule that
  gives it a computed height before it connects — your sizing wins and the
  element never touches it.
- **If you don't**, the element sets an inline `height: 720px` (the design's
  frame height) so the iframe doesn't collapse to the browser's ~150px
  default.

Two caveats, both consequences of the check happening once, at connect:

- Sizing that resolves **after** the element connects loses. If the height
  comes from CSS that loads late, a class added after the element is in the
  DOM, or `height: 100%` of a container that is only sized later, the element
  computes as unsized at connect and gets the inline `720px`, which then
  outranks stylesheet rules. Size the element before it connects, set its
  inline height yourself, or use `!important`.
- `min-height` alone does not count as sizing — the host keeps the default
  behavior, and the element also sets its own inline `min-height: 300px` when
  none is present inline. Set an actual `height` to control the frame.

The element also sets `display: block` on itself at connect.

The embedded Bridge surface can open OAuth authorization in a new window. Its
iframe allows popups to escape the sandbox.

### OAuth navigation

Bank OAuth can run in a **popup** (a new window over your page; the default,
and what most bank-linking widgets do) or as a **redirect** (the surface app
navigates the top-level page to the bank, which returns the user to the return
URL your backend supplied when it created the session, where your page
re-mounts `<straddle-bridge>` on the same top-level origin, in the same tab, so
the surface app can resume the flow).

`oauth-mode` is honored as configured. Some environments cannot open popups at
all — in-app webviews on mobile, or a browser where the user has disabled
them — and today a blocked popup surfaces as `straddleerror`; the surface app does
not switch modes on its own. A popup-to-redirect fallback is planned but not
yet shipped, so supplying a return URL when you create the session, even if you
use popups, is recommended as future-proofing: sessions that already carry one
will pick up the fallback without an integration change.

**The return URL is not a page attribute.** Your backend passes it as
`redirect_url` when it creates the Bridge session, and the issuer binds it into
the session token as a `redirect_url` claim. Straddle derives the bank's return
address from that claim on the server, so nothing on your page — and nothing
inside the iframe — can substitute another. The element neither reads the token
nor forwards a return URL; `STRADDLE_INIT` options carry `oauth_mode` only.

- `oauth-mode` is read and validated once, when the element connects; changing
  it afterwards has no effect until the element is reconnected. Its error, like
  the `mode` one, is dispatched synchronously while the element connects, so
  attach your `straddleerror` listener before the element is inserted, or
  listen on an ancestor (the event bubbles).
- `oauth_mode` reaches the surface app as `options` in `STRADDLE_INIT` (see the
  exported `BridgeInitOptions` type). The surface app requests the actual
  navigation with the runtime's `STRADDLE_REDIRECT` message, which the element
  honors only for HTTPS URLs.
- Parent bundles published before `STRADDLE_REDIRECT` existed never send
  `options` and silently drop redirect requests, so the surface app treats a
  missing `options` key as "popup only, no fallback".

### Events

Re-dispatched from the runtime as bubbling `CustomEvent`s. The `detail` shapes
are exported as types, and `StraddleBridgeElement` carries typed
`addEventListener` / `removeEventListener` overloads for them, so listeners
narrow `event.detail` without casts:

| Event              | `event.detail`      | Detail type              |
| ------------------ | ------------------- | ------------------------ |
| `straddleready`    | (empty)             | `StraddleReadyDetail`    |
| `straddlecomplete` | `{ data? }`         | `StraddleCompleteDetail` |
| `straddleexit`     | `{ reason? }`       | `StraddleExitDetail`     |
| `straddleerror`    | `{ code, message }` | `StraddleErrorDetail`    |

```ts
import type { StraddleErrorCode } from '@straddlecom/straddle-js'

const el = document.querySelector('straddle-bridge')!
el.addEventListener('straddleerror', (e) => {
  const code: StraddleErrorCode = e.detail.code // 'INVALID_TOKEN' | ... | 'INTERNAL'
  console.error(code, e.detail.message)
})
el.addEventListener('straddlecomplete', (e) => console.log(e.detail.data))
```

The typing is scoped to the element (`StraddleBridgeEventMap`): the global
`HTMLElementEventMap` is not augmented, so a listener on an ancestor still
receives a plain `Event` and narrows it itself. See
[`@straddlecom/runtime-client`](../runtime-client) for the full protocol.

### The surface side

The page served at the surface origin's `/bridge` route is Straddle's hosted
Bridge app, which starts the handshake at boot. The element never messages first; a surface that doesn't announce itself gets no
`STRADDLE_INIT`, and after 10s the element dispatches `straddleerror`
(`code: "INTERNAL"`, "surface did not become ready").

## Loading from the CDN

Straddle hosts the bundle, so you can load it with a script tag instead of
serving it yourself. Pin the full version with its Subresource Integrity
(**SRI**) hash:

```html
<script
  src="https://cdn.straddle.com/surface/straddle-1.0.0.js"
  integrity="sha384-..."
  crossorigin="anonymous"
></script>
```

Pinned files never change and are cached for a year. Each GitHub release lists
the `sha384-` hashes of that version's `straddle-X.Y.Z.js` and
`straddle-X.Y.Z.esm.js`.

To take every release of a major version without redeploying, use the major
alias `straddle-v1.js`. It follows the latest 1.x release and is cached for 5
minutes. Its content changes, so it can't carry an SRI hash. There's no
`latest` alias, so a page never moves to a new major version on its own. For
`import` instead of a script tag, use the ESM variants `straddle-1.0.0.esm.js`
and `straddle-v1.esm.js`.

## Package layout

Published to npm as a self-contained package — the workspace dependencies
(`runtime-client`, `runtime-core`) are inlined by the bundler, so the published
package has no runtime dependencies.

| Artifact           | Consumed via                                               |
| ------------------ | ---------------------------------------------------------- |
| `dist/straddle.js` | `<script src>` — standalone self-registering IIFE          |
| `dist/index.js`    | `import '@straddlecom/straddle-js'` — ESM for bundlers     |
| `types/index.d.ts` | Handwritten public types (see below)                       |
| `types/react.d.ts` | Opt-in React JSX typing (`@straddlecom/straddle-js/react`) |
| `dist/react.js`    | Empty module backing that types entry (see below)          |

Importing the ESM entry registers the element as a side effect
(`sideEffects: true` — do not mark this package tree-shakeable).

## Types

The published declaration (`types/index.d.ts`) is handwritten with the class
hierarchy flattened to `HTMLElement` (the runtime packages are bundled, not
depended on). Besides `StraddleBridgeElement` it declares `STRADDLE_MODES` and
`StraddleMode` (the accepted `mode` values, owned by runtime-client),
`BRIDGE_OAUTH_MODES`
(the accepted `oauth-mode` values), the `BridgeOAuthMode` /
`BridgeInitOptions` types for the `options` forwarded in `STRADDLE_INIT`, and
the event types (`StraddleBridgeEventMap`, the four `Straddle*Detail` shapes,
`StraddleErrorCode`). The Bridge vocabulary is owned by
[`@straddlecom/surface-contracts`](../surface-contracts) (`/bridge` entry),
which the element imports and which the Bridge surface app shares; it is bundled
into straddle-js like runtime-client (a workspace devDependency, so the
published package keeps zero runtime dependencies and self-contained types)
and re-exported unchanged from this package's entry. `types/api-check.ts` is a
compile-time guard: if the declared public surface — the public members of the
element, the two modes tuples, the init options type (checked against
surface-contracts), or the event map and detail types — drifts from the
implementation, `bun run typecheck` fails; `types/events.type-test.ts` pins
the listener overloads at call sites, since overload sets are invisible to
that guard.

Those programs resolve as `bundler` with `skipLibCheck` on, which cannot see
faults that only a consumer's compiler hits — an extensionless relative
specifier in a shipped `.d.ts` is an error under `node16`/`nodenext` and, with
`skipLibCheck` on (the default in most React templates), no error at all: the
import resolves to `any` and everything reached through it silently stops
being typed. `tsconfig.declarations.json` closes that gap by compiling the
shipped declarations under Node resolution with `skipLibCheck` off, and
`typecheck` runs it.

### React / JSX (opt-in)

The main entry ships no JSX types, so plain-JS and non-React TypeScript
consumers see nothing JSX-related. React consumers opt in to typed
`<straddle-bridge>` props through the `@straddlecom/straddle-js/react` types
entry — a triple-slash directive in any module, or tsconfig
`compilerOptions.types`:

```tsx
/// <reference types="@straddlecom/straddle-js/react" />
import { useEffect, useRef } from 'react'
import '@straddlecom/straddle-js'
import type {
  StraddleBridgeElement,
  StraddleErrorDetail,
} from '@straddlecom/straddle-js'

function Bridge({ token }: { token: string }) {
  const ref = useRef<StraddleBridgeElement>(null)
  useEffect(() => {
    const el = ref.current!
    const onError = (e: CustomEvent<StraddleErrorDetail>) =>
      console.error(e.detail.code)
    el.addEventListener('straddleerror', onError)
    return () => el.removeEventListener('straddleerror', onError)
  }, [])
  return (
    <straddle-bridge
      ref={ref}
      mode="sandbox"
      token={token}
      oauth-mode="popup"
    />
  )
}
```

It types `mode` (required, as `StraddleMode`), `token` and `oauth-mode`
(both optional; `oauth-mode` as `BridgeOAuthMode`) on top of React's standard
HTML props,
and the `ref` resolves to `StraddleBridgeElement`. It requires `@types/react`
and augments both `React.JSX` (React 18.2+/19) and the legacy global `JSX`
namespace. Events are not JSX props — React does not bind listeners for custom
events — so attach them via the ref, as above.

The entry carries no behavior, so a `reference` is the intended way to enable
it — but `import '@straddlecom/straddle-js/react'` is the first thing most
people try, so the subpath also resolves to an empty module (`dist/react.js`)
and that import is a harmless no-op. Declaring only the `types` condition
would let it type-check clean and then throw at runtime in both Node and Bun.
Either way, import `@straddlecom/straddle-js` itself to register the element.
For consumers on a Node10-style resolver, which ignores `exports`,
`typesVersions` maps the same subpath.

## Development

```bash
bun install        # from the repo root
bun run typecheck  # tsc --noEmit
bun run test       # bun test (DOM via happy-dom preload)
bun run build      # emit dist/straddle.js (IIFE) and dist/index.js (ESM)
```

For a runnable two-origin demo, see
[`examples/straddle-js`](../../examples/straddle-js).
