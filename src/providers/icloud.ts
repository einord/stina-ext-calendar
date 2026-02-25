/**
 * iCloud Calendar Provider (CalDAV-based)
 */

import { CalDavProvider } from './caldav.js'
import type { CalendarAccount, CalendarCredentials, CalendarEventInput, CalendarEventUpdate, CalendarEvent } from '../types.js'

const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com'

export class ICloudProvider extends CalDavProvider {
  async testConnection(account: CalendarAccount, credentials: CalendarCredentials): Promise<void> {
    const icloudAccount = { ...account, url: account.url || ICLOUD_CALDAV_URL }
    return super.testConnection(icloudAccount, credentials)
  }

  async listCalendars(account: CalendarAccount, credentials: CalendarCredentials) {
    const icloudAccount = { ...account, url: account.url || ICLOUD_CALDAV_URL }
    return super.listCalendars(icloudAccount, credentials)
  }

  async syncEvents(
    account: CalendarAccount,
    credentials: CalendarCredentials,
    from: Date,
    to: Date,
    syncToken?: string | null
  ) {
    const icloudAccount = { ...account, url: account.url || ICLOUD_CALDAV_URL }
    return super.syncEvents(icloudAccount, credentials, from, to, syncToken)
  }

  async createEvent(account: CalendarAccount, credentials: CalendarCredentials, input: CalendarEventInput) {
    const icloudAccount = { ...account, url: account.url || ICLOUD_CALDAV_URL }
    return super.createEvent(icloudAccount, credentials, input)
  }

  async updateEvent(account: CalendarAccount, credentials: CalendarCredentials, eventId: string, update: CalendarEventUpdate, existingEvent: CalendarEvent) {
    const icloudAccount = { ...account, url: account.url || ICLOUD_CALDAV_URL }
    return super.updateEvent(icloudAccount, credentials, eventId, update, existingEvent)
  }

  async deleteEvent(account: CalendarAccount, credentials: CalendarCredentials, eventId: string, existingEvent: CalendarEvent) {
    const icloudAccount = { ...account, url: account.url || ICLOUD_CALDAV_URL }
    return super.deleteEvent(icloudAccount, credentials, eventId, existingEvent)
  }
}
