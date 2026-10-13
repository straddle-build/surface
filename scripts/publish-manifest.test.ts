import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hasSrcExport,
  publishedExports,
  rewriteWorkspaceDeps,
  workspaceVersions,
} from './publish-manifest'

const VERSIONS = {
  '@straddlecom/runtime-core': '0.1.0',
  '@straddlecom/runtime-client': '0.2.3',
}

describe('hasSrcExport', () => {
  test('detects a src-pointing entry point', () => {
    expect(hasSrcExport({ '.': './src/index.ts' })).toBe(true)
  })

  test('detects a src target nested inside a conditions object', () => {
    expect(
      hasSrcExport({
        '.': { bun: './src/index.ts', default: './dist/index.js' },
      }),
    ).toBe(true)
  })

  test('accepts a published dist-only map', () => {
    expect(
      hasSrcExport({
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './package.json': './package.json',
      }),
    ).toBe(false)
  })

  test('accepts a manifest without exports', () => {
    expect(hasSrcExport(undefined)).toBe(false)
  })

  test('detects src targets the rewriter does not handle', () => {
    // The detector must be broader than the rewrite (which only maps
    // ./src/*.ts): any src-pointing target — .tsx, .mts, extensionless —
    // must fail the assert rather than ship pointing at excluded src/.
    expect(hasSrcExport({ '.': './src/index.tsx' })).toBe(true)
    expect(hasSrcExport({ '.': './src/index.mts' })).toBe(true)
    expect(publishedExports({ '.': './src/index.tsx' })).toEqual({
      '.': './src/index.tsx',
    })
  })
})

describe('publishedExports', () => {
  test('rewrites a src entry point to the emitted types/default pair', () => {
    expect(publishedExports({ '.': './src/index.ts' })).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    })
  })

  test('rewrites subpath entries and keeps non-src values as written', () => {
    expect(
      publishedExports({
        '.': './src/index.ts',
        './protocol': './src/protocol/index.ts',
        './message-bus': './src/message-bus.ts',
        './package.json': './package.json',
      }),
    ).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './protocol': {
        types: './dist/protocol/index.d.ts',
        default: './dist/protocol/index.js',
      },
      './message-bus': {
        types: './dist/message-bus.d.ts',
        default: './dist/message-bus.js',
      },
      './package.json': './package.json',
    })
  })

  test('leaves conditions objects untouched so assert rejects them loudly', () => {
    // A src target nested inside a conditions object is not a shape this
    // repo uses; rewriting it would silently publish the dev-only condition
    // key. Leave it alone — hasSrcExport still sees it, so a publish fails
    // at the prepack assert instead.
    const exports = {
      '.': { bun: './src/index.ts', default: './dist/index.js' },
    }
    expect(publishedExports(exports)).toEqual(exports)
    expect(hasSrcExport(publishedExports(exports))).toBe(true)
  })
})

describe('rewriteWorkspaceDeps', () => {
  test('maps workspace protocol aliases onto the released version', () => {
    const manifest = {
      name: '@straddlecom/runtime-surface',
      version: '0.1.0',
      dependencies: {
        '@straddlecom/runtime-core': 'workspace:^',
        'left-pad': '^1.3.0',
      },
      devDependencies: {
        '@straddlecom/runtime-client': 'workspace:*',
      },
      peerDependencies: {
        '@straddlecom/runtime-core': 'workspace:~',
      },
    }
    expect(rewriteWorkspaceDeps(manifest, VERSIONS)).toEqual({
      name: '@straddlecom/runtime-surface',
      version: '0.1.0',
      dependencies: {
        '@straddlecom/runtime-core': '^0.1.0',
        'left-pad': '^1.3.0',
      },
      devDependencies: {
        '@straddlecom/runtime-client': '0.2.3',
      },
      peerDependencies: {
        '@straddlecom/runtime-core': '~0.1.0',
      },
    })
  })

  test('keeps an explicit workspace range as written', () => {
    const manifest = {
      dependencies: { '@straddlecom/runtime-core': 'workspace:^0.1.0' },
    }
    expect(rewriteWorkspaceDeps(manifest, VERSIONS)).toEqual({
      dependencies: { '@straddlecom/runtime-core': '^0.1.0' },
    })
  })

  test('returns the manifest unchanged when nothing uses the protocol', () => {
    const manifest = {
      dependencies: { 'left-pad': '^1.3.0' },
    }
    expect(rewriteWorkspaceDeps(manifest, VERSIONS)).toEqual(manifest)
  })

  test('throws on a workspace dep with no known version', () => {
    const manifest = {
      dependencies: { '@straddlecom/unknown': 'workspace:^' },
    }
    expect(() => rewriteWorkspaceDeps(manifest, VERSIONS)).toThrow(
      '@straddlecom/unknown',
    )
  })
})

async function makeWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'publish-manifest-'))
  const write = async (dir: string, manifest: unknown) => {
    await mkdir(join(root, dir), { recursive: true })
    await writeFile(
      join(root, dir, 'package.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    )
  }
  await write('.', { name: 'root', private: true, workspaces: ['packages/*'] })
  await write('packages/core', { name: '@test/core', version: '1.2.0' })
  await write('packages/surface', {
    name: '@test/surface',
    version: '1.5.0',
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    dependencies: { '@test/core': 'workspace:^' },
  })
  return root
}

describe('workspaceVersions', () => {
  test('collects each workspace package version by name', async () => {
    const root = await makeWorkspaceRoot()
    expect(await workspaceVersions(root)).toEqual({
      '@test/core': '1.2.0',
      '@test/surface': '1.5.0',
    })
  })
})

describe('CLI', () => {
  const script = join(import.meta.dir, 'publish-manifest.ts')
  const run = (cwd: string, mode: string) =>
    Bun.spawnSync(['bun', script, mode], { cwd })

  test('strip rewrites src exports and workspace deps; restore undoes it', async () => {
    const root = await makeWorkspaceRoot()
    const pkg = join(root, 'packages/surface')
    const original = await readFile(join(pkg, 'package.json'), 'utf8')

    expect(run(pkg, 'strip').exitCode).toBe(0)
    const stripped = JSON.parse(
      await readFile(join(pkg, 'package.json'), 'utf8'),
    )
    expect(stripped.dependencies).toEqual({ '@test/core': '^1.2.0' })
    expect(stripped.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './package.json': './package.json',
    })

    expect(run(pkg, 'assert').exitCode).toBe(0)

    expect(run(pkg, 'restore').exitCode).toBe(0)
    expect(await readFile(join(pkg, 'package.json'), 'utf8')).toBe(original)
    expect(existsSync(join(pkg, 'package.json.orig'))).toBe(false)
  })

  test('strip backs up a manifest with workspace deps but published exports', async () => {
    const root = await makeWorkspaceRoot()
    const pkg = join(root, 'packages/surface')
    const manifest = JSON.parse(
      await readFile(join(pkg, 'package.json'), 'utf8'),
    )
    manifest.exports = { '.': { default: './dist/index.js' } }
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    )

    expect(run(pkg, 'strip').exitCode).toBe(0)
    expect(existsSync(join(pkg, 'package.json.orig'))).toBe(true)
    const stripped = JSON.parse(
      await readFile(join(pkg, 'package.json'), 'utf8'),
    )
    expect(stripped.dependencies).toEqual({ '@test/core': '^1.2.0' })
    expect(stripped.exports).toEqual({ '.': { default: './dist/index.js' } })
  })

  test('assert rejects a raw manifest that still carries workspace deps', async () => {
    const root = await makeWorkspaceRoot()
    const pkg = join(root, 'packages/surface')
    const result = run(pkg, 'assert')
    expect(result.exitCode).toBe(1)
  })

  test('assert rejects src exports even without workspace deps', async () => {
    const root = await makeWorkspaceRoot()
    const pkg = join(root, 'packages/surface')
    const manifest = JSON.parse(
      await readFile(join(pkg, 'package.json'), 'utf8'),
    )
    delete manifest.dependencies
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    )
    expect(run(pkg, 'assert').exitCode).toBe(1)
  })

  test('strip leaves an already-clean manifest alone', async () => {
    const root = await makeWorkspaceRoot()
    const pkg = join(root, 'packages/core')
    expect(run(pkg, 'strip').exitCode).toBe(0)
    expect(existsSync(join(pkg, 'package.json.orig'))).toBe(false)
    expect(run(pkg, 'assert').exitCode).toBe(0)
  })
})
