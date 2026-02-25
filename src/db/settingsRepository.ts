/**
 * Settings Repository for Calendar extension
 */

import type { StorageAPI } from '@stina/extension-api/runtime'
import type { CalendarSettings, CalendarSettingsUpdate } from '../types.js'

const COLLECTIONS = {
  settings: 'settings',
} as const

interface SettingsDocument {
  id: string
  reminderMinutes: number
  instruction: string
  eventInstruction: string
  createdAt: string
  updatedAt: string
}

export class SettingsRepository {
  private readonly storage: StorageAPI

  constructor(storage: StorageAPI) {
    this.storage = storage
  }

  async get(): Promise<CalendarSettings> {
    const settingsId = 'user-settings'
    const doc = await this.storage.get<SettingsDocument>(COLLECTIONS.settings, settingsId)

    if (doc) {
      return {
        id: doc.id,
        userId: '',
        reminderMinutes: doc.reminderMinutes,
        instruction: doc.instruction,
        eventInstruction: doc.eventInstruction ?? '',
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }
    }

    const now = new Date().toISOString()
    const newDoc: SettingsDocument = {
      id: settingsId,
      reminderMinutes: 15,
      instruction: '',
      eventInstruction: '',
      createdAt: now,
      updatedAt: now,
    }

    await this.storage.put(COLLECTIONS.settings, settingsId, newDoc)

    return {
      id: settingsId,
      userId: '',
      reminderMinutes: 15,
      instruction: '',
      eventInstruction: '',
      createdAt: now,
      updatedAt: now,
    }
  }

  async update(update: CalendarSettingsUpdate): Promise<CalendarSettings> {
    const settings = await this.get()
    const now = new Date().toISOString()

    const reminderMinutes = update.reminderMinutes ?? settings.reminderMinutes
    const instruction = update.instruction ?? settings.instruction
    const eventInstruction = update.eventInstruction ?? settings.eventInstruction

    const doc: SettingsDocument = {
      id: settings.id,
      reminderMinutes,
      instruction,
      eventInstruction,
      createdAt: settings.createdAt,
      updatedAt: now,
    }

    await this.storage.put(COLLECTIONS.settings, settings.id, doc)

    return {
      ...settings,
      reminderMinutes,
      instruction,
      eventInstruction,
      updatedAt: now,
    }
  }
}
