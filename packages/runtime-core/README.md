# @straddlecom/runtime-core

Shared surface runtime: the `postMessage` protocol contract and message bus
used by both sides of a Straddle surface (the parent page and the app inside
the iframe).

> **Internal package.** Internal to Straddle's SDKs and not for direct use.
> Integrate with [`@straddlecom/straddle-js`](../straddle-js) instead. It
> publishes `restricted` with `0.x` versioning, and
> [`@straddlecom/runtime-client`](../runtime-client) and
> [`@straddlecom/runtime-surface`](../runtime-surface) depend on it.

## What's here

The package defines the wire format for parent↔iframe communication and a small,
DOM-agnostic bus for sending and receiving it safely. There is no UI and no
iframe management — that lives in `@straddlecom/runtime-client`.

| Subpath                                 | Exports                                                                                        | Role                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@straddlecom/runtime-core`             | everything below, plus `HANDSHAKE_TIMEOUT_MS`                                                  | Barrel re-export of `./protocol`, `./message-bus`, and the shared handshake budget. |
| `@straddlecom/runtime-core/protocol`    | `PROTOCOL_VERSION`, `Envelope`, `MessageType`, payload types, `StraddleErrorCode`, `Direction` | The message contract.                                                               |
| `@straddlecom/runtime-core/message-bus` | `send`, `createListener`, `PostMessageTarget`, `ReceivedMessage`                               | Validated send/receive helpers.                                                     |

## Protocol

Every message is an `Envelope` — a discriminated union keyed on `type`.
Narrowing on `type` narrows `payload` at compile time. Each envelope carries:

- `version` — the protocol version. Receivers require an exact match against
  `PROTOCOL_VERSION`. Typed as `string` (not the literal `'1'`) so a mismatched
  message still deserializes far enough to be inspected and reported.
- `instanceId` — scopes a message to one component instance; mismatches are dropped.
- `nonce` — unique per message; presence-validated only in v1.

| Message                     | Direction       | Payload                                                                                                                      |
| --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `STRADDLE_HELLO`            | iframe → parent | (empty) — announces the app's listener is installed; resent until INIT acks                                                  |
| `STRADDLE_INIT`             | parent → iframe | `{ token, options? }` — opaque session credential plus surface-defined initialization options; the ack to every HELLO        |
| `STRADDLE_READY`            | iframe → parent | (empty) — iframe verified and live                                                                                           |
| `STRADDLE_HEIGHT`           | iframe → parent | `{ height }` — content height for the parent to apply                                                                        |
| `STRADDLE_RESIZE`           | parent → iframe | `{ width, height }` — optional size hint                                                                                     |
| `STRADDLE_COMPLETE`         | iframe → parent | `{ data? }` — flow finished; `data` is surface-defined                                                                       |
| `STRADDLE_EXIT`             | iframe → parent | `{ reason? }` — user deliberately left                                                                                       |
| `STRADDLE_REDIRECT`         | iframe → parent | `{ url }` — requests an HTTPS top-level navigation                                                                           |
| `STRADDLE_ERROR`            | iframe → parent | `{ code, message }` — a failure (not a user choice)                                                                          |
| `STRADDLE_VERSION_MISMATCH` | parent ↔ iframe | `{ ourVersion, theirVersion? }` — a protocol-version skew was detected (in v1 the parent detects it from a mismatched HELLO) |

Error codes (`StraddleErrorCode`): `INVALID_TOKEN`, `ORIGIN_MISMATCH`,
`WRONG_SURFACE`, `VERSION_MISMATCH`, `INTERNAL`.

## Message bus

```ts
import { send, createListener } from '@straddlecom/runtime-core/message-bus'

// Send: stamps version/instanceId/nonce for you. targetOrigin is required —
// passing '*' throws (origins must always be explicit).
send(
  iframeWindow,
  'https://surface.straddle.com',
  'STRADDLE_INIT',
  instanceId,
  {
    token,
  },
)

// Receive: returns a handler that drops anything failing the
// origin / shape / type / instanceId / nonce / version checks. expectedOrigin
// may be a single origin or an allowlist; the matched origin is passed to the
// handler (a surface pins the parent origin from its first valid INIT).
const listener = createListener(
  instanceId,
  expectedOrigin,
  (envelope, origin) => {
    switch (envelope.type) {
      case 'STRADDLE_READY':
        // envelope.payload is narrowed to ReadyPayload here
        break
    }
  },
)
window.addEventListener('message', listener)
```

`STRADDLE_HELLO` and `STRADDLE_VERSION_MISMATCH` deliberately bypass the version
gate in `createListener`: HELLO is the app's first contact and must reach the
parent across a version skew for the skew to be detected at all, and
`STRADDLE_VERSION_MISMATCH` is itself the version-error signal, so it must
survive the mismatch to be delivered.

## Versioning the protocol

The wire version is a single string, `PROTOCOL_VERSION`, in
`src/protocol/version.ts`. Bumping the protocol means bumping that one constant.
`message-bus.ts` carries a compile-time exhaustiveness check, so adding a new
`MessageType` will fail the build until it is registered — there are no silent
drops.

## Development

```bash
bun install        # from the repo root

bun run typecheck  # tsc --noEmit
bun run test       # bun test
```

Source layout:

```
src/
  index.ts                  # barrel: re-exports protocol + message-bus + handshake
  message-bus.ts            # send() / createListener()
  handshake.ts              # HANDSHAKE_TIMEOUT_MS (shared parent/surface budget)
  protocol/
    version.ts              # PROTOCOL_VERSION
    messages.ts             # Envelope union + payload types
    index.ts                # protocol barrel
```

## Publishing

Published to npm as `@straddlecom/runtime-core` (restricted, 0.x). `prepack`
emits `dist/` (JS + declarations) with tsc — no dist is committed, and the
in-repo manifest exports raw `src/` directly, so dev flows never need a build.
The src exports are dev-only and must not ship: the publish workflow runs
`bun ../../scripts/publish-manifest.ts strip` (rewriting each export to its
`dist/` types/default pair) before publishing — `prepack` refuses to pack a
manifest that still points at src/. `restore` puts a locally stripped
manifest back (CI checkouts are ephemeral and skip it).
