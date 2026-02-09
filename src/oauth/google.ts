/**
 * Google Calendar OAuth2 implementation using Device Code Flow
 */

import {
  initiateDeviceCodeFlow,
  pollForToken,
  refreshAccessToken,
  type DeviceCodeConfig,
  type DeviceCodeFlowResult,
} from './device-code.js'
import type { TokenResponse } from '../types.js'

export interface GoogleCalendarOAuthConfig {
  clientId: string
  clientSecret: string
}

const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar']

function createGoogleConfig(config: GoogleCalendarOAuthConfig): DeviceCodeConfig {
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    deviceCodeUrl: GOOGLE_DEVICE_CODE_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    scopes: GOOGLE_CALENDAR_SCOPES,
  }
}

export async function initiateGoogleCalendarAuth(
  config: GoogleCalendarOAuthConfig
): Promise<DeviceCodeFlowResult> {
  return initiateDeviceCodeFlow(createGoogleConfig(config))
}

export async function pollGoogleCalendarToken(
  config: GoogleCalendarOAuthConfig,
  deviceCode: string
): Promise<TokenResponse | null> {
  return pollForToken(createGoogleConfig(config), deviceCode)
}

export async function refreshGoogleCalendarToken(
  config: GoogleCalendarOAuthConfig,
  refreshToken: string
): Promise<TokenResponse> {
  return refreshAccessToken(createGoogleConfig(config), refreshToken)
}

export function isTokenExpired(expiresAt: string, bufferMinutes: number = 5): boolean {
  const expirationTime = new Date(expiresAt).getTime()
  const bufferMs = bufferMinutes * 60 * 1000
  return Date.now() >= expirationTime - bufferMs
}
