# AGENTS.md

## Overview

Surface is Straddle's browser SDK: Web Components that mount Straddle's hosted
apps, called surfaces, in an iframe on a partner's page. This repository is
public, and partners consume its published packages.

It's a Bun workspace monorepo with four packages:

- `packages/straddle-js`, `@straddlecom/straddle-js`: the partner-facing
  package. Ships `<straddle-bridge>` as a standalone self-registering IIFE
  (`dist/straddle.js`) plus an ESM entry (`dist/index.js`). It bundles
  runtime-client and surface-contracts (workspace devDependencies), so the
  published package has no runtime dependencies and handwritten types in
  `types/index.d.ts`. `types/api-check.ts` fails typecheck when those types
  drift from the implementation. Opt-in React JSX types live at
  `@straddlecom/straddle-js/react`.
- `packages/runtime-core`, `@straddlecom/runtime-core`: the shared protocol,
  message bus, and handshake timeout. Subpath exports `./protocol` and
  `./message-bus`.
- `packages/runtime-client`, `@straddlecom/runtime-client`: the page side.
  `StraddleComponentElement` (origin selection from `mode`, iframe mount,
  handshake, resize, and DOM events) and `mountIframe`.
- `packages/surface-contracts`, `@straddlecom/surface-contracts`: the
  init-option vocabulary of each surface, one subpath per surface (`./bridge`)
  and no root entry. Types and const arrays only.

The three runtime and contract packages are internal to Straddle's SDKs.
runtime-client takes a `TOptions` type parameter for the surface-defined init
options and never imports surface-contracts itself; only concrete elements and
surface apps do.

## Commands

```bash
# Install
bun install

# Format, or check formatting
bun run format
bun run format:check

# Typecheck and test every package
bun run typecheck
bun run test

# Build straddle-js's publishable dist (IIFE + ESM)
bun run --filter '@straddlecom/straddle-js' build

# Run the straddle-js demo (the straddle.js bundle as a partner loads it)
bun run dev:straddle-js
```

## Conventions

- **Package manager:** Bun 1.2.18 or later. CI runs the version that
  `packageManager` in the root `package.json` pins. Don't use npm, yarn, or
  pnpm. The one exception is the CI publish step, which runs `npm publish`
  because `bun publish` can't do npm trusted publishing (oven-sh/bun#22423).
- **Formatting:** Prettier with no semicolons, single quotes, and trailing
  commas.
- **TypeScript:** strict mode. Each package extends `tsconfig.base.json`.
- **Testing:** the Bun test runner, with a happy-dom preload per package.
  Type-level tests end in `.type-test.ts` and run under `tsc`, not `bun test`.
- **Bundle tests:** `build.test.ts` loads each built bundle in a fresh `bun`
  subprocess. happy-dom can't evaluate scripts under Bun, and a custom element
  registry accepts a tag only once, so two bundles can't share a process.
- **Public repository:** never commit secrets, tokens, internal URLs, or
  ticket references, in code, commit messages, or PR text.

## Naming

Use the following names:

- **Surface** names the system: the shared runtime, the app origins
  (`surface.straddle.com`, `surface-sandbox.straddle.com`), and the CDN path
  (`/surface/`).
- **straddle** prefixes partner-facing names: the straddle-js package and its
  `straddle.js` bundle, elements (`<straddle-bridge>`), events
  (`straddleready`), and exports (`STRADDLE_MODES`, `StraddleMode`).
- **embed** stays out of names. The plain English verb is fine in prose.

## App origins and `iframe-origin`

The `mode` attribute (`sandbox` or `production`) picks the app origin from
`APP_ORIGINS` in `packages/runtime-client/src/component-base.ts`. The
`iframe-origin` attribute is a development override that points a dev build at
any other origin, such as a local stack. Published builds ignore it:
`build()` in `packages/straddle-js/build.ts` defines
`STRADDLE_IFRAME_ORIGIN_OVERRIDE` as `false`, so the bundler drops the
override and the attribute name. `bundle()`, the examples, and the tests leave
the constant undefined and honor the override.

## Publishing

straddle-js is the only package this repository publishes today:

- Versions are set before code reaches this repository. Each release arrives
  as a PR titled with the packages it releases, such as
  `Release straddle-js 1.0.0`, and merging it is the human gate. Only stable
  versions are released here: `publish-package.yml` refuses a prerelease such
  as `1.1.0-preview.0`.
- On each push to `main`, `publish.yml` runs `publish-package.yml` for each
  package in its `package` matrix, which publishes the package when its
  version isn't on npm yet. The `build` job reruns format, typecheck, and test
  and packs the tarball without npm credentials. The `publish` job runs
  `npm publish` on that tarball with npm trusted publishing (OIDC, no token
  secret), in an `npm` environment that only accepts `main`. The `release` job
  tags `<package>-vX.Y.Z`, such as `straddle-js-v1.0.0`, and lists the SHA-384
  SRI hash of each `dist/*.js` file on the GitHub release.
- To publish another package from here, add its directory to that matrix and
  register its npm trusted publisher (`publish.yml`, `npm` environment). npm
  can only attach a trusted publisher to a package that already exists, so a
  new package's first version is published by hand.
- runtime-core, runtime-client, and surface-contracts are published to npm as
  `restricted` packages, outside this repository.
- No `dist/` is ever committed, and dev flows never need one. The runtime
  packages export raw `src/` and depend on each other with `workspace:`
  ranges. Before publishing, `scripts/publish-manifest.ts strip` rewrites each
  export to its tsc-emitted `dist/` pair and each `workspace:` range to the
  sibling's released version. Each runtime package's `prepack` runs `assert`,
  so a raw pack fails instead of publishing a dev manifest.
- straddle-js builds with `Bun.build` in `prepack` and bundles the runtime
  packages, so they never need to be published first.
- Each element class carries a static `version`, read from its
  `package.json` at build time. A second copy of a different version that
  finds its tag taken logs one console warning and keeps the first
  registration.

## Architecture

```
@straddlecom/straddle-js (<straddle-bridge> as a standalone bundle)
  ├─ bundles @straddlecom/runtime-client
  └─ bundles @straddlecom/surface-contracts/bridge

@straddlecom/runtime-client (page side)
  └─ depends on @straddlecom/runtime-core

@straddlecom/surface-contracts (per-surface init options)
  └─ no dependencies
```

Straddle's hosted surface apps run the iframe side of the protocol and share
`@straddlecom/surface-contracts` with the elements, so a vocabulary change fails
both builds instead of drifting on the wire.

`examples/straddle-js` (the `straddle.js` bundle as a partner loads it) is a
runnable demo. CI type-checks it and builds `straddle.js` as published.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
