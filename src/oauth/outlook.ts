/**
 * Outlook Calendar OAuth2 implementation using Device Code Flow
 */

import {
  initiateDeviceCodeFlow,
  pollForToken,
  refreshAccessToken,
  type DeviceCodeConfig,
  type DeviceCodeFlowResult,
} from './device-code.js'
import type { TokenResponse } from '../types.js'

export interface OutlookCalendarOAuthConfig {
  clientId: string
  tenantId?: string
}

const MS_AUTH_BASE = 'https://login.microsoftonline.com'

export const DEFAULT_OUTLOOK_CALENDAR_CLIENT_ID = '22f6cd67-c896-49b6-b68e-89d90035e0a7'

const OUTLOOK_CALENDAR_SCOPES = [
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'offline_access',
]

function getOutlookEndpoints(tenantId: string = 'common'): {
  deviceCodeUrl: string
  tokenUrl: string
} {
  return {
    deviceCodeUrl: `${MS_AUTH_BASE}/${tenantId}/oauth2/v2.0/devicecode`,
    tokenUrl: `${MS_AUTH_BASE}/${tenantId}/oauth2/v2.0/token`,
  }
}

function createOutlookConfig(config: OutlookCalendarOAuthConfig): DeviceCodeConfig {
  const endpoints = getOutlookEndpoints(config.tenantId)
  return {
    clientId: config.clientId,
    deviceCodeUrl: endpoints.deviceCodeUrl,
    tokenUrl: endpoints.tokenUrl,
    scopes: OUTLOOK_CALENDAR_SCOPES,
  }
}

export async function initiateOutlookCalendarAuth(
  config: OutlookCalendarOAuthConfig
): Promise<DeviceCodeFlowResult> {
  return initiateDeviceCodeFlow(createOutlookConfig(config))
}

export async function pollOutlookCalendarToken(
  config: OutlookCalendarOAuthConfig,
  deviceCode: string
): Promise<TokenResponse | null> {
  return pollForToken(createOutlookConfig(config), deviceCode)
}

export async function refreshOutlookCalendarToken(
  config: OutlookCalendarOAuthConfig,
  refreshToken: string
): Promise<TokenResponse> {
  return refreshAccessToken(createOutlookConfig(config), refreshToken)
}

export function isOutlookTokenExpired(expiresAt: string, bufferMinutes: number = 5): boolean {
  const expirationTime = new Date(expiresAt).getTime()
  const bufferMs = bufferMinutes * 60 * 1000
  return Date.now() >= expirationTime - bufferMs
}
