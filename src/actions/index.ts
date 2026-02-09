/**
 * Calendar Extension UI action registrations.
 */

import type { ExecutionContext, StorageAPI, SecretsAPI } from '@stina/extension-api/runtime'
import { CalendarRepository, ExtensionRepository } from '../db/repository.js'
import { ProviderRegistry, getProviderLabel, type ProviderConfig } from '../providers/index.js'
import { getEditState, deleteEditState, type EditFormState } from '../edit-state.js'
import type { AccountDisplayData, CalendarProvider, UpcomingEvent } from '../types.js'
import {
  initiateGoogleCalendarAuth,
  initiateOutlookCalendarAuth,
  DEFAULT_OUTLOOK_CALENDAR_CLIENT_ID,
  pollGoogleCalendarToken,
  pollOutlookCalendarToken,
} from '../oauth/index.js'

type ActionsApi = {
  register: (action: {
    id: string
    execute: (
      params: Record<string, unknown>,
      execContext: ExecutionContext
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }) => { dispose: () => void }
}

export interface ActionDeps {
  extensionRepo: ExtensionRepository
  providers: ProviderRegistry
  emitAccountChanged: () => void
  emitSettingsChanged: () => void
  emitEditChanged: () => void
  emitEventChanged: () => void
  scheduleSyncForUser: (userId: string) => Promise<void>
  log: {
    warn: (msg: string, data?: Record<string, unknown>) => void
  }
}

function createUserRepository(execContext: ExecutionContext): CalendarRepository {
  return new CalendarRepository(execContext.userStorage, execContext.userSecrets)
}

export function registerActions(actionsApi: ActionsApi, deps: ActionDeps): Array<{ dispose: () => void }> {
  return [
    // Get accounts for display
    actionsApi.register({
      id: 'getAccounts',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        try {
          const userRepo = createUserRepository(execContext)
          const accounts = await userRepo.accounts.list()

          const displayData: AccountDisplayData[] = accounts.map((account) => ({
            id: account.id,
            name: account.name,
            provider: account.provider,
            providerLabel: getProviderLabel(account.provider),
            statusVariant: account.lastError
              ? 'danger'
              : account.enabled
                ? 'success'
                : 'default',
            enabled: account.enabled,
            lastSyncAt: account.lastSyncAt,
            lastError: account.lastError,
          }))

          return { success: true, data: displayData }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Get edit state
    actionsApi.register({
      id: 'getEditState',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        return { success: true, data: getEditState(execContext.userId) }
      },
    }),

    // Show add form
    actionsApi.register({
      id: 'showAddForm',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const state = getEditState(execContext.userId)
        state.showModal = true
        state.modalTitle = 'Add Account'
        state.editingId = null
        state.form = {
          provider: 'ical',
          name: '',
          url: '',
          username: '',
          password: '',
        }
        state.oauthStatus = 'pending'
        state.oauthUrl = ''
        state.oauthCode = ''

        deps.emitEditChanged()
        return { success: true }
      },
    }),

    // Edit account
    actionsApi.register({
      id: 'editAccount',
      async execute(params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const id = params.id as string
        const userRepo = createUserRepository(execContext)
        const account = await userRepo.accounts.get(id)

        if (!account) {
          return { success: false, error: 'Account not found' }
        }

        const state = getEditState(execContext.userId)
        state.showModal = true
        state.modalTitle = 'Edit Account'
        state.editingId = id
        state.form = {
          provider: account.provider,
          name: account.name,
          url: account.url || '',
          username:
            account.credentials.type === 'password' ? account.credentials.username : '',
          password: '',
        }
        state.oauthStatus =
          account.credentials.type === 'oauth2' ? 'connected' : 'pending'
        state.oauthUrl = ''
        state.oauthCode = ''

        deps.emitEditChanged()
        return { success: true }
      },
    }),

    // Close modal
    actionsApi.register({
      id: 'closeModal',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const state = getEditState(execContext.userId)
        state.showModal = false

        // Clean up edit state when modal closes
        deleteEditState(execContext.userId)

        deps.emitEditChanged()
        return { success: true }
      },
    }),

    // Update form field
    actionsApi.register({
      id: 'updateFormField',
      async execute(params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const state = getEditState(execContext.userId)
        const field = params.field as keyof EditFormState
        const value = params.value as string

        state.form[field] = value as never

        // Reset OAuth status when provider changes
        if (field === 'provider') {
          state.oauthStatus = 'pending'
          state.oauthUrl = ''
          state.oauthCode = ''
        }

        deps.emitEditChanged()
        return { success: true }
      },
    }),

    // Start OAuth flow
    actionsApi.register({
      id: 'startOAuth',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const userId = execContext.userId
        const userStorage = execContext.userStorage
        const userSecrets = execContext.userSecrets
        const state = getEditState(userId)
        const config = deps.providers.getConfig()

        try {
          if (state.form.provider === 'google') {
            if (!config.googleClientId || !config.googleClientSecret) {
              return {
                success: false,
                error: 'Google OAuth not configured. Please set Client ID and Secret in admin settings.',
              }
            }

            const result = await initiateGoogleCalendarAuth({
              clientId: config.googleClientId,
              clientSecret: config.googleClientSecret,
            })

            state.oauthStatus = 'awaiting'
            state.oauthUrl = result.verificationUrl
            state.oauthCode = result.userCode

            // Start polling in background
            void (async () => {
              const maxAttempts = 60
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, result.interval * 1000))

                try {
                  const token = await pollGoogleCalendarToken(
                    { clientId: config.googleClientId!, clientSecret: config.googleClientSecret! },
                    result.deviceCode
                  )

                  if (token) {
                    const userRepo = new CalendarRepository(userStorage, userSecrets)
                    await userRepo.accounts.upsert(state.editingId || undefined, {
                      provider: state.form.provider as CalendarProvider,
                      name: state.form.name,
                      url: state.form.url || undefined,
                      accessToken: token.accessToken,
                      refreshToken: token.refreshToken,
                      expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
                    })

                    await deps.extensionRepo.registerUser(userId)

                    state.oauthStatus = 'connected'
                    state.showModal = false
                    deleteEditState(userId)
                    deps.emitEditChanged()
                    deps.emitAccountChanged()

                    void deps.scheduleSyncForUser(userId).catch((err) =>
                      deps.log.warn('Failed to schedule sync after OAuth', {
                        error: err instanceof Error ? err.message : String(err),
                      })
                    )
                    return
                  }
                } catch (error) {
                  if (
                    error instanceof Error &&
                    !error.message.includes('authorization_pending') &&
                    !error.message.includes('slow_down')
                  ) {
                    deps.log.warn('OAuth polling failed', { error: error.message })
                    state.oauthStatus = 'pending'
                    deps.emitEditChanged()
                    return
                  }
                }
              }

              // Timeout
              state.oauthStatus = 'pending'
              deps.emitEditChanged()
            })()
          } else if (state.form.provider === 'outlook') {
            const outlookClientId = config.outlookClientId || DEFAULT_OUTLOOK_CALENDAR_CLIENT_ID

            const result = await initiateOutlookCalendarAuth({
              clientId: outlookClientId,
              tenantId: config.outlookTenantId,
            })

            state.oauthStatus = 'awaiting'
            state.oauthUrl = result.verificationUrl
            state.oauthCode = result.userCode

            // Start polling in background
            void (async () => {
              const maxAttempts = 60
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, result.interval * 1000))

                try {
                  const token = await pollOutlookCalendarToken(
                    { clientId: outlookClientId, tenantId: config.outlookTenantId },
                    result.deviceCode
                  )

                  if (token) {
                    const userRepo = new CalendarRepository(userStorage, userSecrets)
                    await userRepo.accounts.upsert(state.editingId || undefined, {
                      provider: state.form.provider as CalendarProvider,
                      name: state.form.name,
                      url: state.form.url || undefined,
                      accessToken: token.accessToken,
                      refreshToken: token.refreshToken,
                      expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
                    })

                    await deps.extensionRepo.registerUser(userId)

                    state.oauthStatus = 'connected'
                    state.showModal = false
                    deleteEditState(userId)
                    deps.emitEditChanged()
                    deps.emitAccountChanged()

                    void deps.scheduleSyncForUser(userId).catch((err) =>
                      deps.log.warn('Failed to schedule sync after OAuth', {
                        error: err instanceof Error ? err.message : String(err),
                      })
                    )
                    return
                  }
                } catch (error) {
                  if (
                    error instanceof Error &&
                    !error.message.includes('authorization_pending') &&
                    !error.message.includes('slow_down')
                  ) {
                    deps.log.warn('OAuth polling failed', { error: error.message })
                    state.oauthStatus = 'pending'
                    deps.emitEditChanged()
                    return
                  }
                }
              }

              // Timeout
              state.oauthStatus = 'pending'
              deps.emitEditChanged()
            })()
          }

          deps.emitEditChanged()
          return { success: true }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Test connection
    actionsApi.register({
      id: 'testConnection',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const state = getEditState(execContext.userId)

        // Build temporary account for testing
        const hasPassword = state.form.provider === 'icloud' || state.form.provider === 'caldav'
        const testAccount = {
          id: 'test',
          userId: execContext.userId,
          provider: state.form.provider as CalendarProvider,
          name: state.form.name,
          url: state.form.url || null,
          authType: hasPassword ? ('password' as const) : ('none' as const),
          credentials: hasPassword
            ? {
                type: 'password' as const,
                username: state.form.username,
                password: state.form.password,
              }
            : { type: 'none' as const },
          enabled: true,
          syncIntervalMs: 600000,
          lastSyncAt: null,
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        try {
          const provider = deps.providers.getRequired(testAccount.provider)
          await provider.testConnection(testAccount, testAccount.credentials)

          return {
            success: true,
            data: {
              connected: true,
              message: 'Connection successful!',
            },
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Save account
    actionsApi.register({
      id: 'saveAccount',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const state = getEditState(execContext.userId)
        const userRepo = createUserRepository(execContext)

        try {
          await userRepo.accounts.upsert(state.editingId || undefined, {
            provider: state.form.provider as CalendarProvider,
            name: state.form.name,
            url: state.form.url || undefined,
            username: state.form.username || undefined,
            password: state.form.password || undefined,
          })

          // Register user in extension-scoped storage for sync discovery
          await deps.extensionRepo.registerUser(execContext.userId)

          state.showModal = false

          // Clean up edit state after save
          deleteEditState(execContext.userId)

          deps.emitEditChanged()
          deps.emitAccountChanged()

          // Schedule sync for this user
          void deps.scheduleSyncForUser(execContext.userId).catch((err) =>
            deps.log.warn('Failed to schedule sync after save', {
              error: err instanceof Error ? err.message : String(err),
            })
          )

          return { success: true }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Delete account
    actionsApi.register({
      id: 'deleteAccount',
      async execute(params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const id = params.id as string
        const userRepo = createUserRepository(execContext)

        try {
          // Clean up events and sync state for this account
          await userRepo.events.deleteByAccount(id)
          await userRepo.syncState.delete(id)

          await userRepo.accounts.delete(id)

          // Check if user has any remaining accounts
          const remainingAccounts = await userRepo.accounts.list()
          if (remainingAccounts.length === 0) {
            await deps.extensionRepo.unregisterUser(execContext.userId)
          }

          deps.emitAccountChanged()
          return { success: true }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Get settings
    actionsApi.register({
      id: 'getSettings',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        try {
          const userRepo = createUserRepository(execContext)
          const settings = await userRepo.settings.get()
          return {
            success: true,
            data: {
              reminderMinutes: settings.reminderMinutes,
              instruction: settings.instruction,
            },
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Update setting
    actionsApi.register({
      id: 'updateSetting',
      async execute(params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        const key = params.key as string
        const value = params.value as string

        try {
          const userRepo = createUserRepository(execContext)

          if (key === 'reminderMinutes') {
            await userRepo.settings.update({ reminderMinutes: parseInt(value, 10) })
          } else if (key === 'instruction') {
            await userRepo.settings.update({ instruction: value })
          }

          deps.emitSettingsChanged()
          return { success: true }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),

    // Get upcoming events
    actionsApi.register({
      id: 'getUpcomingEvents',
      async execute(_params, execContext) {
        if (!execContext.userId) {
          return { success: false, error: 'User context required' }
        }

        try {
          const userRepo = createUserRepository(execContext)

          // Get today's start (midnight) and tomorrow's end (23:59:59)
          const now = new Date()
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59)

          const events = await userRepo.events.getUpcoming(
            todayStart.toISOString(),
            tomorrowEnd.toISOString()
          )

          // Get all accounts for account name lookup
          const accounts = await userRepo.accounts.list()
          const accountMap = new Map(accounts.map((a) => [a.id, a.name]))

          // Group events into "Today" and "Tomorrow"
          const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

          const todayEvents: Array<{ id: string; title: string; time: string; location: string | null; accountName: string }> = []
          const tomorrowEvents: Array<{ id: string; title: string; time: string; location: string | null; accountName: string }> = []

          for (const event of events) {
            const eventStart = new Date(event.startAt)
            const time = event.allDay
              ? 'All day'
              : `${String(eventStart.getHours()).padStart(2, '0')}:${String(eventStart.getMinutes()).padStart(2, '0')}`

            const formatted = {
              id: event.id,
              title: event.title,
              time,
              location: event.location,
              accountName: accountMap.get(event.accountId) || 'Unknown',
            }

            if (eventStart < tomorrow) {
              todayEvents.push(formatted)
            } else {
              tomorrowEvents.push(formatted)
            }
          }

          const groups: Array<{ label: string; events: typeof todayEvents }> = []
          if (todayEvents.length > 0) {
            groups.push({ label: 'Today', events: todayEvents })
          }
          if (tomorrowEvents.length > 0) {
            groups.push({ label: 'Tomorrow', events: tomorrowEvents })
          }

          return { success: true, data: groups }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }),
  ]
}
