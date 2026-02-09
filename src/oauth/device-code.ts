/**
 * OAuth2 Device Code Flow base implementation
 */

import type { TokenResponse } from '../types.js'

export interface DeviceCodeConfig {
  clientId: string
  clientSecret?: string
  deviceCodeUrl: string
  tokenUrl: string
  scopes: string[]
}

export interface DeviceCodeFlowResult {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export async function initiateDeviceCodeFlow(
  config: DeviceCodeConfig
): Promise<DeviceCodeFlowResult> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(' '),
  })

  const response = await fetch(config.deviceCodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to initiate device code flow: ${error}`)
  }

  const data = await response.json()

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_uri || data.verification_url,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  }
}

export async function pollForToken(
  config: DeviceCodeConfig,
  deviceCode: string
): Promise<TokenResponse | null> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  })

  if (config.clientSecret) {
    params.append('client_secret', config.clientSecret)
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const data = await response.json()

  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return null
  }

  if (data.error) {
    throw new Error(`Token error: ${data.error} - ${data.error_description || ''}`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  }
}

export async function refreshAccessToken(
  config: DeviceCodeConfig,
  refreshToken: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  if (config.clientSecret) {
    params.append('client_secret', config.clientSecret)
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to refresh token: ${error}`)
  }

  const data = await response.json()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  }
}
