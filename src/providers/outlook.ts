/**
 * Outlook Calendar Provider (Microsoft Graph API)
 */

import type { CalendarAccount, CalendarCredentials, CalendarEvent, CalendarEventInput, CalendarEventUpdate } from '../types.js'
import type { CalendarProviderInterface, RemoteCalendar, SyncResult } from './types.js'

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

function getAccessToken(credentials: CalendarCredentials): string {
  if (credentials.type !== 'oauth2') {
    throw new Error('Outlook Calendar requires OAuth2 credentials')
  }
  return credentials.accessToken
}

async function graphFetch(path: string, token: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Microsoft Graph API error (${response.status}): ${errorBody}`)
  }

  return response
}

export class OutlookCalendarProvider implements CalendarProviderInterface {
  readonly supportsWrite = true

  async testConnection(_account: CalendarAccount, credentials: CalendarCredentials): Promise<void> {
    const token = getAccessToken(credentials)
    await graphFetch('/me/calendars?$top=1', token)
  }

  async listCalendars(_account: CalendarAccount, credentials: CalendarCredentials): Promise<RemoteCalendar[]> {
    const token = getAccessToken(credentials)
    const response = await graphFetch('/me/calendars', token)
    const data = await response.json()

    return (data.value || []).map((cal: Record<string, unknown>) => ({
      id: cal.id as string,
      name: cal.name as string || 'Calendar',
      color: cal.hexColor as string | undefined,
      readOnly: !(cal.canEdit as boolean),
    }))
  }

  async syncEvents(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    from: Date,
    to: Date,
    _syncToken?: string | null
  ): Promise<SyncResult> {
    const token = getAccessToken(credentials)
    const allEvents: CalendarEvent[] = []

    const startDateTime = from.toISOString()
    const endDateTime = to.toISOString()

    let url = `/me/calendarview?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$top=500`
    let newDeltaLink: string | null = null

    while (url) {
      const fetchUrl = url.startsWith('http') ? url : `${GRAPH_API_BASE}${url}`
      const response = await fetch(fetchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'odata.maxpagesize=500',
        },
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Microsoft Graph API error (${response.status}): ${errorBody}`)
      }

      const data = await response.json()

      for (const item of data.value || []) {
        const startAt = item.start?.dateTime ? new Date(item.start.dateTime + 'Z').toISOString() : null
        const endAt = item.end?.dateTime ? new Date(item.end.dateTime + 'Z').toISOString() : null
        if (!startAt) continue

        const now = new Date().toISOString()
        allEvents.push({
          id: '',
          accountId: account.id,
          calendarId: item.calendar?.id || 'default',
          uid: item.iCalUId || item.id,
          title: item.subject || '(No title)',
          description: item.bodyPreview || null,
          location: item.location?.displayName || null,
          startAt,
          endAt: endAt || startAt,
          allDay: item.isAllDay || false,
          recurrenceRule: null,
          organizer: item.organizer?.emailAddress?.address || null,
          attendees: (item.attendees || []).map((a: Record<string, Record<string, string>>) => a.emailAddress?.address || ''),
          remoteUrl: item.webLink || null,
          etag: item['@odata.etag'] || null,
          rawIcs: null,
          createdAt: now,
          updatedAt: now,
        })
      }

      url = data['@odata.nextLink'] || ''
      if (data['@odata.deltaLink']) {
        newDeltaLink = data['@odata.deltaLink']
      }
    }

    return {
      events: allEvents,
      deltaLink: newDeltaLink,
      fullSync: true,
    }
  }

  async createEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    input: CalendarEventInput
  ): Promise<CalendarEvent> {
    const token = getAccessToken(credentials)

    const body: Record<string, unknown> = {
      subject: input.title,
      body: input.description ? { contentType: 'text', content: input.description } : undefined,
      location: input.location ? { displayName: input.location } : undefined,
      isAllDay: input.allDay || false,
    }

    if (input.allDay) {
      body.start = { dateTime: input.startAt.split('T')[0] + 'T00:00:00', timeZone: 'UTC' }
      body.end = { dateTime: input.endAt.split('T')[0] + 'T00:00:00', timeZone: 'UTC' }
    } else {
      body.start = { dateTime: input.startAt.replace('Z', ''), timeZone: 'UTC' }
      body.end = { dateTime: input.endAt.replace('Z', ''), timeZone: 'UTC' }
    }

    if (input.attendees?.length) {
      body.attendees = input.attendees.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      }))
    }

    const calendarId = input.calendarId
    const path = calendarId
      ? `/me/calendars/${calendarId}/events`
      : '/me/events'

    const response = await graphFetch(path, token, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const item = await response.json()
    const now = new Date().toISOString()

    return {
      id: '',
      accountId: account.id,
      calendarId: calendarId || 'default',
      uid: item.iCalUId || item.id,
      title: item.subject || input.title,
      description: item.bodyPreview || null,
      location: item.location?.displayName || null,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay || false,
      recurrenceRule: null,
      organizer: null,
      attendees: input.attendees || [],
      remoteUrl: item.webLink || null,
      etag: item['@odata.etag'] || null,
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

    const body: Record<string, unknown> = {}
    if (update.title !== undefined) body.subject = update.title
    if (update.description !== undefined) body.body = { contentType: 'text', content: update.description || '' }
    if (update.location !== undefined) body.location = { displayName: update.location || '' }

    const isAllDay = update.allDay ?? existingEvent.allDay
    const startAt = update.startAt ?? existingEvent.startAt
    const endAt = update.endAt ?? existingEvent.endAt

    if (update.startAt || update.allDay !== undefined) {
      if (isAllDay) {
        body.start = { dateTime: startAt.split('T')[0] + 'T00:00:00', timeZone: 'UTC' }
      } else {
        body.start = { dateTime: startAt.replace('Z', ''), timeZone: 'UTC' }
      }
    }
    if (update.endAt || update.allDay !== undefined) {
      if (isAllDay) {
        body.end = { dateTime: endAt.split('T')[0] + 'T00:00:00', timeZone: 'UTC' }
      } else {
        body.end = { dateTime: endAt.replace('Z', ''), timeZone: 'UTC' }
      }
    }

    if (update.attendees) {
      body.attendees = update.attendees.map((email) => ({
        emailAddress: { address: email },
        type: 'required',
      }))
    }

    const response = await graphFetch(`/me/events/${eventId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })

    const item = await response.json()
    const now = new Date().toISOString()

    return {
      ...existingEvent,
      title: item.subject || existingEvent.title,
      description: item.bodyPreview || null,
      location: item.location?.displayName || null,
      startAt,
      endAt,
      allDay: isAllDay,
      attendees: update.attendees ?? existingEvent.attendees,
      etag: item['@odata.etag'] || null,
      updatedAt: now,
    }
  }

  async deleteEvent(
    _account: CalendarAccount,
    credentials: CalendarCredentials,
    eventId: string,
    _existingEvent: CalendarEvent
  ): Promise<void> {
    const token = getAccessToken(credentials)
    await graphFetch(`/me/events/${eventId}`, token, { method: 'DELETE' })
  }
}
