/**
 * Calendar sync scheduling logic.
 */

import type { Disposable, StorageAPI, SecretsAPI } from '@stina/extension-api/runtime'
import type { ExecutionContext } from '@stina/extension-api/runtime'
import { CalendarRepository, ExtensionRepository } from './db/repository.js'
import { ProviderRegistry } from './providers/index.js'
import { ensureFreshCredentials, type CredentialRefreshConfig } from './credentials.js'
import type { CalendarAccount } from './types.js'

type ChatAPI = {
  appendInstruction: (message: {
    text: string
    conversationId?: string
    userId?: string
  }) => Promise<void>
}

type SchedulerAPI = {
  schedule: (job: {
    id: string
    schedule: { type: 'at'; at: string } | { type: 'interval'; everyMs: number } | { type: 'cron'; cron: string; timezone?: string }
    payload?: Record<string, unknown>
    userId: string
  }) => Promise<void>
  cancel: (jobId: string) => Promise<void>
  onFire: (
    callback: (payload: { id: string; payload?: Record<string, unknown>; userId: string }, execContext: ExecutionContext) => void
  ) => Disposable
}

type UserProfile = {
  firstName?: string
  nickname?: string
  language?: string
  timezone?: string
}

type UserAPI = {
  getProfile: (userId?: string) => Promise<UserProfile>
}

export interface SyncDeps {
  providers: ProviderRegistry
  extensionRepo: ExtensionRepository
  credentialConfig: CredentialRefreshConfig
  chat?: ChatAPI
  scheduler?: SchedulerAPI
  user?: UserAPI
  log: {
    info: (msg: string, data?: Record<string, unknown>) => void
    warn: (msg: string, data?: Record<string, unknown>) => void
    debug: (msg: string, data?: Record<string, unknown>) => void
  }
  scheduleReminders: (userId: string, userStorage: StorageAPI, userSecrets: SecretsAPI) => Promise<void>
  emitEventChanged?: () => void
}

const SYNC_INTERVAL_MS = 10 * 60 * 1000 // Sync every 10 minutes

/**
 * Sync events for a single account.
 */
export async function syncAccountEvents(
  account: CalendarAccount,
  userStorage: StorageAPI,
  userSecrets: SecretsAPI,
  deps: SyncDeps
): Promise<void> {
  try {
    const userRepo = new CalendarRepository(userStorage, userSecrets)
    const provider = deps.providers.getRequired(account.provider)

    // Refresh credentials if needed
    const credentials = await ensureFreshCredentials(
      account,
      userRepo.accounts,
      deps.credentialConfig
    )

    // Date range: 7 days ago to 90 days ahead
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const to = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    // Get existing sync state
    const syncState = await userRepo.syncState.get(account.id)

    // Sync events from remote
    const syncResult = await provider.syncEvents(
      account,
      credentials,
      from,
      to,
      syncState?.syncToken
    )

    // Upsert events in local cache
    for (const event of syncResult.events) {
      await userRepo.events.upsertByUid(account.id, {
        accountId: account.id,
        calendarId: event.calendarId,
        uid: event.uid,
        title: event.title,
        description: event.description,
        location: event.location,
        startAt: event.startAt,
        endAt: event.endAt,
        allDay: event.allDay,
        recurrenceRule: event.recurrenceRule,
        organizer: event.organizer,
        attendees: event.attendees,
        remoteUrl: event.remoteUrl,
        etag: event.etag,
        rawIcs: event.rawIcs,
      })
    }

    // Update sync state
    await userRepo.syncState.upsert(
      account.id,
      syncResult.syncToken ?? null,
      syncResult.deltaLink ?? null
    )

    // Update account sync status
    await userRepo.accounts.updateSyncStatus(account.id, null)

    deps.log.info('Synced calendar events', {
      accountId: account.id,
      eventsCount: syncResult.events.length,
    })
  } catch (error) {
    deps.log.warn('Failed to sync calendar events', {
      accountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    })

    try {
      const userRepo = new CalendarRepository(userStorage, userSecrets)
      await userRepo.accounts.updateSyncStatus(
        account.id,
        error instanceof Error ? error.message : String(error)
      )
    } catch {
      // Ignore update errors
    }
  }
}

/**
 * Sync all accounts for a user using their execution context.
 */
export async function syncAllAccountsWithContext(
  execContext: ExecutionContext,
  deps: SyncDeps
): Promise<void> {
  if (!execContext.userId) return

  try {
    const userRepo = new CalendarRepository(execContext.userStorage, execContext.userSecrets)
    const accounts = await userRepo.accounts.list()

    for (const account of accounts) {
      if (!account.enabled) continue
      await syncAccountEvents(account, execContext.userStorage, execContext.userSecrets, deps)
    }

    // Notify UI that events have changed
    deps.emitEventChanged?.()

    // After sync, schedule reminders for upcoming events
    await deps.scheduleReminders(execContext.userId, execContext.userStorage, execContext.userSecrets)
  } catch (error) {
    deps.log.warn('Failed to sync all accounts', {
      userId: execContext.userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Creates a sync scheduler manager.
 */
export function createSyncScheduler(deps: SyncDeps) {
  const scheduledUsers = new Set<string>()

  const scheduleSyncForUser = async (userId: string): Promise<void> => {
    if (!deps.scheduler || scheduledUsers.has(userId)) return

    try {
      await deps.scheduler.schedule({
        id: `cal-sync-${userId}`,
        schedule: { type: 'interval', everyMs: SYNC_INTERVAL_MS },
        userId,
      })
      scheduledUsers.add(userId)
      deps.log.info('Scheduled calendar sync for user', { userId, intervalMs: SYNC_INTERVAL_MS })
    } catch (error) {
      deps.log.warn('Failed to schedule sync', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const setupSchedulerListener = (): Disposable | undefined => {
    if (!deps.scheduler) return undefined

    const disposable = deps.scheduler.onFire(async (firePayload, execContext) => {
      if (!firePayload.id.startsWith('cal-sync-')) return

      const userId = firePayload.userId || execContext.userId
      if (!userId) return

      deps.log.debug('Calendar sync triggered', { userId })
      await syncAllAccountsWithContext(execContext, deps)
    })

    deps.log.info('Calendar sync scheduler configured', { intervalMs: SYNC_INTERVAL_MS })
    return disposable
  }

  const initializeSyncForExistingUsers = async (): Promise<void> => {
    try {
      const userIds = await deps.extensionRepo.getAllUserIds()

      if (userIds.length === 0) {
        deps.log.info('No existing calendar accounts found, sync will start when accounts are added')
        return
      }

      deps.log.info('Starting calendar sync for existing users', { userCount: userIds.length })

      for (const userId of userIds) {
        await scheduleSyncForUser(userId)
      }
    } catch (error) {
      deps.log.warn('Failed to initialize sync for existing users', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const cancelAll = (): void => {
    if (deps.scheduler) {
      for (const userId of scheduledUsers) {
        void deps.scheduler.cancel(`cal-sync-${userId}`)
      }
    }
    scheduledUsers.clear()
  }

  return {
    scheduleSyncForUser,
    setupSchedulerListener,
    initializeSyncForExistingUsers,
    cancelAll,
  }
}
