import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../packages/straddle-js/build'

const [straddleJsPath] = await build(join(tmpdir(), 'straddle-js-demo'))
const [straddleJs, hostHtml] = await Promise.all([
  Bun.file(straddleJsPath).text(),
  Bun.file(join(import.meta.dir, 'host.html')).text(),
])

Bun.serve({
  port: 5373,
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === '/') {
      return new Response(hostHtml, {
        headers: { 'content-type': 'text/html' },
      })
    }
    if (pathname === '/straddle.js') {
      return new Response(straddleJs, {
        headers: { 'content-type': 'text/javascript' },
      })
    }
    return new Response('not found', { status: 404 })
  },
})

console.log('Open http://localhost:5373')
