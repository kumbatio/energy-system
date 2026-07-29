/**
 * Emits `api-surface.json`: the exact public API surface, per published entry point.
 *
 * The file ships inside the package. Downstream docs can therefore install
 * `@kumbatio/energy-system` and check their pages against the surface of the exact
 * version they document, instead of against a copy that has to be kept in step by
 * hand. `pnpm run docs:check` in kumbatio-docs is the consumer.
 *
 * Values are enumerated by importing the built modules, so they are exactly what a
 * consumer can import — no parsing, no drift. Types have no runtime presence, so
 * they are read from the emitted declarations.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface EntryPointSurface {
  /** Bare specifier a consumer imports this entry point by. */
  readonly specifier: string
  /** Exported runtime values: functions, constants. */
  readonly values: readonly string[]
  /** Exported types and interfaces. */
  readonly types: readonly string[]
}

interface ApiSurface {
  readonly version: string
  readonly entryPoints: readonly EntryPointSurface[]
}

const ROOT = new URL('../', import.meta.url)

/** Published entry points, mirroring the `exports` map in package.json. */
const ENTRY_POINTS: ReadonlyArray<{ specifier: string; module: string }> = [
  { specifier: '@kumbatio/energy-system', module: 'index' },
  { specifier: '@kumbatio/energy-system/dom', module: 'dom' },
  { specifier: '@kumbatio/energy-system/react', module: 'react' },
  { specifier: '@kumbatio/energy-system/persistence', module: 'persistence' },
]

/**
 * Type-only exports, which leave no runtime trace. `export type { A, B }` and
 * `export interface Foo` / `export type Foo =` are the two shapes tsc emits.
 */
function readTypeExports(module: string): string[] {
  const declarationPath = new URL(`dist/${module}.d.ts`, ROOT)
  const source = readFileSync(declarationPath, 'utf8')
  const names = new Set<string>()

  for (const match of source.matchAll(/^export (?:declare )?(?:interface|type) (\w+)/gm)) {
    const name = match[1]
    if (name) names.add(name)
  }

  for (const match of source.matchAll(/^export type \{([^}]*)\}/gm)) {
    for (const clause of (match[1] ?? '').split(',')) {
      // `Foo as Bar` re-exports under the alias; the alias is what consumers import.
      const name = clause
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name) names.add(name)
    }
  }

  return [...names].sort()
}

async function readValueExports(module: string): Promise<string[]> {
  const moduleUrl = new URL(`dist/${module}.js`, ROOT)
  const namespace: Record<string, unknown> = await import(moduleUrl.href)
  return Object.keys(namespace)
    .filter((name) => name !== 'default')
    .sort()
}

async function buildSurface(): Promise<ApiSurface> {
  const packageJson: unknown = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'))
  if (typeof packageJson !== 'object' || packageJson === null || !('version' in packageJson)) {
    throw new Error('package.json is missing a version field')
  }
  const { version } = packageJson
  if (typeof version !== 'string') {
    throw new TypeError(`Expected a string version, received ${typeof version}`)
  }

  const entryPoints: EntryPointSurface[] = []
  for (const { specifier, module } of ENTRY_POINTS) {
    entryPoints.push({
      specifier,
      values: await readValueExports(module),
      types: readTypeExports(module),
    })
  }

  return { version, entryPoints }
}

const surface = await buildSurface()
const outputPath = new URL('api-surface.json', ROOT)
writeFileSync(outputPath, `${JSON.stringify(surface, null, 2)}\n`)

const total = surface.entryPoints.reduce(
  (sum, entry) => sum + entry.values.length + entry.types.length,
  0,
)
console.log(
  `[energy-system] api-surface.json: ${String(total)} exports across ${String(surface.entryPoints.length)} entry points (v${surface.version}) -> ${fileURLToPath(outputPath)}`,
)
