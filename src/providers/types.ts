/**
 * Calendar Provider Interface
 */

import type { CalendarAccount, CalendarCredentials, CalendarEvent, CalendarEventInput, CalendarEventUpdate } from '../types.js'

/**
 * Remote calendar info returned by providers
 */
export interface RemoteCalendar {
  id: string
  name: string
  color?: string
  readOnly: boolean
}

/**
 * Result from syncing events
 */
export interface SyncResult {
  events: CalendarEvent[]
  deletedUids?: string[]  // UIDs of events cancelled/deleted during incremental sync
  syncToken?: string | null
  deltaLink?: string | null
  fullSync: boolean
}

/**
 * Calendar provider interface that all providers must implement
 */
export interface CalendarProviderInterface {
  /**
   * Test connection to the calendar service.
   * Throws on failure.
   */
  testConnection(account: CalendarAccount, credentials: CalendarCredentials): Promise<void>

  /**
   * List available calendars for the account.
   */
  listCalendars(account: CalendarAccount, credentials: CalendarCredentials): Promise<RemoteCalendar[]>

  /**
   * Sync events from the calendar service.
   * Supports incremental sync via syncToken/deltaLink.
   */
  syncEvents(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    from: Date,
    to: Date,
    syncToken?: string | null
  ): Promise<SyncResult>

  /**
   * Create a new event on the remote calendar.
   * Returns the created event with remote IDs.
   * Throws if the provider is read-only.
   */
  createEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    input: CalendarEventInput
  ): Promise<CalendarEvent>

  /**
   * Update an existing event on the remote calendar.
   * Throws if the provider is read-only.
   */
  updateEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    eventId: string,
    update: CalendarEventUpdate,
    existingEvent: CalendarEvent
  ): Promise<CalendarEvent>

  /**
   * Delete an event from the remote calendar.
   * Throws if the provider is read-only.
   */
  deleteEvent(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    eventId: string,
    existingEvent: CalendarEvent
  ): Promise<void>

  /**
   * Whether this provider supports writing (create/update/delete).
   */
  readonly supportsWrite: boolean
}
