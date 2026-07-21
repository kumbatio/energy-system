import type { EnergyEngine, EnergyEngineOptions } from './engine.js'
import { notificationStrategy } from './strategies.js'
import type { NotificationConfig } from './strategies.js'
import type { AdaptationStrategy, EnergyLevel } from './types.js'

/**
 * Notification gate — the runtime that ENFORCES `NotificationConfig` instead
 * of leaving it as guidance. Apps publish notification intents through the
 * gate; the gate resolves the current energy level's config and decides
 * whether each intent is delivered now, batched, or deferred.
 *
 * Design rule inherited from field evidence (GingerMail's scheduler destroyed
 * reminders that came due while suppressed): the gate NEVER silently drops a
 * notification. Anything not deliverable now is deferred and released when
 * energy rises, suppression lifts, or the gate is disposed.
 */

function logGateError(message: string, err: unknown): void {
  console.error(`[energy-system] ${message}`, err)
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value)
}

/** Priority of a single notification intent */
export type NotificationPriority = 'normal' | 'high' | 'critical'

const NOTIFICATION_PRIORITIES: ReadonlySet<NotificationPriority> = new Set([
  'normal',
  'high',
  'critical',
])

/** Validate that an unknown value is a valid NotificationPriority */
export function isNotificationPriority(value: unknown): value is NotificationPriority {
  return typeof value === 'string' && NOTIFICATION_PRIORITIES.has(value as NotificationPriority)
}

/** A single notification intent held or delivered by the gate */
export interface EnergyNotification {
  readonly priority: NotificationPriority
  readonly payload: unknown
  /** When the intent was published (epoch ms, gate clock) */
  readonly createdAt: number
}

/** Why a delivery is happening */
export type NotificationDeliveryReason = 'immediate' | 'batch' | 'released'

/** Output channels permitted by the config active at delivery time */
export interface NotificationChannels {
  readonly visual: boolean
  readonly sound: boolean
  readonly vibration: boolean
}

/** One call to `onDeliver`: one or more notifications plus delivery context */
export interface NotificationDelivery {
  readonly notifications: readonly EnergyNotification[]
  readonly reason: NotificationDeliveryReason
  readonly channels: NotificationChannels
  readonly level: EnergyLevel
}

/** What happened to a published notification */
export type PublishOutcome = 'delivered' | 'batched' | 'deferred'

/**
 * Pure gating decision: given the active config, an intent priority, and the
 * suppression flag, decide the outcome. Extracted so apps can unit-test their
 * notification policy without constructing a gate.
 */
export function resolveNotificationOutcome(
  config: NotificationConfig,
  priority: NotificationPriority,
  suppressed: boolean,
): PublishOutcome {
  if (suppressed) return 'deferred'

  switch (config.priorityThreshold) {
    case 'none':
      return 'deferred'
    case 'critical':
      if (priority !== 'critical') return 'deferred'
      break
    case 'high':
      if (priority === 'normal') return 'deferred'
      break
    case 'all':
      break
  }

  return config.batchInterval > 0 ? 'batched' : 'delivered'
}

/** Timer contract so tests can drive batch windows deterministically */
export interface GateScheduler {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultScheduler: GateScheduler = {
  setTimeout(callback, ms) {
    return setTimeout(callback, ms)
  },
  clearTimeout(handle) {
    clearTimeout(handle as Parameters<typeof clearTimeout>[0])
  },
}

export interface NotificationGateOptions {
  /** Delivery sink. Called with everything the gate decides to surface. */
  onDeliver(delivery: NotificationDelivery): void
  /** Strategy resolving level -> NotificationConfig. Default: `notificationStrategy`. */
  strategy?: AdaptationStrategy<NotificationConfig>
  /** Deterministic time source for tests/simulations */
  clock?: EnergyEngineOptions['clock']
  /** Deterministic timer source for tests/simulations */
  scheduler?: GateScheduler
}

export interface NotificationGate {
  /** Publish a notification intent. Returns what the gate did with it. */
  publish(input: { priority?: NotificationPriority; payload?: unknown }): PublishOutcome
  /**
   * Hard-suppress delivery (e.g. during a focus session). While suppressed,
   * every publish defers; lifting suppression releases the deferred queue.
   */
  setSuppressed(suppressed: boolean): void
  isSuppressed(): boolean
  /** Counts of undelivered notifications currently held by the gate */
  pendingCount(): { batched: number; deferred: number }
  /** Deliver the open batch now and release any deferred items that qualify */
  flush(): void
  /**
   * Release resources. Pending notifications are delivered as a final
   * 'released' delivery first — a disposed gate never swallows intents.
   */
  dispose(): void
}

function resolveNow(clock?: EnergyEngineOptions['clock']): () => number {
  if (typeof clock === 'function') return clock
  if (clock?.now) return () => clock.now()
  return () => Date.now()
}

/**
 * Create a notification gate bound to an engine. The gate re-resolves its
 * config on every energy change and releases deferred notifications the
 * moment the new level's config (or lifted suppression) admits them.
 */
export function createNotificationGate(
  engine: EnergyEngine,
  options: NotificationGateOptions,
): NotificationGate {
  const {
    onDeliver,
    strategy = notificationStrategy,
    clock,
    scheduler = defaultScheduler,
  } = options

  if (typeof onDeliver !== 'function') {
    throw new TypeError('createNotificationGate requires an onDeliver callback')
  }

  const now = resolveNow(clock)

  let disposed = false
  let suppressed = false
  let batch: EnergyNotification[] = []
  let deferred: EnergyNotification[] = []
  let batchTimer: unknown

  function currentConfig(): NotificationConfig {
    return strategy.resolve(engine.getState().level)
  }

  function channelsFrom(config: NotificationConfig): NotificationChannels {
    return freezeObject({
      visual: config.allowVisual,
      sound: config.allowSound,
      vibration: config.allowVibration,
    })
  }

  function deliver(
    notifications: readonly EnergyNotification[],
    reason: NotificationDeliveryReason,
  ): void {
    if (notifications.length === 0) return

    const config = currentConfig()
    const delivery: NotificationDelivery = freezeObject({
      notifications: Object.freeze([...notifications]),
      reason,
      channels: channelsFrom(config),
      level: engine.getState().level,
    })

    try {
      onDeliver(delivery)
    } catch (err: unknown) {
      logGateError('onDeliver callback threw', err)
    }
  }

  function clearBatchTimer(): void {
    if (batchTimer !== undefined) {
      scheduler.clearTimeout(batchTimer)
      batchTimer = undefined
    }
  }

  function deliverBatch(): void {
    clearBatchTimer()
    if (batch.length === 0) return
    const toDeliver = batch
    batch = []
    deliver(toDeliver, 'batch')
  }

  function scheduleBatch(intervalMs: number): void {
    if (batchTimer !== undefined) return
    batchTimer = scheduler.setTimeout(() => {
      batchTimer = undefined
      deliverBatch()
    }, intervalMs)
  }

  /**
   * Re-evaluate the deferred queue against the active config. Anything no
   * longer deferred is released immediately (not re-batched: these intents
   * already waited once, adding a second batch delay would compound it).
   */
  function releaseEligibleDeferred(): void {
    if (disposed || deferred.length === 0) return

    const config = currentConfig()
    const stillDeferred: EnergyNotification[] = []
    const released: EnergyNotification[] = []

    for (const notification of deferred) {
      if (resolveNotificationOutcome(config, notification.priority, suppressed) === 'deferred') {
        stillDeferred.push(notification)
      } else {
        released.push(notification)
      }
    }

    deferred = stillDeferred
    deliver(released, 'released')
  }

  const unsubscribe = engine.subscribe(() => {
    releaseEligibleDeferred()
  })

  return {
    publish(input) {
      if (disposed) {
        throw new Error('Cannot publish through a disposed notification gate')
      }

      const priority = input.priority ?? 'normal'
      if (!isNotificationPriority(priority)) {
        throw new Error(`Invalid notification priority: ${String(priority)}`)
      }

      const notification: EnergyNotification = freezeObject({
        priority,
        payload: input.payload,
        createdAt: now(),
      })

      const config = currentConfig()
      const outcome = resolveNotificationOutcome(config, priority, suppressed)

      switch (outcome) {
        case 'delivered':
          deliver([notification], 'immediate')
          break
        case 'batched':
          batch.push(notification)
          scheduleBatch(config.batchInterval)
          break
        case 'deferred':
          deferred.push(notification)
          break
      }

      return outcome
    },

    setSuppressed(next) {
      if (disposed) return
      if (suppressed === next) return
      suppressed = next
      if (!suppressed) {
        releaseEligibleDeferred()
      }
    },

    isSuppressed() {
      return suppressed
    },

    pendingCount() {
      return { batched: batch.length, deferred: deferred.length }
    },

    flush() {
      if (disposed) return
      deliverBatch()
      releaseEligibleDeferred()
    },

    dispose() {
      if (disposed) return

      // Surface everything still held before going inert: an intent that
      // entered the gate must always exit through onDeliver.
      clearBatchTimer()
      const pending = [...batch, ...deferred]
      batch = []
      deferred = []
      deliver(pending, 'released')

      disposed = true
      unsubscribe()
    },
  }
}
