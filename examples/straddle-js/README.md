# straddle-js demo

Loads `straddle.js` the way a partner's page does: a `<script>` tag, a
`<straddle-bridge>` element in `sandbox` mode, and listeners for its four
events. The page serves the same bundle that's published to npm, built from
`packages/straddle-js`.

## Run it

From the repo root:

```bash
bun install
bun run dev:straddle-js
```

Open http://localhost:5373, paste a sandbox session token, and click
**Mount**. The token is the `client_secret` your backend gets from
`POST /v1/bridge/sessions` with your sandbox API key. See
[docs.straddle.com](https://docs.straddle.com) for creating a session.

The element connects to Straddle's sandbox and logs each event it dispatches:

| Event              | When                                        |
| ------------------ | ------------------------------------------- |
| `straddleready`    | The Bridge surface finished loading.        |
| `straddlecomplete` | The user finished the flow.                 |
| `straddleexit`     | The user left the flow.                     |
| `straddleerror`    | Something failed, such as an invalid token. |

A sandbox token only works with `mode="sandbox"`.

`build.ts` is the CI compile check: it builds `straddle.js` exactly as
published, into a temporary directory.
