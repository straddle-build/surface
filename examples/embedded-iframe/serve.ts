// Serves the parent demo (5173) and the stub iframe app (5174) on two origins so
// the runtime's origin validation is genuinely exercised. Bundles the TS entries
// with Bun.build at startup; nothing is written to disk.
import { join } from 'node:path'
import { bundle } from './build'

const DIR = import.meta.dir

function serve(
  port: number,
  html: string,
  jsRoute: string,
  js: string,
  label: string,
) {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/' || url.pathname === '/index.html') {
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
  console.log(`${label} → http://localhost:${port}`)
}

const [demoJs, iframeJs, parentHtml, iframeHtml] = await Promise.all([
  bundle('demo-element.ts'),
  bundle('iframe-app.ts'),
  Bun.file(join(DIR, 'parent.html')).text(),
  Bun.file(join(DIR, 'iframe-app.html')).text(),
])

serve(5173, parentHtml, '/demo-element.js', demoJs, 'parent')
serve(5174, iframeHtml, '/iframe-app.js', iframeJs, 'iframe app')
console.log('\nOpen http://localhost:5173')
