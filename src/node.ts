import { randomBytes } from 'node:crypto'
import { watch } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { parseExternalEnergyState } from './levels.ts'
import { logContainedError } from './runtime.ts'
import type { EnergyPersistence, EnergyState } from './types.ts'

/*
 * Local interchange bus for Node.js, desktop apps (Electron/Tauri helpers),
 * CLIs, and local MCP servers.
 *
 * Implements the SPEC.md local interchange convention: one JSON file on disk,
 * conforming strictly to `spec/energy-state.schema.json`, written atomically
 * (temp file + rename) and watched with `fs.watch`. Every app on the person's
 * machine can share one live energy state with zero cloud server and zero
 * background daemon.
 */

export interface FilePersistenceOptions {
  /** Custom path to the shared state file. Default: `resolveEnergyStatePath()`. */
  path?: string
}

/**
 * Resolve the standard per-user local energy-state file path:
 * - `$KUMBATIO_ENERGY_FILE` if explicitly set
 * - `$XDG_STATE_HOME/kumbatio/energy-state.json` on Unix when `XDG_STATE_HOME` is set
 * - `%LOCALAPPDATA%/kumbatio/energy-state.json` on Windows
 * - `~/.config/kumbatio/energy-state.json` otherwise
 */
export function resolveEnergyStatePath(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): string {
  const explicit = env['KUMBATIO_ENERGY_FILE']?.trim()
  if (explicit) return explicit

  const xdgState = env['XDG_STATE_HOME']?.trim()
  if (xdgState) {
    return join(xdgState, 'kumbatio', 'energy-state.json')
  }

  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA']?.trim()
    if (localAppData) {
      return join(localAppData, 'kumbatio', 'energy-state.json')
    }
  }

  return join(homedir(), '.config', 'kumbatio', 'energy-state.json')
}

async function readStateFile(filePath: string): Promise<EnergyState | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return null
    }
    throw err
  }

  if (raw.trim().length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err: unknown) {
    logContainedError(`Discarding unparseable energy state file (${filePath})`, err)
    return null
  }

  try {
    return parseExternalEnergyState(parsed)
  } catch (err: unknown) {
    logContainedError(`Discarding malformed energy state file (${filePath})`, err)
    return null
  }
}

/**
 * Atomic file-backed persistence adapter with live cross-process observation.
 *
 * Writes go to a sibling temporary file and atomically rename into place so
 * concurrent readers never observe half-written JSON.
 */
export function filePersistence(options: FilePersistenceOptions | string = {}): EnergyPersistence {
  const filePath =
    typeof options === 'string' ? options : (options.path ?? resolveEnergyStatePath())
  const dir = dirname(filePath)
  const fileName = basename(filePath)

  return {
    async load() {
      return readStateFile(filePath)
    },

    async save(state: EnergyState) {
      const validated = parseExternalEnergyState(state)
      await mkdir(dir, { recursive: true })
      const tempPath = join(dir, `.${fileName}.${randomBytes(6).toString('hex')}.tmp`)
      const payload = `${JSON.stringify(validated, null, 2)}\n`

      try {
        await writeFile(tempPath, payload, 'utf8')
        await rename(tempPath, filePath)
      } catch (err: unknown) {
        try {
          await unlink(tempPath)
        } catch {
          // Ignore cleanup errors when the temp file was never created.
        }
        throw new Error(`Failed to save energy state to '${filePath}'`, { cause: err })
      }
    },

    observe(onState) {
      let closed = false
      let watcher: ReturnType<typeof watch> | undefined

      const notifyFromDisk = async () => {
        if (closed) return
        try {
          const parsed = await readStateFile(filePath)
          if (!closed && parsed) onState(parsed)
        } catch (err: unknown) {
          logContainedError(`Failed to read watched energy state file (${filePath})`, err)
        }
      }

      // Watch the parent directory (not just the file) so atomic renames and
      // first-time file creation are both observed reliably across OSes.
      const startWatcher = async () => {
        try {
          await mkdir(dir, { recursive: true })
          if (closed) return
          watcher = watch(dir, (_eventType, changed) => {
            if (changed && String(changed) !== fileName) return
            void notifyFromDisk()
          })
          watcher.on('error', (err) => {
            logContainedError(`Energy state file watcher error (${filePath})`, err)
          })
        } catch (err: unknown) {
          logContainedError(`Failed to watch energy state directory (${dir})`, err)
        }
      }
      void startWatcher()

      return () => {
        closed = true
        watcher?.close()
      }
    },
  }
}
