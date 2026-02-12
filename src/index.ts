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
import { syncAllAccountsWithContext } from './sync.js'
import { createCalendarWorkerManager } from './worker.js'
import { clearAllEditStates } from './edit-state.js'
import type { CredentialRefreshConfig } from './credentials.js'
import type { ChatAPI, UserAPI } from './shared-deps.js'

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

async function activate(context: ExtensionContext): Promise<Disposable> {
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
  const backgroundWorkers = context.backgroundWorkers
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

  await loadProviderConfig()

  // Build credential refresh config (after provider config is loaded)
  const providerConfig = providers.getConfig()
  const credentialConfig: CredentialRefreshConfig = {
    googleClientId: providerConfig.googleClientId,
    googleClientSecret: providerConfig.googleClientSecret,
    outlookClientId: providerConfig.outlookClientId,
    outlookTenantId: providerConfig.outlookTenantId,
  }

  // Sync dependencies (used by triggerImmediateSync)
  const syncDeps = {
    providers,
    extensionRepo,
    credentialConfig,
    chat,
    user,
    log: context.log,
    emitEventChanged,
  }

  // Set up background worker manager
  const workerManager = createCalendarWorkerManager({
    providers,
    extensionRepo,
    credentialConfig,
    backgroundWorkers,
    chat,
    user,
    log: context.log,
    emitEventChanged,
  })

  // Register UI actions
  const actionDisposables = actionsApi
    ? registerActions(actionsApi, {
        extensionRepo,
        providers,
        emitAccountChanged,
        emitSettingsChanged,
        emitEditChanged,
        emitEventChanged,
        startWorkerForUser: workerManager.startWorkerForUser,
        triggerImmediateSync: (execContext) => syncAllAccountsWithContext(execContext, syncDeps),
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
    context.tools!.register(createCreateEventTool(providers, credentialConfig, emitEventChanged)),
    context.tools!.register(createUpdateEventTool(providers, credentialConfig, emitEventChanged)),
    context.tools!.register(createDeleteEventTool(providers, credentialConfig, emitEventChanged)),
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

  // Auto-start workers for all existing users with accounts
  void (async () => {
    try {
      const userIds = await extensionRepo.getAllUserIds()
      for (const userId of userIds) {
        await workerManager.startWorkerForUser(userId)
      }
    } catch (err) {
      context.log.warn('Failed to initialize workers for existing users', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()

  return {
    dispose: () => {
      workerManager.stopAll()
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
