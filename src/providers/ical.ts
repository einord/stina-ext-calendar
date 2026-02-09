/**
 * iCal URL Calendar Provider (read-only)
 */

import type { CalendarAccount, CalendarCredentials, CalendarEvent, CalendarEventInput, CalendarEventUpdate } from '../types.js'
import type { CalendarProviderInterface, RemoteCalendar, SyncResult } from './types.js'
import { parseICalData } from '../ical/parser.js'

export class ICalProvider implements CalendarProviderInterface {
  readonly supportsWrite = false

  async testConnection(account: CalendarAccount, _credentials: CalendarCredentials): Promise<void> {
    if (!account.url) {
      throw new Error('Calendar URL is required')
    }

    const response = await fetch(account.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    if (!text.includes('BEGIN:VCALENDAR')) {
      throw new Error('URL does not contain valid iCal data')
    }
  }

  async listCalendars(account: CalendarAccount, _credentials: CalendarCredentials): Promise<RemoteCalendar[]> {
    return [{
      id: 'default',
      name: account.name,
      readOnly: true,
    }]
  }

  async syncEvents(
    account: CalendarAccount,
    _credentials: CalendarCredentials,
    from: Date,
    to: Date,
    _syncToken?: string | null
  ): Promise<SyncResult> {
    if (!account.url) {
      throw new Error('Calendar URL is required')
    }

    const response = await fetch(account.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`)
    }

    const icalData = await response.text()
    const parsed = parseICalData(icalData, account.id, 'default', from, to)

    const events: CalendarEvent[] = parsed.map((e) => ({
      ...e,
      id: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    return { events, fullSync: true }
  }

  async createEvent(): Promise<CalendarEvent> {
    throw new Error('iCal URL calendars are read-only')
  }

  async updateEvent(): Promise<CalendarEvent> {
    throw new Error('iCal URL calendars are read-only')
  }

  async deleteEvent(): Promise<void> {
    throw new Error('iCal URL calendars are read-only')
  }
}
