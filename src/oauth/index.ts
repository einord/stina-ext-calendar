/**
 * OAuth2 module exports
 */

export {
  initiateDeviceCodeFlow,
  pollForToken,
  refreshAccessToken,
  type DeviceCodeConfig,
  type DeviceCodeFlowResult,
} from './device-code.js'

export {
  initiateGoogleCalendarAuth,
  pollGoogleCalendarToken,
  refreshGoogleCalendarToken,
  isTokenExpired,
  type GoogleCalendarOAuthConfig,
} from './google.js'

export {
  initiateOutlookCalendarAuth,
  pollOutlookCalendarToken,
  refreshOutlookCalendarToken,
  isOutlookTokenExpired,
  DEFAULT_OUTLOOK_CALENDAR_CLIENT_ID,
  type OutlookCalendarOAuthConfig,
} from './outlook.js'
