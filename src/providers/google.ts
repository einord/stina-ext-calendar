/**
 * Google Calendar Provider (REST API v3)
 */

import type { CalendarAccount, CalendarCredentials, CalendarEvent, CalendarEventInput, CalendarEventUpdate } from '../types.js'
import type { CalendarProviderInterface, RemoteCalendar, SyncResult } from './types.js'

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'

function getAccessToken(credentials: CalendarCredentials): string {
  if (credentials.type !== 'oauth2') {
    throw new Error('Google Calendar requires OAuth2 credentials')
  }
  return credentials.accessToken
}

async function googleFetch(path: string, token: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${GOOGLE_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Google Calendar API error (${response.status}): ${errorBody}`)
  }

  return response
}

export class GoogleCalendarProvider implements CalendarProviderInterface {
  readonly supportsWrite = true

  async testConnection(_account: CalendarAccount, credentials: CalendarCredentials): Promise<void> {
    const token = getAccessToken(credentials)
    await googleFetch('/users/me/calendarList?maxResults=1', token)
  }

  async listCalendars(_account: CalendarAccount, credentials: CalendarCredentials): Promise<RemoteCalendar[]> {
    const token = getAccessToken(credentials)
    const response = await googleFetch('/users/me/calendarList', token)
    const data = await response.json()

    return (data.items || []).map((cal: Record<string, unknown>) => ({
      id: cal.id as string,
      name: cal.summary as string || 'Calendar',
      color: cal.backgroundColor as string | undefined,
      readOnly: cal.accessRole === 'reader' || cal.accessRole === 'freeBusyReader',
    }))
  }

  async syncEvents(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    from: Date,
    to: Date,
    syncToken?: string | null
  ): Promise<SyncResult> {
    const token = getAccessToken(credentials)
    const calendars = await this.listCalendars(account, credentials)
    const allEvents: CalendarEvent[] = []
    const deletedUids: string[] = []
    let newSyncToken: string | null = null

    for (const cal of calendars) {
      let url: string
      if (syncToken) {
        url = `/calendars/${encodeURIComponent(cal.id)}/events?syncToken=${encodeURIComponent(syncToken)}&singleEvents=true`
      } else {
        url = `/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${from.toISOString()}&timeMax=${to.toISOString()}&singleEvents=true&maxResults=2500`
      }

      try {
        const response = await googleFetch(url, token)
        const data = await response.json()

        if (data.nextSyncToken) {
          newSyncToken = data.nextSyncToken
        }

        for (const item of data.items || []) {
          if (item.status === 'cancelled') {
            const uid = item.iCalUID || item.id
            if (uid) deletedUids.push(uid)
            continue
          }

          const startAt = item.start?.dateTime || item.start?.date
          const endAt = item.end?.dateTime || item.end?.date
          if (!startAt) continue

          const now = new Date().toISOString()
          allEvents.push({
            id: '',
            accountId: account.id,
            calendarId: cal.id,
            uid: item.iCalUID || item.id,
            title: item.summary || '(No title)',
            description: item.description || null,
            location: item.location || null,
            startAt: new Date(startAt).toISOString(),
            endAt: endAt ? new Date(endAt).toISOString() : new Date(startAt).toISOString(),
            allDay: !item.start?.dateTime,
            recurrenceRule: null,
            organizer: item.organizer?.email || null,
            attendees: (item.attendees || []).map((a: Record<string, string>) => a.email),
            remoteUrl: item.htmlLink || null,
            etag: item.etag || null,
            rawIcs: null,
            createdAt: now,
            updatedAt: now,
          })
        }
      } catch {
        // If syncToken is invalid, fall back to full sync on next attempt
        continue
      }
    }

    return {
      events: allEvents,
      deletedUids: deletedUids.length > 0 ? deletedUids : undefined,
      syncToken: newSyncToken,
      fullSync: !syncToken,
    }
  }

  async createEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    input: CalendarEventInput
  ): Promise<CalendarEvent> {
    const token = getAccessToken(credentials)
    const calendarId = input.calendarId || 'primary'

    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description || undefined,
      location: input.location || undefined,
    }

    if (input.allDay) {
      body.start = { date: input.startAt.split('T')[0] }
      body.end = { date: input.endAt.split('T')[0] }
    } else {
      body.start = { dateTime: input.startAt }
      body.end = { dateTime: input.endAt }
    }

    if (input.attendees?.length) {
      body.attendees = input.attendees.map((email) => ({ email }))
    }

    const response = await googleFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      token,
      { method: 'POST', body: JSON.stringify(body) }
    )

    const item = await response.json()
    const now = new Date().toISOString()

    return {
      id: '',
      accountId: account.id,
      calendarId,
      uid: item.iCalUID || item.id,
      title: item.summary || input.title,
      description: item.description || null,
      location: item.location || null,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay || false,
      recurrenceRule: null,
      organizer: item.organizer?.email || null,
      attendees: (item.attendees || []).map((a: Record<string, string>) => a.email),
      remoteUrl: item.htmlLink || null,
      etag: item.etag || null,
      rawIcs: null,
      createdAt: now,
      updatedAt: now,
    }
  }

  async updateEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    eventId: string,
    update: CalendarEventUpdate,
    existingEvent: CalendarEvent
  ): Promise<CalendarEvent> {
    const token = getAccessToken(credentials)
    const calendarId = existingEvent.calendarId || 'primary'

    const body: Record<string, unknown> = {
      summary: update.title ?? existingEvent.title,
      description: update.description !== undefined ? update.description : existingEvent.description,
      location: update.location !== undefined ? update.location : existingEvent.location,
    }

    const isAllDay = update.allDay ?? existingEvent.allDay
    const startAt = update.startAt ?? existingEvent.startAt
    const endAt = update.endAt ?? existingEvent.endAt

    if (isAllDay) {
      body.start = { date: startAt.split('T')[0] }
      body.end = { date: endAt.split('T')[0] }
    } else {
      body.start = { dateTime: startAt }
      body.end = { dateTime: endAt }
    }

    const attendees = update.attendees ?? existingEvent.attendees
    if (attendees.length) {
      body.attendees = attendees.map((email) => ({ email }))
    }

    const response = await googleFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      token,
      { method: 'PATCH', body: JSON.stringify(body) }
    )

    const item = await response.json()
    const now = new Date().toISOString()

    return {
      ...existingEvent,
      title: item.summary || existingEvent.title,
      description: item.description || null,
      location: item.location || null,
      startAt,
      endAt,
      allDay: isAllDay,
      attendees: (item.attendees || []).map((a: Record<string, string>) => a.email),
      etag: item.etag || null,
      updatedAt: now,
    }
  }

  async deleteEvent(
    _account: CalendarAccount,
    credentials: CalendarCredentials,
    eventId: string,
    existingEvent: CalendarEvent
  ): Promise<void> {
    const token = getAccessToken(credentials)
    const calendarId = existingEvent.calendarId || 'primary'

    await googleFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      token,
      { method: 'DELETE' }
    )
  }
}
