# @straddlecom/surface-contracts

Per-surface init-option vocabularies, shared by the element that embeds a
surface and the app that runs inside it. One subpath entry per surface; there
is deliberately no root entry, so a consumer names the surface it speaks to.

> **Internal package.** Internal to Straddle's SDKs and not for direct use.
> Integrate with [`@straddlecom/straddle-js`](../straddle-js) instead. It
> publishes `restricted` with `0.x` versioning and holds pure types plus the
> const arrays runtime validation needs, with no behavior and no runtime
> imports. The generic runtime packages never import it; only concrete
> elements and surface apps do.

## Entries

| Entry                                   | Exports                                                      | Consumers                                                    |
| --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `@straddlecom/surface-contracts/bridge` | `BRIDGE_OAUTH_MODES`, `BridgeOAuthMode`, `BridgeInitOptions` | `<straddle-bridge>` (straddle-js) and the Bridge surface app |

## Usage

Parent side — the element pins its base class to the contract:

```ts
import { StraddleComponentElement } from '@straddlecom/runtime-client'
import type { BridgeInitOptions } from '@straddlecom/surface-contracts/bridge'

class StraddleBridgeElement extends StraddleComponentElement<BridgeInitOptions> {
  protected get initOptions(): BridgeInitOptions | undefined {
    /* validated attributes */
  }
}
```

Surface side: Straddle's hosted surface app imports the same contract to type
and validate the options it receives.

A rename in a contract now fails both builds instead of drifting silently on
the wire.

## Publishing

Published to npm as `@straddlecom/surface-contracts` (restricted, 0.x) with no
dependencies. `prepack` emits `dist/` (JS + declarations) with tsc; the
in-repo manifest exports raw `src/` directly, so dev flows never need a build.
The src exports are dev-only and must not ship: the publish workflow runs
`bun ../../scripts/publish-manifest.ts strip` before publishing — `prepack`
refuses to pack a manifest that still carries them.
