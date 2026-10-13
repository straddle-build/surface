// Bundles the example's TS entrypoints with Bun.build. Imported by serve.ts to
// build the served JS, and runnable directly (`bun run build.ts`) as a CI check
// that compilation succeeds — writes nothing to disk, exits non-zero on failure.
import { join } from 'node:path'

const DIR = import.meta.dir
export const ENTRYPOINTS = ['demo-element.ts', 'iframe-app.ts'] as const

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
  await Promise.all(ENTRYPOINTS.map(bundle))
  console.log('✓ all entrypoints bundled')
}
