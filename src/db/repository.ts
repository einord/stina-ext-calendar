/**
 * Calendar Repository - Main repository facade
 */

import type { StorageAPI, SecretsAPI } from '@stina/extension-api/runtime'
import { AccountsRepository } from './accountsRepository.js'
import { SettingsRepository } from './settingsRepository.js'
import { EventsRepository } from './eventsRepository.js'
import { SyncStateRepository } from './syncStateRepository.js'

export class CalendarRepository {
  readonly accounts: AccountsRepository
  readonly settings: SettingsRepository
  readonly events: EventsRepository
  readonly syncState: SyncStateRepository

  constructor(storage: StorageAPI, secrets: SecretsAPI) {
    this.accounts = new AccountsRepository(storage, secrets)
    this.settings = new SettingsRepository(storage)
    this.events = new EventsRepository(storage)
    this.syncState = new SyncStateRepository(storage)
  }
}

export class ExtensionRepository {
  private readonly storage: StorageAPI

  constructor(storage: StorageAPI) {
    this.storage = storage
  }

  async registerUser(userId: string): Promise<void> {
    await this.storage.put('users', userId, { id: userId, registeredAt: new Date().toISOString() })
  }

  async unregisterUser(userId: string): Promise<void> {
    await this.storage.delete('users', userId)
  }

  async getAllUserIds(): Promise<string[]> {
    const docs = await this.storage.find<{ id: string }>('users')
    return docs.map((doc) => doc.id)
  }
}
