/**
 * Sync State Repository for Calendar extension
 * Tracks incremental sync tokens per account.
 */

import type { StorageAPI } from '@stina/extension-api/runtime'
import type { SyncState } from '../types.js'

const COLLECTIONS = {
  syncState: 'syncState',
} as const

interface SyncStateDocument {
  id: string
  accountId: string
  syncToken: string | null
  deltaLink: string | null
  lastSyncAt: string
  updatedAt: string
}

export class SyncStateRepository {
  private readonly storage: StorageAPI

  constructor(storage: StorageAPI) {
    this.storage = storage
  }

  async get(accountId: string): Promise<SyncState | null> {
    const doc = await this.storage.findOne<SyncStateDocument>(COLLECTIONS.syncState, { accountId })
    if (!doc) return null
    return this.toSyncState(doc)
  }

  async upsert(accountId: string, syncToken: string | null, deltaLink: string | null): Promise<SyncState> {
    const now = new Date().toISOString()
    const existing = await this.storage.findOne<SyncStateDocument>(COLLECTIONS.syncState, { accountId })

    if (existing) {
      const doc: SyncStateDocument = {
        ...existing,
        syncToken,
        deltaLink,
        lastSyncAt: now,
        updatedAt: now,
      }
      await this.storage.put(COLLECTIONS.syncState, existing.id, doc)
      return this.toSyncState(doc)
    }

    const id = `sync_${accountId}`
    const doc: SyncStateDocument = {
      id,
      accountId,
      syncToken,
      deltaLink,
      lastSyncAt: now,
      updatedAt: now,
    }
    await this.storage.put(COLLECTIONS.syncState, id, doc)
    return this.toSyncState(doc)
  }

  async delete(accountId: string): Promise<void> {
    await this.storage.deleteMany(COLLECTIONS.syncState, { accountId })
  }

  private toSyncState(doc: SyncStateDocument): SyncState {
    return {
      id: doc.id,
      accountId: doc.accountId,
      syncToken: doc.syncToken,
      deltaLink: doc.deltaLink,
      lastSyncAt: doc.lastSyncAt,
      updatedAt: doc.updatedAt,
    }
  }
}
