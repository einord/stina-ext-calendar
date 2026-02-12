/**
 * Calendar sync scheduling logic.
 */

import type { StorageAPI, SecretsAPI } from '@stina/extension-api/runtime'
import type { ExecutionContext } from '@stina/extension-api/runtime'
import { CalendarRepository, ExtensionRepository } from './db/repository.js'
import { ProviderRegistry } from './providers/index.js'
import { ensureFreshCredentials, type CredentialRefreshConfig } from './credentials.js'
import type { CalendarAccount } from './types.js'
import type { ChatAPI, UserAPI, LogAPI } from './shared-deps.js'

export interface SyncDeps {
  providers: ProviderRegistry
  extensionRepo: ExtensionRepository
  credentialConfig: CredentialRefreshConfig
  chat?: ChatAPI
  user?: UserAPI
  log: LogAPI
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

    // Remove locally cached events that were deleted on remote
    if (syncResult.deletedUids?.length) {
      for (const uid of syncResult.deletedUids) {
        const existingEvent = await userRepo.events.getByUid(account.id, uid)
        if (existingEvent) {
          await userRepo.events.delete(existingEvent.id)
        }
      }
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
  } catch (error) {
    deps.log.warn('Failed to sync all accounts', {
      userId: execContext.userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
