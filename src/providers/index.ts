/**
 * Calendar Provider Registry
 */

import type { CalendarProvider } from '../types.js'
import type { CalendarProviderInterface } from './types.js'
import { ICalProvider } from './ical.js'
import { GoogleCalendarProvider } from './google.js'
import { ICloudProvider } from './icloud.js'
import { OutlookCalendarProvider } from './outlook.js'
import { CalDavProvider } from './caldav.js'

export interface ProviderConfig {
  googleClientId?: string
  googleClientSecret?: string
  outlookClientId?: string
  outlookTenantId?: string
}

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  ical: 'iCal URL',
  google: 'Google Calendar',
  icloud: 'iCloud',
  outlook: 'Outlook',
  caldav: 'CalDAV',
}

export function getProviderLabel(provider: CalendarProvider): string {
  return PROVIDER_LABELS[provider] || provider
}

export class ProviderRegistry {
  private config: ProviderConfig = {}

  private readonly providers: Record<CalendarProvider, CalendarProviderInterface> = {
    ical: new ICalProvider(),
    google: new GoogleCalendarProvider(),
    icloud: new ICloudProvider(),
    outlook: new OutlookCalendarProvider(),
    caldav: new CalDavProvider(),
  }

  setConfig(config: ProviderConfig): void {
    this.config = config
  }

  getConfig(): ProviderConfig {
    return this.config
  }

  get(provider: CalendarProvider): CalendarProviderInterface | undefined {
    return this.providers[provider]
  }

  getRequired(provider: CalendarProvider): CalendarProviderInterface {
    const p = this.providers[provider]
    if (!p) throw new Error(`Unknown calendar provider: ${provider}`)
    return p
  }
}
