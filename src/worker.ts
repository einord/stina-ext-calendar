/**
 * Calendar sync & reminders background worker management.
 *
 * Replaces the previous scheduler-based approach with a persistent
 * background worker that polls for sync and processes reminders.
 */

import type { Disposable, BackgroundWorkersAPI, BackgroundTaskContext } from '@stina/extension-api/runtime'
import type { ChatAPI, UserAPI, LogAPI } from './shared-deps.js'
import type { ProviderRegistry } from './providers/index.js'
import type { ExtensionRepository } from './db/repository.js'
import { CalendarRepository } from './db/repository.js'
import type { CredentialRefreshConfig } from './credentials.js'
import { syncAccountEvents } from './sync.js'
import { fireReminder } from './reminders.js'

const POLL_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes (same as previous scheduler)
const REMINDER_GRACE_MS = 5 * 60 * 1000 // 5 minute grace period for reminders at restart

export interface WorkerDeps {
  providers: ProviderRegistry
  extensionRepo: ExtensionRepository
  credentialConfig: CredentialRefreshConfig
  backgroundWorkers?: BackgroundWorkersAPI
  chat?: ChatAPI
  user?: UserAPI
  log: LogAPI
  emitEventChanged?: () => void
}

/**
 * Creates a calendar worker manager that handles periodic sync and reminder processing.
 */
export function createCalendarWorkerManager(deps: WorkerDeps) {
  const workerDisposables = new Map<string, Disposable>()

  const startWorkerForUser = async (userId: string): Promise<void> => {
    if (!deps.backgroundWorkers) return

    const workerId = `cal-sync-worker-${userId}`

    // Don't start if already running
    if (workerDisposables.has(workerId)) return

    try {
      const disposable = await deps.backgroundWorkers.start(
        {
          id: workerId,
          name: 'Calendar Sync & Reminders',
          userId,
          restartPolicy: { type: 'on-failure', maxRestarts: 0 },
        },
        async (ctx: BackgroundTaskContext) => {
          const firedReminders = new Set<string>()

          while (!ctx.signal.aborted) {
            // 1. Sync phase
            ctx.reportHealth('Syncing calendars...')
            try {
              const userRepo = new CalendarRepository(ctx.userStorage, ctx.userSecrets)
              const accounts = await userRepo.accounts.list()
              for (const account of accounts) {
                if (!account.enabled) continue
                if (ctx.signal.aborted) break
                await syncAccountEvents(account, ctx.userStorage, ctx.userSecrets, {
                  providers: deps.providers,
                  extensionRepo: deps.extensionRepo,
                  credentialConfig: deps.credentialConfig,
                  chat: deps.chat,
                  user: deps.user,
                  log: ctx.log,
                  emitEventChanged: deps.emitEventChanged,
                })
              }
              deps.emitEventChanged?.()
            } catch (err) {
              ctx.log.warn('Sync cycle failed', {
                error: err instanceof Error ? err.message : String(err),
              })
            }

            if (ctx.signal.aborted) break

            // 2. Reminders phase
            ctx.reportHealth('Processing reminders...')
            let nextReminderMs = POLL_INTERVAL_MS
            try {
              const userRepo = new CalendarRepository(ctx.userStorage, ctx.userSecrets)
              const settings = await userRepo.settings.get()
              const now = new Date()
              const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
              const events = await userRepo.events.getUpcoming(now.toISOString(), in24h.toISOString())

              let earliestFuture = Infinity

              for (const event of events) {
                const eventStart = new Date(event.startAt)
                const reminderTime = new Date(eventStart.getTime() - settings.reminderMinutes * 60 * 1000)
                const key = `${event.uid}-${event.startAt}`

                if (firedReminders.has(key)) continue

                const reminderMs = reminderTime.getTime()
                const nowMs = now.getTime()

                if (reminderMs <= nowMs && reminderMs > nowMs - REMINDER_GRACE_MS) {
                  // Fire now (within grace period)
                  try {
                    await fireReminder(
                      event,
                      settings,
                      { chat: deps.chat!, user: deps.user, log: ctx.log },
                      userId
                    )
                    firedReminders.add(key)
                  } catch (err) {
                    ctx.log.warn('Failed to fire reminder', {
                      eventId: event.id,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  }
                } else if (reminderMs > nowMs) {
                  // Future reminder — track earliest
                  earliestFuture = Math.min(earliestFuture, reminderMs - nowMs)
                }
              }

              if (earliestFuture < Infinity) {
                nextReminderMs = Math.min(earliestFuture, POLL_INTERVAL_MS)
              }
            } catch (err) {
              ctx.log.warn('Reminder processing failed', {
                error: err instanceof Error ? err.message : String(err),
              })
            }

            if (ctx.signal.aborted) break

            // 3. Sleep until next check
            const sleepMs = Math.max(nextReminderMs, 1000) // At least 1 second
            ctx.reportHealth(`Next check in ${Math.round(sleepMs / 1000)}s`)

            await new Promise<void>((resolve) => {
              const timeout = setTimeout(resolve, sleepMs)
              ctx.signal.addEventListener('abort', () => {
                clearTimeout(timeout)
                resolve()
              }, { once: true })
            })
          }

          ctx.reportHealth('Worker stopped')
        }
      )

      workerDisposables.set(workerId, disposable)
      deps.log.info('Background calendar worker started', { userId })
    } catch (error) {
      deps.log.warn('Failed to start calendar worker', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const stopAll = (): void => {
    for (const [, d] of workerDisposables) d.dispose()
    workerDisposables.clear()
  }

  return { startWorkerForUser, stopAll }
}
