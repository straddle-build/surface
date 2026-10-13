# embedded-iframe demo

A runnable, two-origin demo of the surface runtime. It wires a parent page
(hosting a `StraddleComponentElement` subclass) to a stub embedded surface
running on a **different origin**, so the runtime's `postMessage` protocol and
origin validation are exercised end to end — not stubbed out.

> This complements [`examples/straddle-js`](../straddle-js), which consumes
> the published `straddle.js` bundle as-is instead of subclassing the base
> class. This demo is the deeper origin-enforcement and dynamic-resize
> walkthrough.

## What's here

| File              | Role                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `serve.ts`        | Dev server. Bundles the TS entries with `Bun.build` in memory and serves two origins.      |
| `parent.html`     | Parent page served on `:5173`. Hosts `<straddle-demo>` and logs lifecycle events.          |
| `demo-element.ts` | Defines `<straddle-demo>` by extending `StraddleComponentElement`; pins the iframe origin. |
| `iframe-app.html` | The embedded surface served on `:5174`, with Complete / Exit / Error buttons.              |
| `iframe-app.ts`   | Stub surface app built on `createSurfaceRuntime` (`@straddlecom/runtime-surface`).         |

The two pages talk over the runtime's `postMessage` envelope protocol. The app
drives the handshake: the parent shares its `instanceId` with the iframe via the
URL hash (`#sid=<id>`), the app announces readiness with `STRADDLE_HELLO` (and
resends until acked), and the parent answers each HELLO with `STRADDLE_INIT`:

```
parent (:5173)                          iframe app (:5174)
  build src .../#sid=<id>; listen
  <straddle-demo>  ─────────────────▶  (boots, maybe async; reads #sid)
                   ◀──STRADDLE_HELLO──   install listener; send HELLO (resend until INIT)
  (gate passes: id matches)
                   ──STRADDLE_INIT───▶  (validates parent origin + id) → stop HELLO
                   ◀──STRADDLE_READY──   onInit(token) resolved → READY
                   ──STRADDLE_RESIZE─▶  (current host size, once)
                   ◀──STRADDLE_HEIGHT──  reply with measured height
  (click Complete) ◀──STRADDLE_COMPLETE
  (click Exit)     ◀──STRADDLE_EXIT
  (click Error)    ◀──STRADDLE_ERROR
```

Each message the parent receives is re-dispatched as a DOM event
(`straddleready`, `straddlecomplete`, `straddleexit`, `straddleerror`) and
appended to the on-page lifecycle log.

## Run it

From the repo root:

```bash
bun install        # once
bun run dev:examples
```

Then open **http://localhost:5173**.

You should see:

1. The parent page with an embedded "Embedded surface (stub)" iframe.
2. The iframe status flips from `waiting for STRADDLE_INIT…` to
   `INIT received (token: dev-token-abc) — sent READY`.
3. A `straddleready` line in the **Lifecycle log** on the parent.

The app drives the handshake, so _when_ the surface boots doesn't matter: the
parent is listening from before the iframe is appended, and the surface only
announces itself once its own listener is installed. To convince yourself,
wrap the `createSurfaceRuntime(...)` call in `iframe-app.ts` in a
`setTimeout(..., 1500)` to model a slow config fetch or hydration — the
handshake still converges, just later.

## How the handshake converges

The obvious alternative — the parent sends `STRADDLE_INIT` on the iframe
element's `load` event — deadlocks: it assumes the app is already listening by
`load`, true only for a synchronous subscriber. A realistic surface subscribes
asynchronously (after a config fetch or hydration), so its listener lands in a
later task than `load`, INIT arrives with no listener, the browser drops it, and
the handshake sticks silently.

So the trigger is reversed: the **app announces readiness**. The parent shares
its `instanceId` via the iframe URL hash (`#sid=<id>`); the surface runtime reads
it at creation, installs its listener, and sends `STRADDLE_HELLO` — **resending
on a timer until INIT arrives** (every 200ms). The parent answers every HELLO
with INIT, so a HELLO or INIT lost in flight is recovered on the next tick. INIT
is the ack; the runtime stops resending once it lands.

All of that lives in `createSurfaceRuntime` (`@straddlecom/runtime-surface`),
so `iframe-app.ts` contains none of it — a surface app supplies `onInit` and
surface-specific behavior, and cannot reintroduce the race by subscribing late.

Both sides give up on the same budget, `HANDSHAKE_TIMEOUT_MS` (10s, shared via
`@straddlecom/runtime-core` so the two can't drift): the surface stops
announcing, and the parent's mount timeout dispatches `straddleerror`
(`code: INTERNAL`) if no `STRADDLE_READY` arrived — the partner-facing signal
for a genuinely stuck surface.

## Test it manually

Click the buttons inside the embedded iframe and watch the parent's lifecycle log:

| Button       | Message sent        | Log line on parent                                         |
| ------------ | ------------------- | ---------------------------------------------------------- |
| **Complete** | `STRADDLE_COMPLETE` | `straddlecomplete {"data":{"demo":true}}`                  |
| **Exit**     | `STRADDLE_EXIT`     | `straddleexit {"reason":"user_cancelled"}`                 |
| **Error**    | `STRADDLE_ERROR`    | `straddleerror {"code":"INTERNAL","message":"demo error"}` |

### Verifying origin enforcement

The harness intentionally uses two origins so origin pinning is real, not
theatrical:

- `iframe-app.ts` allowlists `http://localhost:5173` as its only parent origin:
  the surface runtime ignores messages from anywhere else and announces
  `STRADDLE_HELLO` only to allowlisted origins (`postMessage` delivers each one
  solely to a parent actually on that origin).
- `demo-element.ts` pins `iframeOrigin` to `http://localhost:5174`, so the
  runtime only accepts replies from that origin.

To see enforcement kick in, change `ALLOWED_PARENT_ORIGIN` in `iframe-app.ts` (or
`iframeOrigin` in `demo-element.ts`) to a different value and reload. The HELLO
now targets the wrong origin (or the parent rejects the reply), so INIT never
arrives, the iframe stays at `waiting for STRADDLE_INIT…`, and after 10s the
parent logs `straddleerror {"code":"INTERNAL","message":"surface did not become ready"}`.

## Automated tests

This folder is a manual harness. The protocol and component lifecycle have unit
coverage in the packages themselves:

```bash
bun run test    # runs every package's test suite
```

See `packages/runtime-client/src/component-base.test.ts` for the
`StraddleComponentElement` lifecycle and resize wiring tests, and
`packages/runtime-surface/src/surface-runtime.test.ts` for the surface-side
handshake tests.
