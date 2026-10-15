# Surface

Surface is Straddle's browser SDK. It ships Web Components that put Straddle's
hosted flows on your page with one element and a session token from your
backend.

## Packages

The following table lists the packages for partners:

| Package                                            | What it does                                                                                         | Status    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------- |
| [`@straddlecom/straddle-js`](packages/straddle-js) | Merchant-facing widgets for payments and bank account connection, starting with `<straddle-bridge>`. | Available |

`<straddle-bridge>` connects your customer's bank account to Straddle. Your
backend creates a Bridge session, your page mounts the element with the
session token, and the element reports the result as DOM events. The element
renders Straddle's hosted Bridge app in an iframe, so most fixes reach your
page without a new release on your side.

## Install

Install the package from npm:

```bash
npm install @straddlecom/straddle-js
```

Then import it once. The import registers `<straddle-bridge>`:

```ts
import '@straddlecom/straddle-js'
```

Or load the bundle from Straddle's CDN:

```html
<script src="https://cdn.straddle.com/surface/straddle-v1.js"></script>
```

`straddle-v1.js` always serves the latest 1.x release, so your page gets fixes
without a redeploy, and it never moves to a new major version on its own. To
pin an exact version with a Subresource Integrity (**SRI**) hash, see
[Loading from the CDN](packages/straddle-js/README.md#loading-from-the-cdn).

## Quickstart

Take the following steps to connect a bank account in the sandbox:

1. On your backend, create a Bridge session for an existing
   [customer](https://docs.straddle.com/api-reference/customers/create), and
   pass the session's `client_secret` to your page as the token. The
   `redirect_url` field is required and must be an absolute `https` URL. A
   platform acting for one of its accounts also sends the
   [`Straddle-Account-Id` header](https://docs.straddle.com/guides/embed/api-headers).

   ```bash
   curl -X POST https://sandbox.straddle.com/v1/bridge/sessions \
     -H "Authorization: Bearer $STRADDLE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"customer_id": "CUSTOMER_ID", "redirect_url": "https://example.com/bank-return"}'
   ```

   The response carries the token in `data.client_secret`.

2. Add the element with `mode="sandbox"` and the token:

   ```html
   <straddle-bridge mode="sandbox" token="SESSION_TOKEN"></straddle-bridge>
   ```

3. Listen for the result:

   ```ts
   const bridge = document.querySelector('straddle-bridge')!
   bridge.addEventListener('straddlecomplete', (event) => {
     console.log('connected', event.detail.data)
   })
   bridge.addEventListener('straddleerror', (event) => {
     console.error(event.detail.code, event.detail.message)
   })
   ```

   `event.detail.data` is the new paykey. Check its `status` before you
   continue, and confirm the paykey on your server before you rely on it.

4. When you go live, switch to `mode="production"` with a production session
   token.

The [straddle-js README](packages/straddle-js) covers every attribute, event,
sizing rule, OAuth navigation mode, and the React typings.

## Browser support

straddle-js runs on HTTPS pages, or on `localhost`, in browsers that support
custom elements and `crypto.randomUUID()`. Browsers expose
`crypto.randomUUID()` only in secure contexts, so on a plain-HTTP page the
element can't start and dispatches no events. The following browsers qualify:

- Chrome and Edge 92 or later
- Firefox 95 or later
- Safari 15.4 or later

## Version support

Each package follows [semantic versioning](https://semver.org). Straddle's
hosted app stays compatible with each major version for 12 months after the
next major version ships, so a pinned integration keeps working while you plan
the upgrade. Security fixes ship only in each package's latest version, as
[SECURITY.md](SECURITY.md) describes.

## Internal packages

The following packages are internal to Straddle's SDKs and not for direct use.
straddle-js bundles the ones it needs, so you never install them:

| Package                                                        | Role                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| [`@straddlecom/runtime-core`](packages/runtime-core)           | The `postMessage` protocol between a page and a surface app. |
| [`@straddlecom/runtime-client`](packages/runtime-client)       | The page side: iframe lifecycle and the element base class.  |
| [`@straddlecom/surface-contracts`](packages/surface-contracts) | The options each element sends to its surface app.           |

## Support and contributing

For integration help, see [SUPPORT.md](SUPPORT.md). To report a bug, open an
issue as described in [CONTRIBUTING.md](CONTRIBUTING.md). To report a security
vulnerability, follow [SECURITY.md](SECURITY.md). To build and test the
packages locally, see [AGENTS.md](AGENTS.md).

## License

[Apache 2.0](LICENSE)
