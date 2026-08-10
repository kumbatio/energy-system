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

import { readFileSync, readdirSync } from 'node:fs'

import { emitArtifact, isCheckRun } from './emit-artifact.ts'

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
  /**
   * Members of every exported interface, keyed by interface name — engine methods,
   * component props, option bags. Most API drift is a new or renamed member on an
   * existing type (`domTarget`, `whenHidden`), which a top-level export list cannot
   * see.
   *
   * Package-global rather than per-entry-point: interface names are unique across
   * the package, and an entry point that only re-exports a type does not carry its
   * body.
   */
  readonly members: Readonly<Record<string, readonly string[]>>
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

/**
 * Members of every exported interface in a declaration file.
 *
 * Declaration emit is regular in a way hand-written source is not: one member per
 * line, opening brace at the end of the `interface` line, closing brace in column
 * zero. That makes a brace-depth scan reliable here without pulling in a parser.
 */
function collectInterfaceMembers(
  source: string,
  members: Record<string, string[]>,
): Record<string, string[]> {
  const lines = source.split('\n')

  let current: string | null = null
  let depth = 0

  for (const line of lines) {
    if (current === null) {
      const opening = /^export (?:declare )?interface (\w+)[^{]*\{/.exec(line)
      if (opening?.[1]) {
        current = opening[1]
        members[current] = []
        depth = 1
      }
      continue
    }

    // Only direct members count; nested object literals belong to their parent.
    // `<` is in the terminator set for generic methods (`resolve<T>(...)`);
    // without it a method's own type parameters hide it from the freeze.
    if (depth === 1) {
      const member = /^\s{4}(?:readonly )?(\w+)\??[?:(<]/.exec(line)
      if (member?.[1]) members[current]?.push(member[1])
    }

    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    if (depth <= 0) current = null
  }

  for (const name of Object.keys(members)) {
    const list = members[name]
    if (list) members[name] = [...new Set(list)].sort()
  }

  return members
}

/** Every declaration file, so re-exported interfaces contribute their bodies too. */
function readAllInterfaceMembers(): Record<string, string[]> {
  const members: Record<string, string[]> = {}
  for (const file of readdirSync(new URL('dist/', ROOT))) {
    if (!file.endsWith('.d.ts')) continue
    collectInterfaceMembers(readFileSync(new URL(`dist/${file}`, ROOT), 'utf8'), members)
  }
  return members
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

  return { version, entryPoints, members: readAllInterfaceMembers() }
}

const surface = await buildSurface()

/*
 * The frozen surface is only a contract if it is complete. This is the one
 * member the parser used to miss — `resolve<T>()` opens with its own type
 * parameter rather than `(`, so a terminator set without `<` dropped it — and
 * a member absent from the artifact is a member nobody notices removing.
 */
const engineMembers = surface.members['EnergyEngine'] ?? []
for (const required of ['resolve', 'getState', 'setLevel', 'subscribe', 'dispose']) {
  if (!engineMembers.includes(required)) {
    throw new Error(
      `api-surface.json would omit EnergyEngine.${required} — the declaration parser is not seeing it`,
    )
  }
}

const outputPath = emitArtifact(
  new URL('api-surface.json', ROOT),
  `${JSON.stringify(surface, null, 2)}\n`,
)

const total = surface.entryPoints.reduce(
  (sum, entry) => sum + entry.values.length + entry.types.length,
  0,
)
console.log(
  `[energy-system] api-surface.json ${isCheckRun ? 'verified' : 'written'}: ${String(total)} exports across ${String(surface.entryPoints.length)} entry points (v${surface.version}) -> ${outputPath}`,
)
