// Published manifests must differ from the in-repo ones in two ways, and Bun
// snapshots package.json before prepack runs, so a lifecycle hook cannot make
// either change:
//
// - The in-repo exports point at raw src/ (every dev flow resolves TypeScript
//   directly; dist never exists outside a publish), but `files` excludes src/
//   from published tarballs — a published manifest must instead point each
//   entry at its tsc-emitted dist pair (`types` + `default`).
// - `workspace:` dependency ranges must be replaced with the dependency's
//   released version. `bun publish` substitutes them itself, but from the
//   lockfile's recorded workspace versions — which release-please never bumps —
//   so it published `^0.0.0` ranges. Rewriting here, from the sibling
//   manifests, is deterministic.
//
// Publishing therefore wraps the publish in strip/restore, and each package's
// prepack runs `assert` so a raw publish/pack fails loudly instead of
// shipping the dev manifest.
//
// Usage (from a package directory):
//   bun ../../scripts/publish-manifest.ts strip     # backup + rewrite for publish
//   bun ../../scripts/publish-manifest.ts restore   # put the original manifest back
//   bun ../../scripts/publish-manifest.ts assert    # fail if dev-only fields present
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const BACKUP = 'package.json.orig'

const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

type Manifest = Record<string, unknown>

const SRC_TARGET = /^\.\/src\/(.+)\.ts$/

// Deliberately broader than SRC_TARGET: the rewrite only understands
// ./src/*.ts, so any other src-pointing shape must trip the assert (and
// fail the publish loudly) rather than ship pointing at excluded src/.
export function hasSrcExport(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('./src/')
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some(hasSrcExport)
}

// "./src/<path>.ts" → { types: "./dist/<path>.d.ts", default: "./dist/<path>.js" }
// (tsc emit mirrors src/ into dist/, so the mapping is purely structural).
// Only top-level string targets are rewritten — a src target nested inside a
// conditions object is not a shape this repo uses, and rewriting it would
// silently publish the dev-only condition key; leaving it means the prepack
// assert (hasSrcExport is recursive) rejects the publish loudly instead.
// Anything not pointing into src/ is kept as written.
export function publishedExports(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const match = typeof child === 'string' ? SRC_TARGET.exec(child) : null
      if (match === null) return [key, child]
      return [
        key,
        {
          types: `./dist/${match[1]}.d.ts`,
          default: `./dist/${match[1]}.js`,
        },
      ]
    }),
  )
}

export function hasWorkspaceDep(manifest: Manifest): boolean {
  return DEP_SECTIONS.some((section) =>
    Object.values(manifest[section] ?? {}).some(
      (range) => typeof range === 'string' && range.startsWith('workspace:'),
    ),
  )
}

// workspace:^ / workspace:~ / workspace:* resolve against the dependency's
// current version (pnpm/bun convention: * means the exact version); an
// explicit range after the protocol is kept as written.
export function rewriteWorkspaceDeps(
  manifest: Manifest,
  versionsByName: Record<string, string>,
): Manifest {
  const rewritten: Manifest = { ...manifest }
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section]
    if (typeof deps !== 'object' || deps === null) continue
    rewritten[section] = Object.fromEntries(
      Object.entries(deps).map(([name, range]) => {
        if (typeof range !== 'string' || !range.startsWith('workspace:')) {
          return [name, range]
        }
        const alias = range.slice('workspace:'.length)
        if (alias !== '^' && alias !== '~' && alias !== '*') {
          return [name, alias]
        }
        const version = versionsByName[name]
        if (version === undefined) {
          throw new Error(
            `cannot rewrite "${name}": "${range}" — no workspace package by that name`,
          )
        }
        return [name, alias === '*' ? version : alias + version]
      }),
    )
  }
  return rewritten
}

export async function workspaceVersions(
  rootDir: string,
): Promise<Record<string, string>> {
  const packagesDir = join(rootDir, 'packages')
  const versions: Record<string, string> = {}
  for (const entry of await readdir(packagesDir)) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string') continue
    versions[manifest.name] = manifest.version
  }
  return versions
}

if (import.meta.main) {
  const mode = process.argv[2]
  const raw = await readFile('package.json', 'utf8')
  let manifest: Manifest = JSON.parse(raw)

  if (mode === 'strip') {
    let changed = false
    if (hasSrcExport(manifest.exports)) {
      manifest.exports = publishedExports(manifest.exports)
      changed = true
    }
    if (hasWorkspaceDep(manifest)) {
      manifest = rewriteWorkspaceDeps(
        manifest,
        await workspaceVersions(resolve('../..')),
      )
      changed = true
    }
    if (changed) {
      await writeFile(BACKUP, raw)
      await writeFile('package.json', JSON.stringify(manifest, null, 2) + '\n')
    }
  } else if (mode === 'restore') {
    if (existsSync(BACKUP)) await rename(BACKUP, 'package.json')
  } else if (mode === 'assert') {
    if (hasSrcExport(manifest.exports) || hasWorkspaceDep(manifest)) {
      console.error(
        'package.json still carries dev-only fields (src-pointing exports ' +
          'or `workspace:` ranges). Real publishes go through the publish ' +
          'workflow (merge the release PR), which strips them first. Local ' +
          'rehearsal:\n' +
          '  bun ../../scripts/publish-manifest.ts strip && npm publish --dry-run; bun ../../scripts/publish-manifest.ts restore',
      )
      process.exit(1)
    }
  } else {
    console.error('usage: publish-manifest.ts strip|restore|assert')
    process.exit(1)
  }
}
