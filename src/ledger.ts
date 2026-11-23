import type { EnergyEngine, EnergyEngineOptions } from './engine.ts'
import { isEnergyLevel, isUnproducedState } from './levels.ts'
import { resolveNow } from './runtime.ts'
import type { EnergyLevel, EnergySource } from './types.ts'

/*
 * Local transition ledger and privacy-preserving team overlap.
 *
 * Implements the personal reflection layer from Paper 1 (`wh` / `ph` summaries)
 * and Paper 3 (Pattern 3: Timestamped Transitions), plus the privacy-preserving
 * shared high-energy windows model from Paper 5 §4.
 *
 * Ethical invariants:
 * - Strictly local and user-owned; never telemetry.
 * - Rhythm suggestions are advisory only — they report confidence and sample
 *   count so the person decides; they never silently override `setLevel`.
 * - Team window computation consumes ONLY voluntary coarse preferred hours
 *   (never raw low-energy logs or personal transition history).
 */

export interface EnergyLedgerEntry {
  readonly level: EnergyLevel
  readonly timestamp: number
  readonly source: EnergySource
}

export interface CapacitySummary {
  /** Total span covered in milliseconds (`wh` proxy, excluding Rest if split) */
  readonly totalTrackedMs: number
  /** Time spent at each discrete level (ms) */
  readonly durationByLevelMs: Readonly<Record<EnergyLevel, number>>
  /** Time spent in working states (`level >= 25`) in milliseconds */
  readonly activeSpanMs: number
  /** Time spent in focused-work states (`level >= 75`) in milliseconds (`ph` proxy) */
  readonly highCapacityMs: number
  /** Time spent in Rest (`level === 0`) in milliseconds */
  readonly restMs: number
}

export interface EnergyRhythmSuggestion {
  readonly level: EnergyLevel
  /** 0–1 consistency of past readings in this hour bucket */
  readonly confidence: number
  /** Number of past observations backing this suggestion */
  readonly sampleCount: number
  /** Human-readable explanation so the suggestion stays transparent */
  readonly reason: string
}

export interface EnergyLedgerOptions {
  /** Maximum entries retained in memory (ring buffer). Default: 500. */
  maxEntries?: number
  /** Seed entries loaded from local storage. */
  initialEntries?: readonly EnergyLedgerEntry[]
  /** Deterministic clock for tests/simulations. */
  clock?: EnergyEngineOptions['clock']
}

export interface EnergyLedger {
  /** All recorded transitions, oldest first. */
  getEntries(): readonly EnergyLedgerEntry[]
  /** Record a reading explicitly (also recorded automatically from `engine`). */
  record(entry: EnergyLedgerEntry): void
  /** Summarize time spent per level over `[sinceMs, nowMs]`. */
  summarize(sinceMs?: number, nowMs?: number): CapacitySummary
  /**
   * Offer an opt-in, explainable level suggestion for `at` based on past
   * readings in the same local hour-of-day bucket. Returns `null` when fewer
   * than `minSamples` (default 3) exist — never guesses from thin air.
   */
  suggestForTime(at?: Date, minSamples?: number): EnergyRhythmSuggestion | null
  /** Clear all local history. */
  clear(): void
  /** Unsubscribe from the engine. */
  dispose(): void
}

const LEVELS: readonly EnergyLevel[] = [100, 75, 50, 25, 0]

export function createEnergyLedger(
  engine: EnergyEngine,
  options: EnergyLedgerOptions = {},
): EnergyLedger {
  const { maxEntries = 500, initialEntries = [], clock } = options
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`Invalid maxEntries: ${String(maxEntries)}`)
  }

  const now = resolveNow(clock)
  const entries: EnergyLedgerEntry[] = []

  function push(entry: EnergyLedgerEntry): void {
    if (!isEnergyLevel(entry.level)) return
    entries.push(Object.freeze({ ...entry }))
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries)
    }
  }

  for (const seed of initialEntries) {
    push(seed)
  }

  const initial = engine.getState()
  if (!isUnproducedState(initial) && entries.length === 0) {
    push({ level: initial.level, timestamp: initial.timestamp, source: initial.source })
  }

  const unsubscribe = engine.subscribe((state) => {
    if (isUnproducedState(state)) return
    push({ level: state.level, timestamp: state.timestamp, source: state.source })
  })

  return {
    getEntries() {
      return Object.freeze([...entries])
    },

    record(entry) {
      push(entry)
    },

    summarize(sinceMs = 0, nowMs = now()) {
      const durations: Record<EnergyLevel, number> = { 100: 0, 75: 0, 50: 0, 25: 0, 0: 0 }
      const ordered = [...entries].sort((a, b) => a.timestamp - b.timestamp)

      for (let i = 0; i < ordered.length; i += 1) {
        const current = ordered[i]
        if (!current) continue
        const nextTimestamp = ordered[i + 1]?.timestamp ?? nowMs
        const start = Math.max(current.timestamp, sinceMs)
        const end = Math.min(nextTimestamp, nowMs)
        if (end > start) {
          durations[current.level] += end - start
        }
      }

      const restMs = durations[0]
      const activeSpanMs = durations[25] + durations[50] + durations[75] + durations[100]
      const highCapacityMs = durations[75] + durations[100]
      const totalTrackedMs = activeSpanMs + restMs

      return Object.freeze({
        totalTrackedMs,
        durationByLevelMs: Object.freeze(durations),
        activeSpanMs,
        highCapacityMs,
        restMs,
      })
    },

    suggestForTime(at = new Date(now()), minSamples = 3) {
      const targetHour = at.getHours()
      const counts = new Map<EnergyLevel, number>()
      let total = 0

      for (const entry of entries) {
        const hour = new Date(entry.timestamp).getHours()
        if (hour !== targetHour) continue
        counts.set(entry.level, (counts.get(entry.level) ?? 0) + 1)
        total += 1
      }

      if (total < minSamples) return null

      let bestLevel: EnergyLevel = 50
      let bestCount = -1
      for (const level of LEVELS) {
        const count = counts.get(level) ?? 0
        if (count > bestCount) {
          bestCount = count
          bestLevel = level
        }
      }

      const confidence = Math.round((bestCount / total) * 100) / 100
      return Object.freeze({
        level: bestLevel,
        confidence,
        sampleCount: total,
        reason: `Around ${String(targetHour).padStart(2, '0')}:00 you've usually picked ${String(bestLevel)}% (${String(bestCount)} of ${String(total)} times).`,
      })
    },

    clear() {
      entries.length = 0
    },

    dispose() {
      unsubscribe()
    },
  }
}

// ── Privacy-Preserving Shared Team Windows (Paper 5 §4) ──

/**
 * Voluntary, coarse preferred-collaboration hours for one team member.
 * Notice what is deliberately ABSENT: no raw energy logs, no mental-health
 * history, no low-energy flags — only the hours a person chooses to offer for
 * synchronous high-focus collaboration (in a shared reference time zone, e.g. UTC).
 */
export interface MemberCollaborationPreference {
  readonly memberId: string
  /** Hours (0–23) this person voluntarily offers for complex sync collaboration. */
  readonly preferredHours: readonly number[]
}

export interface SharedEnergyWindow {
  /** Starting hour (0–23) */
  readonly startHour: number
  /** Exclusive ending hour (1–24) */
  readonly endHour: number
  /** How many team members overlap in every hour of this window */
  readonly participantCount: number
  /** Fraction (0–1) of the team covered */
  readonly coverage: number
  readonly memberIds: readonly string[]
}

export interface ComputeSharedWindowsOptions {
  /** Minimum fraction of members required (0–1). Default: 0.75 (or all for 1-2 people). */
  minCoverage?: number
}

/**
 * Compute shared high-energy collaboration windows from voluntary member
 * hour preferences (Paper 5 §4). Pure, deterministic, and privacy-preserving:
 * never inspects raw personal `EnergyState` records.
 */
export function computeSharedWindows(
  members: readonly MemberCollaborationPreference[],
  options: ComputeSharedWindowsOptions = {},
): readonly SharedEnergyWindow[] {
  if (members.length === 0) return Object.freeze([])

  const minCoverage = options.minCoverage ?? (members.length <= 2 ? 1 : 0.75)
  if (!Number.isFinite(minCoverage) || minCoverage <= 0 || minCoverage > 1) {
    throw new Error(`Invalid minCoverage: ${String(minCoverage)} (expected 0 < coverage <= 1)`)
  }

  const requiredCount = Math.ceil(members.length * minCoverage)
  const byHour: string[][] = Array.from({ length: 24 }, () => [])

  for (const member of members) {
    const seen = new Set<number>()
    for (const hour of member.preferredHours) {
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        throw new Error(`Invalid preferred hour: ${String(hour)} (expected integer 0-23)`)
      }
      if (seen.has(hour)) continue
      seen.add(hour)
      byHour[hour]?.push(member.memberId)
    }
  }

  const windows: SharedEnergyWindow[] = []
  let hour = 0
  while (hour < 24) {
    const ids = [...(byHour[hour] ?? [])].sort()
    if (ids.length < requiredCount) {
      hour += 1
      continue
    }

    const startHour = hour
    const key = ids.join('\0')
    hour += 1
    while (hour < 24) {
      const nextIds = [...(byHour[hour] ?? [])].sort()
      if (nextIds.join('\0') !== key) break
      hour += 1
    }

    windows.push(
      Object.freeze({
        startHour,
        endHour: hour,
        participantCount: ids.length,
        coverage: Math.round((ids.length / members.length) * 100) / 100,
        memberIds: Object.freeze(ids),
      }),
    )
  }

  return Object.freeze(windows)
}
