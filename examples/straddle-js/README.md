# straddle-js demo

Consumes the real `straddle.js` IIFE exactly as a partner would: a `<script>`
tag plus a declarative `<straddle-bridge>` element, against a stub bridge
surface on a second origin.

```bash
bun run dev:straddle-js   # from the repo root
```

Open http://localhost:5373. The host page (5373) loads `/straddle.js` (bundled
in memory from `packages/straddle-js`) and mounts
`<straddle-bridge iframe-origin="http://localhost:5374" token="dev-token-abc">`.
`iframe-origin` is the development override that stands in for `mode`.
The demo serves a dev build of `straddle.js`, which honors it; published builds
ignore it. It lets the demo target the stub surface on :5374. The element
mounts its iframe at `http://localhost:5374/bridge#sid=<id>` — the
surface is served only at `/bridge`; the origin root 404s so a wrong-path
regression is loud.

The stub surface completes the handshake via `createSurfaceRuntime`
(STRADDLE_HELLO → INIT → READY), then its three buttons drive
`straddlecomplete` / `straddleexit` / `straddleerror`, all appended to the
host page's lifecycle log along with `straddleready`.

Manual error path: remove the `iframe-origin` attribute from `host.html` and
reload — with no `mode` either, the element immediately logs `straddleerror`
(`code: "INTERNAL"`, `straddle-bridge requires a "mode" attribute`) and never
mounts the iframe.

`build.ts` is the CI compile guard: it bundles `surface.ts` and the real
`straddle.js` without writing to disk.
