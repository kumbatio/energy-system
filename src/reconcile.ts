import type { EnergySource, EnergyState } from './types.js'

/**
 * State reconciliation — how two `EnergyState` values that describe the same
 * user are ordered when they meet.
 *
 * They meet constantly: a second browser tab writes the shared store, a desktop
 * window and its detached child both hold an engine, a sync layer hands back
 * what another device recorded. Every one of those paths needs the same answer
 * to "which of these two is the current state?", and the answer has to be
 * *deterministic* — not "last write wins by arrival order", which converges on
 * different values depending on network timing.
 *
 * This is the rule, extracted from the engine so it can be read, tested, and
 * ported on its own. It is the single hardest thing to reimplement correctly in
 * another language, and the conformance vectors exercise it directly.
 */

/**
 * How much authority each source carries when everything else ties.
 *
 * A level the user set by hand outranks one a schedule applied, which outranks
 * one inferred from behaviour. This is the library's central stance in numeric
 * form: the dial is the trust anchor, and nothing the system worked out on its
 * own may quietly overwrite what the person said about themselves.
 */
function sourcePriority(source: EnergySource): number {
  switch (source) {
    case 'manual':
      return 3
    case 'scheduled':
      return 2
    case 'inferred':
      return 1
  }
}

/**
 * Should `candidate` replace `current`?
 *
 * The comparison walks four keys in order, stopping at the first that differs:
 *
 * 1. **`timestamp`** — later wins. The ordinary case, and the only one most
 *    states ever reach.
 * 2. **`revision`** — higher wins. Two writes inside one clock tick are not
 *    simultaneous; the producer numbers them so they still order.
 * 3. **`source`** — `manual` > `scheduled` > `inferred`. See `sourcePriority`.
 * 4. **`origin`** — higher string wins. Not meaningful, and deliberately so:
 *    when two producers write the same instant, the same revision, and the same
 *    kind of source, there is no principled winner, and an arbitrary rule every
 *    context computes identically beats a coin flip each context tosses
 *    separately. Convergence is the property that matters.
 *
 * A final `level` comparison exists below the four keys as a backstop for
 * producers that reuse one identity for different state, which is a contract
 * violation but should still converge rather than oscillate.
 *
 * Equal on every key means equal: `false`, so an identical state never counts
 * as a change and never fires a notification.
 */
export function isPreferredEnergyState(candidate: EnergyState, current: EnergyState): boolean {
  if (candidate.timestamp !== current.timestamp) {
    return candidate.timestamp > current.timestamp
  }

  if (candidate.revision !== current.revision) {
    return candidate.revision > current.revision
  }

  if (candidate.source !== current.source) {
    return sourcePriority(candidate.source) > sourcePriority(current.source)
  }

  if (candidate.origin !== current.origin) {
    return candidate.origin > current.origin
  }

  if (candidate.level !== current.level) {
    return candidate.level > current.level
  }

  return false
}
