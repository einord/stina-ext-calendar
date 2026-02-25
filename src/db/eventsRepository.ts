/**
 * Events Repository for Calendar extension
 * Local event cache with date-range queries.
 */

import type { StorageAPI } from '@stina/extension-api/runtime'
import type { CalendarEvent, ListEventsOptions } from '../types.js'

const COLLECTIONS = {
  events: 'events',
} as const

function generateId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10)
  const timestamp = Date.now().toString(36)
  return `${prefix}_${timestamp}${random}`
}

interface EventDocument {
  id: string
  accountId: string
  calendarId: string
  uid: string
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  allDay: boolean
  recurrenceRule: string | null
  organizer: string | null
  attendees: string[]
  responseStatus: string | null
  remoteUrl: string | null
  etag: string | null
  rawIcs: string | null
  createdAt: string
  updatedAt: string
}

export class EventsRepository {
  private readonly storage: StorageAPI

  constructor(storage: StorageAPI) {
    this.storage = storage
  }

  async list(options: ListEventsOptions = {}): Promise<CalendarEvent[]> {
    const { accountId, from, to, limit = 100, offset = 0 } = options

    const query: Record<string, unknown> = {}
    if (accountId) query.accountId = accountId

    const docs = await this.storage.find<EventDocument>(
      COLLECTIONS.events,
      query,
      { sort: { startAt: 'asc' }, limit: limit + offset }
    )

    let filtered = docs
    if (from) {
      filtered = filtered.filter(d => d.endAt >= from)
    }
    if (to) {
      filtered = filtered.filter(d => d.startAt <= to)
    }

    // Exclude declined events
    filtered = filtered.filter(d => d.responseStatus !== 'declined')

    return filtered.slice(offset, offset + limit).map(this.toCalendarEvent)
  }

  async get(id: string): Promise<CalendarEvent | null> {
    const doc = await this.storage.get<EventDocument>(COLLECTIONS.events, id)
    if (!doc) return null
    return this.toCalendarEvent(doc)
  }

  async getByUid(accountId: string, uid: string): Promise<CalendarEvent | null> {
    const doc = await this.storage.findOne<EventDocument>(COLLECTIONS.events, {
      accountId,
      uid,
    })
    if (!doc) return null
    return this.toCalendarEvent(doc)
  }

  async upsertByUid(accountId: string, event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<CalendarEvent> {
    const now = new Date().toISOString()
    const existing = await this.getByUid(accountId, event.uid)

    if (existing) {
      const doc: EventDocument = {
        id: existing.id,
        accountId,
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
        responseStatus: event.responseStatus ?? null,
        remoteUrl: event.remoteUrl,
        etag: event.etag,
        rawIcs: event.rawIcs,
        createdAt: existing.createdAt,
        updatedAt: now,
      }

      await this.storage.put(COLLECTIONS.events, existing.id, doc)
      return this.toCalendarEvent(doc)
    }

    const id = generateId('evt')
    const doc: EventDocument = {
      id,
      accountId,
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
      responseStatus: event.responseStatus ?? null,
      remoteUrl: event.remoteUrl,
      etag: event.etag,
      rawIcs: event.rawIcs,
      createdAt: now,
      updatedAt: now,
    }

    await this.storage.put(COLLECTIONS.events, id, doc)
    return this.toCalendarEvent(doc)
  }

  async delete(id: string): Promise<boolean> {
    const doc = await this.storage.get<EventDocument>(COLLECTIONS.events, id)
    if (!doc) return false
    await this.storage.delete(COLLECTIONS.events, id)
    return true
  }

  async deleteByAccount(accountId: string): Promise<void> {
    await this.storage.deleteMany(COLLECTIONS.events, { accountId })
  }

  async getUpcoming(fromDate: string, toDate: string): Promise<CalendarEvent[]> {
    return this.list({ from: fromDate, to: toDate, limit: 200 })
  }

  private toCalendarEvent(doc: EventDocument): CalendarEvent {
    return {
      id: doc.id,
      accountId: doc.accountId,
      calendarId: doc.calendarId,
      uid: doc.uid,
      title: doc.title,
      description: doc.description,
      location: doc.location,
      startAt: doc.startAt,
      endAt: doc.endAt,
      allDay: doc.allDay,
      recurrenceRule: doc.recurrenceRule,
      organizer: doc.organizer,
      attendees: doc.attendees,
      responseStatus: (doc.responseStatus as CalendarEvent['responseStatus']) ?? null,
      remoteUrl: doc.remoteUrl,
      etag: doc.etag,
      rawIcs: doc.rawIcs,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }
}
