/**
 * Shared tail for the generated release artifacts (`api-surface.json`,
 * `conformance.json`): write them, or under `--check` assert that the
 * committed file already matches what this run produced.
 *
 * The two modes exist because collapsing them makes the drift guard
 * meaningless. `pnpm test` used to run `build` first, so the generator had
 * already rewritten the artifact before the test read it — the comparison was
 * a file against itself and could not fail, whatever was committed. Generation
 * now belongs to `pnpm run build` alone; every validation path checks.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** True when this run was asked to verify rather than regenerate. */
export const isCheckRun: boolean = process.argv.includes('--check')

/**
 * @throws when `--check` is set and the committed file is absent or differs.
 * @returns the human-readable path, for the caller's summary line.
 */
export function emitArtifact(target: URL, contents: string): string {
  const path = fileURLToPath(target)

  if (!isCheckRun) {
    writeFileSync(target, contents)
    return path
  }

  let committed: string
  try {
    committed = readFileSync(target, 'utf8')
  } catch (err: unknown) {
    throw new Error(`${path} is missing — run \`pnpm run build\` and commit the result`, {
      cause: err,
    })
  }

  if (committed !== contents) {
    throw new Error(
      `${path} is stale — it does not match the library that generates it. Run \`pnpm run build\` and commit the result.`,
    )
  }

  return path
}
