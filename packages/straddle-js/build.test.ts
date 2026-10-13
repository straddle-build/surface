import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, bundle } from './build'
import { version } from './package.json'

const PAGE_SETUP = `
const { GlobalRegistrator } = await import('@happy-dom/global-registrator')
GlobalRegistrator.register({
  url: 'https://partner.example',
  settings: { navigation: { disableChildFrameNavigation: true } },
})
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const bundles = JSON.parse(await Bun.stdin.text())
const load = (code) => (0, eval)(code)
`

async function inFreshPage(bundles: string[], script: string) {
  const page = Bun.spawn(
    [process.execPath, '-e', `${PAGE_SETUP}${script}\nprocess.exit(0)`],
    { cwd: import.meta.dir, stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
  )
  page.stdin.write(JSON.stringify(bundles))
  page.stdin.end()
  return JSON.parse(await new Response(page.stdout).text())
}

function mountBridge(code: string, attributes: Record<string, string>) {
  return inFreshPage(
    [code],
    `
load(bundles[0])
const el = document.createElement('straddle-bridge')
for (const [name, value] of Object.entries(${JSON.stringify(attributes)})) {
  el.setAttribute(name, value)
}
const errors = []
el.addEventListener('straddleerror', (e) => errors.push(e.detail.message))
document.body.append(el)
await new Promise((resolve) => setTimeout(resolve, 0))
console.log(
  JSON.stringify({
    src: el.querySelector('iframe')?.getAttribute('src') ?? null,
    errors,
  }),
)
`,
  )
}

async function publishedBundles() {
  const outDir = await mkdtemp(join(tmpdir(), 'straddle-js-published-'))
  try {
    await build(outDir)
    return {
      iife: await Bun.file(join(outDir, 'straddle.js')).text(),
      esm: await Bun.file(join(outDir, 'index.js')).text(),
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

test('a published build mounts on the mode origin and ignores iframe-origin', async () => {
  const { iife } = await publishedBundles()

  const page = await mountBridge(iife, {
    mode: 'sandbox',
    'iframe-origin': 'http://localhost:5374',
    token: 'dev-token',
  })

  expect(page.errors).toEqual([])
  expect(page.src).toStartWith(
    'https://surface-sandbox.straddle.com/bridge#sid=',
  )
})

test('a published build refuses to mount from iframe-origin without mode', async () => {
  const { iife } = await publishedBundles()

  const page = await mountBridge(iife, {
    'iframe-origin': 'http://localhost:5374',
    token: 'dev-token',
  })

  expect(page.src).toBeNull()
  expect(page.errors).toEqual([
    'straddle-bridge requires a "mode" attribute: "sandbox" or "production"',
  ])
})

test('the published bundles never mention iframe-origin', async () => {
  const { iife, esm } = await publishedBundles()

  expect(iife.includes('iframe-origin')).toBe(false)
  expect(esm.includes('iframe-origin')).toBe(false)
})

test('a dev build mounts on iframe-origin', async () => {
  const page = await mountBridge(await bundle(), {
    'iframe-origin': 'http://localhost:5374',
    token: 'dev-token',
  })

  expect(page.errors).toEqual([])
  expect(page.src).toStartWith('http://localhost:5374/bridge#sid=')
})

function registerBridge(code: string, earlierRegistration: string) {
  return inFreshPage(
    [code],
    `
const warnings = []
console.warn = (...args) => warnings.push(args.join(' '))
${earlierRegistration}
load(bundles[0])
console.log(
  JSON.stringify({
    warnings,
    registeredVersion: customElements.get('straddle-bridge').version,
  }),
)
`,
  )
}

test('loading straddle-js after another version warns once and keeps the first registration', async () => {
  const page = await registerBridge(
    await bundle(),
    `customElements.define(
  'straddle-bridge',
  class extends HTMLElement {
    static version = '0.0.1'
  },
)`,
  )

  expect(page.warnings).toEqual([
    `<straddle-bridge> is already registered by straddle-js 0.0.1, so straddle-js ${version} did not register it. Load one copy of straddle-js per page.`,
  ])
  expect(page.registeredVersion).toBe('0.0.1')
})

test('loading the same version of straddle-js twice stays silent', async () => {
  const page = await registerBridge(await bundle(), 'load(bundles[0])')

  expect(page.warnings).toEqual([])
  expect(page.registeredVersion).toBe(version)
})

test('bundles to a self-registering IIFE', async () => {
  const code = await bundle()
  // Standalone script, not a module — no top-level import/export statements
  // (deliberately not asserting Bun's exact IIFE wrapper text)
  expect(code).not.toMatch(/^import\b/m)
  expect(code).not.toMatch(/^export\b/m)
  expect(code).toContain('customElements.define') // self-registers
  expect(code).toContain('straddle-bridge') // the tag name
  expect(code).toContain('"https://surface-sandbox.straddle.com"')
  expect(code).toContain('"https://surface.straddle.com"')
})

test('build() emits the publishable bundles', async () => {
  // Build into a temp dir so the test never clobbers the package's real dist/
  const outDir = await mkdtemp(join(tmpdir(), 'straddle-js-build-'))
  try {
    await build(outDir)

    const iife = await Bun.file(join(outDir, 'straddle.js')).text()
    expect(iife).toContain('customElements.define')
    expect(iife).not.toMatch(/^import\b/m) // script-tag bundle, not a module
    expect(iife).not.toMatch(/^export\b/m)

    const esm = await Bun.file(join(outDir, 'index.js')).text()
    expect(esm).toContain('export') // module entry for bundler consumers
    expect(esm).toContain('customElements.define') // still self-registers on import
    expect(esm).toContain('StraddleBridgeElement')

    // The published package has zero runtime deps: the workspace runtime must
    // be inlined, never left as an import of a package that isn't bundled.
    expect(iife).not.toContain('@straddlecom/runtime-client')
    expect(esm).not.toContain('@straddlecom/runtime-client')

    // The `./react` types entry needs a `default` condition pointing at a real
    // file: without one, `import '@straddlecom/straddle-js/react'` type-checks
    // clean and then throws (Node ERR_PACKAGE_PATH_NOT_EXPORTED, Bun "Cannot
    // find module"). This stub makes that import a no-op instead of a crash.
    const react = await Bun.file(join(outDir, 'react.js')).text()
    expect(react).toContain('export {}') // a module, so it loads as ESM
    expect(react).not.toContain('customElements.define') // registers nothing
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('every export condition resolves to a file the build emits', async () => {
  // A condition pointing at a file that is never built resolves at type-check
  // time and throws at runtime, which is exactly how the types-only `./react`
  // entry broke. Keep the exports map and the build in step.
  const outDir = await mkdtemp(join(tmpdir(), 'straddle-js-exports-'))
  try {
    await build(outDir)
    const manifest = await Bun.file(
      join(import.meta.dir, 'package.json'),
    ).json()
    const targets = Object.values(manifest.exports)
      .flatMap((entry) =>
        typeof entry === 'string'
          ? [entry]
          : Object.values(entry as Record<string, string>),
      )
      .filter((target) => target.startsWith('./dist/'))
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      const built = join(outDir, target.replace('./dist/', ''))
      expect(await Bun.file(built).exists()).toBe(true)
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
