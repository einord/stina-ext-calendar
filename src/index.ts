/**
 * Calendar Extension for Stina
 *
 * Syncs calendar events from configured accounts and provides event management.
 * Uses the Extension Storage API for data persistence and Secrets API for credentials.
 */

import {
  initializeExtension,
  type ExtensionContext,
  type ExecutionContext,
  type Disposable,
  type StorageAPI,
  type SecretsAPI,
} from '@stina/extension-api/runtime'
import { ExtensionRepository } from './db/repository.js'
import { ProviderRegistry, type ProviderConfig } from './providers/index.js'
import {
  createListAccountsTool,
  createAddAccountTool,
  createUpdateAccountTool,
  createDeleteAccountTool,
  createTestAccountTool,
  createListEventsTool,
  createGetEventTool,
  createCreateEventTool,
  createUpdateEventTool,
  createDeleteEventTool,
  createSyncEventsTool,
  createGetSettingsTool,
  createUpdateSettingsTool,
} from './tools/index.js'
import { registerActions } from './actions/index.js'
import { createSyncScheduler, syncAllAccountsWithContext } from './sync.js'
import { setupReminderListener, scheduleReminders } from './reminders.js'
import { clearAllEditStates } from './edit-state.js'
import type { CredentialRefreshConfig } from './credentials.js'

type EventsApi = { emit: (name: string, payload?: Record<string, unknown>) => Promise<void> }

type ActionsApi = {
  register: (action: {
    id: string
    execute: (
      params: Record<string, unknown>,
      execContext: ExecutionContext
    ) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }) => { dispose: () => void }
}

type SettingsApi = {
  get: <T = string>(key: string) => Promise<T | undefined>
}

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

function activate(context: ExtensionContext): Disposable {
  context.log.info('Activating Calendar extension')

  // Check for required permissions
  if (!context.storage) {
    context.log.warn('Storage permission missing; Calendar extension disabled')
    return { dispose: () => undefined }
  }

  if (!context.secrets) {
    context.log.warn('Secrets permission missing; Calendar extension disabled')
    return { dispose: () => undefined }
  }

  // Extension-scoped repository for tracking users across the system
  const extensionRepo = new ExtensionRepository(context.storage)

  const providers = new ProviderRegistry()
  const eventsApi = (context as ExtensionContext & { events?: EventsApi }).events
  const actionsApi = (context as ExtensionContext & { actions?: ActionsApi }).actions
  const settingsApi = (context as ExtensionContext & { settings?: SettingsApi }).settings
  const chat = (context as ExtensionContext & { chat?: ChatAPI }).chat
  const scheduler = (context as ExtensionContext & { scheduler?: SchedulerAPI }).scheduler
  const user = (context as ExtensionContext & { user?: UserAPI }).user

  // Event emitters
  const emitAccountChanged = () => {
    if (!eventsApi) return
    void eventsApi.emit('calendar.account.changed', { at: new Date().toISOString() })
  }

  const emitSettingsChanged = () => {
    if (!eventsApi) return
    void eventsApi.emit('calendar.settings.changed', { at: new Date().toISOString() })
  }

  const emitEditChanged = () => {
    if (!eventsApi) return
    void eventsApi.emit('calendar.edit.changed', { at: new Date().toISOString() })
  }

  const emitEventChanged = () => {
    if (!eventsApi) return
    void eventsApi.emit('calendar.event.changed', { at: new Date().toISOString() })
  }

  // Load OAuth configuration from settings
  const loadProviderConfig = async (): Promise<void> => {
    if (!settingsApi) return

    const config: ProviderConfig = {}

    const googleClientId = await settingsApi.get<string>('google_client_id')
    const googleClientSecret = await settingsApi.get<string>('google_client_secret')
    const outlookClientId = await settingsApi.get<string>('outlook_client_id')
    const outlookTenantId = await settingsApi.get<string>('outlook_tenant_id')

    if (googleClientId) config.googleClientId = googleClientId
    if (googleClientSecret) config.googleClientSecret = googleClientSecret
    if (outlookClientId) config.outlookClientId = outlookClientId
    if (outlookTenantId) config.outlookTenantId = outlookTenantId

    providers.setConfig(config)
  }

  void loadProviderConfig()

  // Build credential refresh config
  const providerConfig = providers.getConfig()
  const credentialConfig: CredentialRefreshConfig = {
    googleClientId: providerConfig.googleClientId,
    googleClientSecret: providerConfig.googleClientSecret,
    outlookClientId: providerConfig.outlookClientId,
    outlookTenantId: providerConfig.outlookTenantId,
  }

  // Reminder dependencies
  const reminderDeps = {
    chat,
    scheduler,
    user,
    log: context.log,
  }

  // Sync dependencies
  const syncDeps = {
    providers,
    extensionRepo,
    credentialConfig,
    chat,
    scheduler,
    user,
    log: context.log,
    scheduleReminders: (userId: string, userStorage: StorageAPI, userSecrets: SecretsAPI) =>
      scheduleReminders(userId, userStorage, userSecrets, reminderDeps),
  }

  // Set up sync scheduler
  const syncScheduler = createSyncScheduler(syncDeps)

  // Set up reminder listener
  const reminderDisposable = setupReminderListener(reminderDeps)

  // Register UI actions
  const actionDisposables = actionsApi
    ? registerActions(actionsApi, {
        extensionRepo,
        providers,
        emitAccountChanged,
        emitSettingsChanged,
        emitEditChanged,
        emitEventChanged,
        scheduleSyncForUser: syncScheduler.scheduleSyncForUser,
        log: context.log,
      })
    : []

  // Register tools
  const disposables = [
    ...actionDisposables,
    context.tools!.register(createListAccountsTool()),
    context.tools!.register(createAddAccountTool(providers)),
    context.tools!.register(createUpdateAccountTool()),
    context.tools!.register(
      createDeleteAccountTool((accountId) => {
        emitAccountChanged()
      })
    ),
    context.tools!.register(createTestAccountTool(providers)),
    context.tools!.register(createListEventsTool()),
    context.tools!.register(createGetEventTool()),
    context.tools!.register(createCreateEventTool(providers, credentialConfig)),
    context.tools!.register(createUpdateEventTool(providers, credentialConfig)),
    context.tools!.register(createDeleteEventTool(providers, credentialConfig)),
    context.tools!.register(createSyncEventsTool(providers, credentialConfig)),
    context.tools!.register(createGetSettingsTool()),
    context.tools!.register(
      createUpdateSettingsTool(() => emitSettingsChanged())
    ),
  ]

  context.log.info('Calendar extension registered', {
    tools: [
      'cal_accounts_list',
      'cal_accounts_add',
      'cal_accounts_update',
      'cal_accounts_delete',
      'cal_accounts_test',
      'cal_events_list',
      'cal_events_get',
      'cal_events_create',
      'cal_events_update',
      'cal_events_delete',
      'cal_events_sync',
      'cal_settings_get',
      'cal_settings_update',
    ],
    actions: actionsApi
      ? [
          'getAccounts',
          'getEditState',
          'showAddForm',
          'editAccount',
          'closeModal',
          'updateFormField',
          'startOAuth',
          'testConnection',
          'saveAccount',
          'deleteAccount',
          'getSettings',
          'updateSetting',
          'getUpcomingEvents',
        ]
      : [],
  })

  // Listen for scheduler events
  const schedulerDisposable = syncScheduler.setupSchedulerListener()

  // Auto-start sync for all existing users with accounts
  void syncScheduler.initializeSyncForExistingUsers().catch((err) =>
    context.log.warn('Failed to initialize sync', {
      error: err instanceof Error ? err.message : String(err),
    })
  )

  return {
    dispose: () => {
      schedulerDisposable?.dispose()
      reminderDisposable?.dispose()
      syncScheduler.cancelAll()
      clearAllEditStates()
      for (const disposable of disposables) {
        disposable.dispose()
      }
      context.log.info('Calendar extension deactivated')
    },
  }
}

function deactivate(): void {
  // Cleanup handled by disposable returned from activate
}

initializeExtension({ activate, deactivate })
