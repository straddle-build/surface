// Bundles the demo's TS entrypoints with Bun.build. Imported by serve.ts to
// build the served JS, and runnable directly (`bun run build.ts`) as a CI check
// that compilation succeeds. It also bundles the real straddle.js (via
// straddle-js's own bundle()), so this example guards that the published
// bundle still compiles. Writes nothing to disk, exits non-zero on failure.
import { join } from 'node:path'
import { bundle as bundleStraddleJs } from '../../packages/straddle-js/build'

const DIR = import.meta.dir
export const ENTRYPOINTS = ['surface.ts'] as const

export async function bundle(entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(DIR, entry)],
    target: 'browser',
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`bundle failed: ${entry}`)
  }
  return await result.outputs[0].text()
}

if (import.meta.main) {
  await Promise.all([...ENTRYPOINTS.map(bundle), bundleStraddleJs()])
  console.log('✓ straddle-js demo entrypoints bundled (including straddle.js)')
}
