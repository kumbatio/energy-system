import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

/*
 * These tests run against the PACKED TARBALL, not the working tree.
 *
 * Importing `../dist/*` proves the compiler emitted something loadable. It
 * cannot prove the package is installable: `files` may omit an artifact,
 * `exports` may point at a path that was never packed, a relative reference
 * inside a shipped JSON file may resolve in the repository and nowhere else.
 * Every one of those ships green and breaks on `npm install`. So: pack, unpack,
 * and treat the result as a stranger's dependency.
 */

const ROOT = new URL('../', import.meta.url)
const ROOT_PATH = fileURLToPath(ROOT)

let workDir: string
let packageDir: string

before(
  () => {
    workDir = mkdtempSync(join(tmpdir(), 'energy-system-pack-'))

    // Suppressing lifecycle scripts is load-bearing: `prepack` runs the full
    // suite, and this test lives inside it — packing with scripts enabled
    // recurses forever. pnpm has no `--ignore-scripts` flag on `pack`, so this
    // goes through its escape hatch for config not exposed as an option.
    execFileSync('pnpm', ['pack', '--config.ignore-scripts=true', '--pack-destination', workDir], {
      cwd: ROOT_PATH,
      stdio: 'pipe',
    })

    const tarball = readdirSync(workDir).find((entry) => entry.endsWith('.tgz'))
    assert.ok(tarball, 'pnpm pack produced no tarball')
    execFileSync('tar', ['-xzf', join(workDir, tarball), '-C', workDir], { stdio: 'pipe' })

    packageDir = join(workDir, 'package')

    // A consumer resolves peers from its own tree. Borrowing this repository's
    // installed React is what makes the extracted package importable at all.
    symlinkSync(join(ROOT_PATH, 'node_modules'), join(packageDir, 'node_modules'), 'dir')
  },
  { timeout: 120_000 },
)

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

function packedManifest(): {
  exports: Record<string, unknown>
  peerDependencies: Record<string, string>
} {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>
    peerDependencies: Record<string, string>
  }
}

/** Every file path an `exports` entry can resolve to, flattened. */
function exportTargets(exports: Record<string, unknown>): string[] {
  const targets: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      targets.push(value)
      return
    }
    if (typeof value === 'object' && value !== null) {
      for (const nested of Object.values(value)) walk(nested)
    }
  }
  walk(exports)
  return targets
}

void test('every advertised export exists inside the tarball', () => {
  const missing = exportTargets(packedManifest().exports).filter(
    (target) => !existsSync(join(packageDir, target)),
  )

  assert.deepEqual(missing, [], 'exports point at files that were never packed')
})

void test('the packed JavaScript entry points import in a clean consumer', async () => {
  const load = async (subpath: string): Promise<Record<string, unknown>> =>
    (await import(new URL(`file://${join(packageDir, subpath)}`).href)) as Record<string, unknown>

  const [root, dom, persistence, react] = await Promise.all([
    load('dist/index.js'),
    load('dist/dom.js'),
    load('dist/persistence.js'),
    load('dist/react.js'),
  ])

  assert.equal(typeof root['createEnergyEngine'], 'function')
  assert.equal(typeof dom['applyEnergyLevel'], 'function')
  assert.equal(typeof persistence['localStoragePersistence'], 'function')
  assert.equal(typeof react['EnergyProvider'], 'function')

  const createEnergyEngine = root['createEnergyEngine'] as (options: { initialLevel: number }) => {
    getState: () => { level: number }
    dispose: () => void
  }
  const engine = createEnergyEngine({ initialLevel: 100 })
  assert.equal(engine.getState().level, 100)
  engine.dispose()
})

void test('the packed conformance vectors resolve their own schema reference', () => {
  const conformance = JSON.parse(readFileSync(join(packageDir, 'conformance.json'), 'utf8')) as {
    $schema: string
    version: string
  }
  const surface = JSON.parse(readFileSync(join(packageDir, 'api-surface.json'), 'utf8')) as {
    version: string
  }

  // Relative to the package root, which is the only base a consumer has.
  const schemaPath = join(packageDir, conformance.$schema)
  assert.ok(
    existsSync(schemaPath),
    `conformance.json points at ${conformance.$schema}, which is not in the tarball`,
  )

  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $id: string }
  assert.equal(schema.$id, 'https://kumbat.io/spec/conformance.schema.json')
  assert.equal(conformance.version, surface.version, 'shipped artifacts disagree on the version')
})

void test('the React peer range excludes versions without the APIs the subpath imports', async () => {
  const react = (await import('react')) as Record<string, unknown>

  // <Activity> is a React 19.2 addition and dist/react.js imports it
  // unconditionally, so a range admitting 19.0 or 19.1 advertises a
  // compatibility that throws on first render.
  const reactEntry = readFileSync(join(packageDir, 'dist/react.js'), 'utf8')
  assert.match(reactEntry, /\bActivity\b/, 'the React entry no longer imports Activity')
  assert.ok('Activity' in react, 'the installed React predates <Activity>')

  for (const field of ['react', '@types/react']) {
    const range = packedManifest().peerDependencies[field]
    const floor = /^>=(\d+)\.(\d+)\./.exec(range ?? '')
    assert.ok(
      floor,
      `${field} peer range must state an explicit minor floor, got: ${String(range)}`,
    )

    const [major, minor] = [Number(floor[1]), Number(floor[2])]
    assert.ok(
      major > 19 || (major === 19 && minor >= 2),
      `${field} peer range ${String(range)} admits React versions without <Activity>`,
    )
  }
})
