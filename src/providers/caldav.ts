/**
 * Generic CalDAV Calendar Provider via tsdav
 */

import { DAVClient } from 'tsdav'
import type { CalendarAccount, CalendarCredentials, CalendarEvent, CalendarEventInput, CalendarEventUpdate } from '../types.js'
import type { CalendarProviderInterface, RemoteCalendar, SyncResult } from './types.js'
import { parseICalData } from '../ical/parser.js'
import { generateICalEvent, generateUpdatedICalEvent } from '../ical/generator.js'

function generateUid(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}@stina`
}

function createDavClient(account: CalendarAccount, credentials: CalendarCredentials): DAVClient {
  if (credentials.type !== 'password') {
    throw new Error('CalDAV requires password credentials')
  }

  return new DAVClient({
    serverUrl: account.url || '',
    credentials: {
      username: credentials.username,
      password: credentials.password,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })
}

export class CalDavProvider implements CalendarProviderInterface {
  readonly supportsWrite = true

  async testConnection(account: CalendarAccount, credentials: CalendarCredentials): Promise<void> {
    const client = createDavClient(account, credentials)
    await client.login()
    const calendars = await client.fetchCalendars()
    if (!calendars || calendars.length === 0) {
      throw new Error('No calendars found on this CalDAV server')
    }
  }

  async listCalendars(account: CalendarAccount, credentials: CalendarCredentials): Promise<RemoteCalendar[]> {
    const client = createDavClient(account, credentials)
    await client.login()
    const calendars = await client.fetchCalendars()

    return calendars.map((cal) => ({
      id: cal.url,
      name: (typeof cal.displayName === 'string' ? cal.displayName : '') || 'Calendar',
      readOnly: false,
    }))
  }

  async syncEvents(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    from: Date,
    to: Date,
    _syncToken?: string | null
  ): Promise<SyncResult> {
    const client = createDavClient(account, credentials)
    await client.login()
    const calendars = await client.fetchCalendars()

    const userEmail = credentials.type === 'password' ? credentials.username : undefined
    const allEvents: CalendarEvent[] = []

    for (const cal of calendars) {
      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: {
          start: from.toISOString(),
          end: to.toISOString(),
        },
      })

      for (const obj of objects) {
        if (!obj.data) continue
        const parsed = parseICalData(obj.data, account.id, cal.url, from, to, userEmail)
        for (const e of parsed) {
          allEvents.push({
            ...e,
            id: '',
            remoteUrl: obj.url || null,
            etag: obj.etag || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        }
      }
    }

    return { events: allEvents, fullSync: true }
  }

  async createEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    input: CalendarEventInput
  ): Promise<CalendarEvent> {
    const client = createDavClient(account, credentials)
    await client.login()
    const calendars = await client.fetchCalendars()

    const targetCal = input.calendarId
      ? calendars.find((c) => c.url === input.calendarId)
      : calendars[0]

    if (!targetCal) throw new Error('Calendar not found')

    const uid = generateUid()
    const icalData = generateICalEvent(input, uid)

    await client.createCalendarObject({
      calendar: targetCal,
      filename: `${uid}.ics`,
      iCalString: icalData,
    })

    const now = new Date().toISOString()
    return {
      id: '',
      accountId: account.id,
      calendarId: targetCal.url,
      uid,
      title: input.title,
      description: input.description || null,
      location: input.location || null,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay || false,
      recurrenceRule: null,
      organizer: null,
      attendees: input.attendees || [],
      responseStatus: null,
      remoteUrl: null,
      etag: null,
      rawIcs: icalData,
      createdAt: now,
      updatedAt: now,
    }
  }

  async updateEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    _eventId: string,
    update: CalendarEventUpdate,
    existingEvent: CalendarEvent
  ): Promise<CalendarEvent> {
    const client = createDavClient(account, credentials)
    await client.login()

    if (!existingEvent.remoteUrl) {
      throw new Error('Cannot update event: missing remote URL')
    }

    const icalData = generateUpdatedICalEvent(existingEvent, update)

    await client.updateCalendarObject({
      calendarObject: {
        url: existingEvent.remoteUrl,
        data: icalData,
        etag: existingEvent.etag || undefined,
      },
    })

    const now = new Date().toISOString()
    return {
      ...existingEvent,
      title: update.title ?? existingEvent.title,
      description: update.description !== undefined ? update.description : existingEvent.description,
      location: update.location !== undefined ? update.location : existingEvent.location,
      startAt: update.startAt ?? existingEvent.startAt,
      endAt: update.endAt ?? existingEvent.endAt,
      allDay: update.allDay ?? existingEvent.allDay,
      attendees: update.attendees ?? existingEvent.attendees,
      rawIcs: icalData,
      updatedAt: now,
    }
  }

  async deleteEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    _eventId: string,
    existingEvent: CalendarEvent
  ): Promise<void> {
    const client = createDavClient(account, credentials)
    await client.login()

    if (!existingEvent.remoteUrl) {
      throw new Error('Cannot delete event: missing remote URL')
    }

    await client.deleteCalendarObject({
      calendarObject: {
        url: existingEvent.remoteUrl,
        etag: existingEvent.etag || undefined,
      },
    })
  }
}
