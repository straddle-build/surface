// Builds straddle-js's two publishable artifacts from the same entrypoint:
//   dist/straddle.js — standalone, self-registering IIFE a host page loads via
//                      a <script> tag (workspace deps inlined)
//   dist/index.js    — ESM module for bundler consumers (same self-registration
//                      side effect on import)
//   dist/react.js    — empty module backing the types-only `./react` entry, so
//                      `import '@straddlecom/straddle-js/react'` cannot throw
// `bundle()` returns the IIFE text without touching disk (used by the example
// server and tests); `bun run build.ts` writes both files to dist/.
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = import.meta.dir

async function bundleAs(
  format: 'iife' | 'esm',
  published: boolean,
): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(DIR, 'src/index.ts')],
    target: 'browser',
    format,
    define: published ? { STRADDLE_IFRAME_ORIGIN_OVERRIDE: 'false' } : {},
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`straddle-js ${format} bundle failed: src/index.ts`)
  }
  return await result.outputs[0].text()
}

export async function bundle(): Promise<string> {
  return bundleAs('iife', false)
}

// The `./react` subpath exists to carry JSX types. A types-only export
// condition type-checks clean and then throws at runtime (verified: Node
// ERR_PACKAGE_PATH_NOT_EXPORTED, Bun "Cannot find module"), and a side-effect
// import is the first thing most people try. This empty module is the `default`
// condition so that import is a harmless no-op instead of a crash.
export const REACT_STUB = `// @straddlecom/straddle-js/react is a types-only entry: it augments React's
// JSX namespace with <straddle-bridge>. There is nothing to run at runtime —
// this module exists so importing the entry resolves instead of throwing.
// Import '@straddlecom/straddle-js' itself to register the element.
export {}
`

export async function build(
  outDir: string = join(DIR, 'dist'),
): Promise<string[]> {
  const [iife, esm] = await Promise.all([
    bundleAs('iife', true),
    bundleAs('esm', true),
  ])
  // Empty the output dir first — `files` in package.json packs the whole
  // directory, so anything stale left here would ship in the published tarball.
  await rm(outDir, { recursive: true, force: true })
  const files: Array<[string, string]> = [
    [join(outDir, 'straddle.js'), iife],
    [join(outDir, 'index.js'), esm],
    [join(outDir, 'react.js'), REACT_STUB],
  ]
  await Promise.all(files.map(([path, code]) => Bun.write(path, code)))
  return files.map(([path]) => path)
}

if (import.meta.main) {
  for (const path of await build()) console.log(path)
}
