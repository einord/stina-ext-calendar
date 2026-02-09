/**
 * Credential refresh utilities for Calendar extension.
 * Handles automatic OAuth2 token refresh before expiry.
 */

import type { CalendarAccount, CalendarCredentials, OAuth2Credentials } from './types.js'
import type { AccountsRepository } from './db/accountsRepository.js'
import { refreshGoogleCalendarToken, isTokenExpired } from './oauth/google.js'
import { refreshOutlookCalendarToken, isOutlookTokenExpired } from './oauth/outlook.js'

export interface CredentialRefreshConfig {
  googleClientId?: string
  googleClientSecret?: string
  outlookClientId?: string
  outlookTenantId?: string
}

/**
 * Ensures that the account credentials are fresh.
 * If OAuth2 token is expired, refreshes it and persists the new token.
 * Returns the (possibly refreshed) credentials.
 */
export async function ensureFreshCredentials(
  account: CalendarAccount,
  accountsRepo: AccountsRepository,
  config: CredentialRefreshConfig
): Promise<CalendarCredentials> {
  if (account.credentials.type !== 'oauth2') {
    return account.credentials
  }

  const oauth = account.credentials as OAuth2Credentials

  if (account.provider === 'google') {
    if (!isTokenExpired(oauth.expiresAt)) {
      return account.credentials
    }

    if (!config.googleClientId || !config.googleClientSecret) {
      throw new Error('Google OAuth configuration missing for token refresh')
    }

    const token = await refreshGoogleCalendarToken(
      { clientId: config.googleClientId, clientSecret: config.googleClientSecret },
      oauth.refreshToken
    )

    const newCredentials: OAuth2Credentials = {
      type: 'oauth2',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    }

    await accountsRepo.updateCredentials(account.id, newCredentials)
    return newCredentials
  }

  if (account.provider === 'outlook') {
    if (!isOutlookTokenExpired(oauth.expiresAt)) {
      return account.credentials
    }

    const outlookClientId = config.outlookClientId || '22f6cd67-c896-49b6-b68e-89d90035e0a7'

    const token = await refreshOutlookCalendarToken(
      { clientId: outlookClientId, tenantId: config.outlookTenantId },
      oauth.refreshToken
    )

    const newCredentials: OAuth2Credentials = {
      type: 'oauth2',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    }

    await accountsRepo.updateCredentials(account.id, newCredentials)
    return newCredentials
  }

  return account.credentials
}
