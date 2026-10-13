// Serves the host page (5373) and the stub bridge surface (5374) on two
// origins so the runtime's origin validation is genuinely exercised. The host
// origin serves the real straddle.js IIFE — obtained from straddle-js's own
// bundle() — exactly as a partner would load it. The surface is served at the
// fixed /bridge route (the element mounts `${origin}/bridge#sid=...`); its
// root deliberately 404s so a wrong-path regression fails loudly. Everything
// is bundled in memory at startup; nothing is written to disk.
import { join } from 'node:path'
import { bundle } from './build'
import { bundle as bundleStraddleJs } from '../../packages/straddle-js/build'

const DIR = import.meta.dir

function serve(
  port: number,
  htmlRoute: string,
  html: string,
  jsRoute: string,
  js: string,
  label: string,
) {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === htmlRoute) {
        return new Response(html, { headers: { 'content-type': 'text/html' } })
      }
      if (url.pathname === jsRoute) {
        return new Response(js, {
          headers: { 'content-type': 'text/javascript' },
        })
      }
      return new Response('not found', { status: 404 })
    },
  })
  console.log(`${label} → http://localhost:${port}${htmlRoute}`)
}

const [straddleJs, surfaceJs, hostHtml, surfaceHtml] = await Promise.all([
  bundleStraddleJs(),
  bundle('surface.ts'),
  Bun.file(join(DIR, 'host.html')).text(),
  Bun.file(join(DIR, 'surface.html')).text(),
])

serve(5373, '/', hostHtml, '/straddle.js', straddleJs, 'host')
serve(5374, '/bridge', surfaceHtml, '/surface.js', surfaceJs, 'surface')
console.log('\nOpen http://localhost:5373')
