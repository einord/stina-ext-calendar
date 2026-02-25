/**
 * Accounts Repository for Calendar extension
 */

import type { StorageAPI, SecretsAPI } from '@stina/extension-api/runtime'
import type {
  CalendarAccount,
  CalendarAccountInput,
  CalendarCredentials,
  ListAccountsOptions,
  AuthType,
  CalendarProvider,
  CalendarAccountCalendar,
} from '../types.js'

const COLLECTIONS = {
  accounts: 'accounts',
} as const

function generateId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10)
  const timestamp = Date.now().toString(36)
  return `${prefix}_${timestamp}${random}`
}

function getCredentialsKey(accountId: string): string {
  return `account-${accountId}-credentials`
}

interface AccountDocument {
  id: string
  provider: CalendarProvider
  name: string
  url: string | null
  authType: AuthType
  enabled: boolean
  syncIntervalMs: number
  lastSyncAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  calendars?: Array<{ id: string; name: string; color?: string; enabled: boolean }>
}

export class AccountsRepository {
  private readonly storage: StorageAPI
  private readonly secrets: SecretsAPI

  constructor(storage: StorageAPI, secrets: SecretsAPI) {
    this.storage = storage
    this.secrets = secrets
  }

  async list(options: ListAccountsOptions = {}): Promise<CalendarAccount[]> {
    const { limit = 50, offset = 0 } = options
    const docs = await this.storage.find<AccountDocument>(
      COLLECTIONS.accounts,
      {},
      { sort: { name: 'asc' }, limit, offset }
    )

    const accounts: CalendarAccount[] = []
    for (const doc of docs) {
      const credentials = await this.loadCredentials(doc.id, doc.authType)
      accounts.push(this.toCalendarAccount(doc, credentials))
    }
    return accounts
  }

  async get(id: string): Promise<CalendarAccount | null> {
    const doc = await this.storage.get<AccountDocument>(COLLECTIONS.accounts, id)
    if (!doc) return null
    const credentials = await this.loadCredentials(id, doc.authType)
    return this.toCalendarAccount(doc, credentials)
  }

  async upsert(id: string | undefined, input: CalendarAccountInput): Promise<CalendarAccount> {
    const now = new Date().toISOString()
    const accountId = id ?? generateId('cal')
    const existing = id ? await this.get(id) : null

    let credentials: CalendarCredentials
    let authType: AuthType

    if (input.accessToken && input.refreshToken) {
      authType = 'oauth2'
      credentials = {
        type: 'oauth2',
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt ?? new Date(Date.now() + 3600 * 1000).toISOString(),
      }
    } else if (input.password) {
      authType = 'password'
      credentials = {
        type: 'password',
        username: input.username ?? '',
        password: input.password,
      }
    } else {
      authType = 'none'
      credentials = { type: 'none' }
    }

    if (existing) {
      const name = input.name ?? existing.name
      const provider = input.provider ?? existing.provider
      const url = input.url !== undefined ? input.url : existing.url
      const enabled = input.enabled !== undefined ? input.enabled : existing.enabled
      const syncIntervalMs = input.syncIntervalMs !== undefined ? input.syncIntervalMs : existing.syncIntervalMs

      const finalCredentials =
        input.password || input.accessToken ? credentials : existing.credentials
      const finalAuthType = input.password || input.accessToken ? authType : existing.authType

      const doc: AccountDocument = {
        id: accountId,
        provider,
        name,
        url: url ?? null,
        authType: finalAuthType,
        enabled,
        syncIntervalMs,
        lastSyncAt: existing.lastSyncAt,
        lastError: existing.lastError,
        createdAt: existing.createdAt,
        updatedAt: now,
      }

      await this.storage.put(COLLECTIONS.accounts, accountId, doc)

      if (input.password || input.accessToken) {
        await this.saveCredentials(accountId, finalCredentials)
      }

      return this.toCalendarAccount(doc, finalCredentials)
    }

    if (!input.name || !input.provider) {
      throw new Error('Name and provider are required for new accounts')
    }

    const defaultSyncInterval = input.provider === 'ical' ? 30 * 60 * 1000 : 10 * 60 * 1000

    const doc: AccountDocument = {
      id: accountId,
      provider: input.provider,
      name: input.name,
      url: input.url ?? null,
      authType,
      enabled: input.enabled !== false,
      syncIntervalMs: input.syncIntervalMs ?? defaultSyncInterval,
      lastSyncAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }

    await this.storage.put(COLLECTIONS.accounts, accountId, doc)
    await this.saveCredentials(accountId, credentials)

    return this.toCalendarAccount(doc, credentials)
  }

  async delete(id: string): Promise<boolean> {
    const doc = await this.storage.get<AccountDocument>(COLLECTIONS.accounts, id)
    if (!doc) return false

    await this.secrets.delete(getCredentialsKey(id))
    await this.storage.delete(COLLECTIONS.accounts, id)
    return true
  }

  async updateSyncStatus(id: string, error: string | null): Promise<void> {
    const doc = await this.storage.get<AccountDocument>(COLLECTIONS.accounts, id)
    if (!doc) return

    const now = new Date().toISOString()
    const updatedDoc: AccountDocument = {
      ...doc,
      lastSyncAt: now,
      lastError: error,
      updatedAt: now,
    }

    await this.storage.put(COLLECTIONS.accounts, id, updatedDoc)
  }

  async updateCredentials(id: string, credentials: CalendarCredentials): Promise<void> {
    const doc = await this.storage.get<AccountDocument>(COLLECTIONS.accounts, id)
    if (!doc) return

    const now = new Date().toISOString()
    await this.storage.put(COLLECTIONS.accounts, id, { ...doc, updatedAt: now })
    await this.saveCredentials(id, credentials)
  }

  async updateCalendars(id: string, calendars: CalendarAccountCalendar[]): Promise<void> {
    const doc = await this.storage.get<AccountDocument>(COLLECTIONS.accounts, id)
    if (!doc) return

    const now = new Date().toISOString()
    await this.storage.put(COLLECTIONS.accounts, id, { ...doc, calendars, updatedAt: now })
  }

  private async saveCredentials(accountId: string, credentials: CalendarCredentials): Promise<void> {
    const key = getCredentialsKey(accountId)
    await this.secrets.set(key, JSON.stringify(credentials))
  }

  private async loadCredentials(accountId: string, authType: AuthType): Promise<CalendarCredentials> {
    const key = getCredentialsKey(accountId)
    const stored = await this.secrets.get(key)

    if (stored) {
      return JSON.parse(stored) as CalendarCredentials
    }

    if (authType === 'oauth2') {
      return { type: 'oauth2', accessToken: '', refreshToken: '', expiresAt: '' }
    }
    if (authType === 'password') {
      return { type: 'password', username: '', password: '' }
    }
    return { type: 'none' }
  }

  private toCalendarAccount(doc: AccountDocument, credentials: CalendarCredentials): CalendarAccount {
    return {
      id: doc.id,
      userId: '',
      provider: doc.provider,
      name: doc.name,
      url: doc.url,
      authType: doc.authType,
      credentials,
      enabled: doc.enabled,
      syncIntervalMs: doc.syncIntervalMs,
      lastSyncAt: doc.lastSyncAt,
      lastError: doc.lastError,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      calendars: doc.calendars ?? [],
    }
  }
}
