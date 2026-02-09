/**
 * Calendar Extension Types
 */

/**
 * Supported calendar providers
 */
export type CalendarProvider = 'ical' | 'google' | 'icloud' | 'outlook' | 'caldav'

/**
 * Authentication type for calendar accounts
 */
export type AuthType = 'none' | 'password' | 'oauth2'

/**
 * Calendar account configuration
 */
export interface CalendarAccount {
  id: string
  userId: string
  provider: CalendarProvider
  name: string
  url: string | null
  authType: AuthType
  credentials: CalendarCredentials
  enabled: boolean
  syncIntervalMs: number
  lastSyncAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Credentials for authentication
 */
export type CalendarCredentials = NoCredentials | PasswordCredentials | OAuth2Credentials

/**
 * No credentials (iCal URL)
 */
export interface NoCredentials {
  type: 'none'
}

/**
 * Password-based credentials (iCloud, CalDAV)
 */
export interface PasswordCredentials {
  type: 'password'
  username: string
  password: string
}

/**
 * OAuth2 credentials (Google, Outlook)
 */
export interface OAuth2Credentials {
  type: 'oauth2'
  accessToken: string
  refreshToken: string
  expiresAt: string
}

/**
 * Input for creating/updating a calendar account
 */
export interface CalendarAccountInput {
  provider: CalendarProvider
  name: string
  url?: string | null
  username?: string
  password?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  enabled?: boolean
  syncIntervalMs?: number
}

/**
 * Calendar event
 */
export interface CalendarEvent {
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
  remoteUrl: string | null
  etag: string | null
  rawIcs: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Input for creating a calendar event
 */
export interface CalendarEventInput {
  accountId: string
  calendarId?: string
  title: string
  description?: string | null
  location?: string | null
  startAt: string
  endAt: string
  allDay?: boolean
  attendees?: string[]
}

/**
 * Input for updating a calendar event
 */
export interface CalendarEventUpdate {
  title?: string
  description?: string | null
  location?: string | null
  startAt?: string
  endAt?: string
  allDay?: boolean
  attendees?: string[]
}

/**
 * Calendar settings
 */
export interface CalendarSettings {
  id: string
  userId: string
  reminderMinutes: number
  instruction: string
  createdAt: string
  updatedAt: string
}

/**
 * Input for updating calendar settings
 */
export interface CalendarSettingsUpdate {
  reminderMinutes?: number
  instruction?: string
}

/**
 * Sync state for tracking incremental sync
 */
export interface SyncState {
  id: string
  accountId: string
  syncToken: string | null
  deltaLink: string | null
  lastSyncAt: string
  updatedAt: string
}

/**
 * OAuth2 Token response
 */
export interface TokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
}

/**
 * Edit state for the UI form
 */
export interface EditState {
  showModal: boolean
  modalTitle: string
  editingId: string | null
  form: EditFormState
  oauthStatus: 'pending' | 'awaiting' | 'connected'
  oauthUrl: string
  oauthCode: string
}

/**
 * Form state for account editing
 */
export interface EditFormState {
  provider: CalendarProvider
  name: string
  url: string
  username: string
  password: string
}

/**
 * Account display data for UI
 */
export interface AccountDisplayData {
  id: string
  name: string
  provider: CalendarProvider
  providerLabel: string
  statusVariant: 'default' | 'success' | 'warning' | 'danger'
  enabled: boolean
  lastSyncAt: string | null
  lastError: string | null
}

/**
 * Options for listing accounts
 */
export interface ListAccountsOptions {
  limit?: number
  offset?: number
}

/**
 * Options for listing events
 */
export interface ListEventsOptions {
  accountId?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

/**
 * Upcoming event for panel display
 */
export interface UpcomingEvent {
  id: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  location: string | null
  accountName: string
  calendarId: string
}
