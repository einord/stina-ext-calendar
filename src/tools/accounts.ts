/**
 * Calendar Account Tools
 *
 * Tools for managing calendar accounts. Each tool creates a repository instance
 * using the user-scoped storage and secrets from ExecutionContext.
 */

import type { Tool, ToolResult, ExecutionContext } from '@stina/extension-api/runtime'
import { CalendarRepository } from '../db/repository.js'
import type { ProviderRegistry } from '../providers/index.js'
import type { CalendarAccountInput } from '../types.js'

/**
 * Creates a user-scoped repository from the execution context.
 * @param context Execution context with userStorage and userSecrets
 * @returns CalendarRepository instance
 */
function createRepository(context: ExecutionContext): CalendarRepository {
  return new CalendarRepository(context.userStorage, context.userSecrets)
}

/**
 * Creates the cal_accounts_list tool.
 * Lists all configured calendar accounts for the current user.
 * @returns Tool definition
 */
export function createListAccountsTool(): Tool {
  return {
    id: 'cal_accounts_list',
    name: 'List Calendar Accounts',
    description: 'Lists all configured calendar accounts for the current user',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of accounts to return',
        },
        offset: {
          type: 'number',
          description: 'Number of accounts to skip for pagination',
        },
      },
    },
    async execute(
      params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      const { limit, offset } = params as { limit?: number; offset?: number }

      try {
        const repository = createRepository(context)
        const accounts = await repository.accounts.list({
          limit,
          offset,
        })

        // Remove sensitive credential data from response
        const safeAccounts = accounts.map((account) => ({
          id: account.id,
          provider: account.provider,
          name: account.name,
          url: account.url,
          enabled: account.enabled,
          calendars: account.calendars,
          lastSyncAt: account.lastSyncAt,
          lastError: account.lastError,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        }))

        // Include event creation instruction if configured
        const settings = await repository.settings.get()
        const note = settings.eventInstruction || undefined

        return {
          success: true,
          data: {
            accounts: safeAccounts,
            count: safeAccounts.length,
            ...(note ? { note } : {}),
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * Creates the cal_accounts_add tool.
 * Adds a new calendar account with the specified provider and credentials.
 * @param providers Provider registry for validation
 * @returns Tool definition
 */
export function createAddAccountTool(providers: ProviderRegistry): Tool {
  return {
    id: 'cal_accounts_add',
    name: 'Add Calendar Account',
    description: 'Adds a new calendar account with the specified provider and credentials',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Calendar provider type: ical, google, icloud, outlook, or caldav',
          enum: ['ical', 'google', 'icloud', 'outlook', 'caldav'],
        },
        name: {
          type: 'string',
          description: 'Display name for this account (e.g., "Work Calendar")',
        },
        url: {
          type: 'string',
          description: 'Calendar URL (required for iCal, optional for CalDAV)',
        },
        username: {
          type: 'string',
          description: 'Username for authentication',
        },
        password: {
          type: 'string',
          description: 'Password or app-specific password',
        },
        accessToken: {
          type: 'string',
          description: 'OAuth2 access token (for Google/Outlook)',
        },
        refreshToken: {
          type: 'string',
          description: 'OAuth2 refresh token (for Google/Outlook)',
        },
        expiresAt: {
          type: 'string',
          description: 'OAuth2 token expiration time (ISO 8601)',
        },
      },
      required: ['provider', 'name'],
    },
    async execute(
      params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      const input = params as unknown as CalendarAccountInput

      try {
        // Validate provider
        const provider = providers.get(input.provider)
        if (!provider) {
          return { success: false, error: `Unknown provider: ${input.provider}` }
        }

        const repository = createRepository(context)
        const account = await repository.accounts.upsert(undefined, input)

        return {
          success: true,
          data: {
            id: account.id,
            provider: account.provider,
            name: account.name,
            url: account.url,
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * Creates the cal_accounts_update tool.
 * Updates an existing calendar account configuration.
 * @returns Tool definition
 */
export function createUpdateAccountTool(): Tool {
  return {
    id: 'cal_accounts_update',
    name: 'Update Calendar Account',
    description: 'Updates an existing calendar account configuration',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the account to update',
        },
        provider: {
          type: 'string',
          description: 'Calendar provider type: ical, google, icloud, outlook, or caldav',
          enum: ['ical', 'google', 'icloud', 'outlook', 'caldav'],
        },
        name: {
          type: 'string',
          description: 'Display name for this account',
        },
        url: {
          type: 'string',
          description: 'Calendar URL',
        },
        username: {
          type: 'string',
          description: 'Username for authentication',
        },
        password: {
          type: 'string',
          description: 'New password or app-specific password',
        },
        accessToken: {
          type: 'string',
          description: 'OAuth2 access token',
        },
        refreshToken: {
          type: 'string',
          description: 'OAuth2 refresh token',
        },
        expiresAt: {
          type: 'string',
          description: 'OAuth2 token expiration time (ISO 8601)',
        },
      },
      required: ['id'],
    },
    async execute(
      params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      const input = params as unknown as { id: string } & Partial<CalendarAccountInput>

      try {
        const repository = createRepository(context)

        // Get existing account to merge with partial update
        const existing = await repository.accounts.get(input.id)
        if (!existing) {
          return { success: false, error: 'Account not found' }
        }

        // Merge existing data with updates
        const updateData: CalendarAccountInput = {
          provider: input.provider ?? existing.provider,
          name: input.name ?? existing.name,
          url: input.url !== undefined ? input.url : existing.url,
          username: input.username,
          password: input.password,
          accessToken: input.accessToken,
          refreshToken: input.refreshToken,
          expiresAt: input.expiresAt,
        }

        const account = await repository.accounts.upsert(input.id, updateData)

        return {
          success: true,
          data: {
            id: account.id,
            provider: account.provider,
            name: account.name,
            url: account.url,
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * Creates the cal_accounts_delete tool.
 * Deletes a calendar account and cleans up related data.
 * @param onDelete Optional callback after deletion
 * @returns Tool definition
 */
export function createDeleteAccountTool(
  onDelete?: (accountId: string, userId: string) => void
): Tool {
  return {
    id: 'cal_accounts_delete',
    name: 'Delete Calendar Account',
    description: 'Deletes a calendar account and cleans up related data',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the account to delete',
        },
      },
      required: ['id'],
    },
    async execute(
      params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      const { id } = params as { id: string }

      try {
        const repository = createRepository(context)

        // Clean up events and sync state for this account
        await repository.events.deleteByAccount(id)
        await repository.syncState.delete(id)

        const deleted = await repository.accounts.delete(id)

        if (!deleted) {
          return { success: false, error: 'Account not found' }
        }

        if (onDelete) {
          onDelete(id, context.userId)
        }

        return { success: true, data: { deleted: true } }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * Creates the cal_accounts_test tool.
 * Tests the connection to a calendar account.
 * @param providers Provider registry
 * @returns Tool definition
 */
export function createTestAccountTool(providers: ProviderRegistry): Tool {
  return {
    id: 'cal_accounts_test',
    name: 'Test Calendar Account',
    description: 'Tests the connection to a calendar account',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the account to test',
        },
      },
      required: ['id'],
    },
    async execute(
      params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      const { id } = params as { id: string }

      try {
        const repository = createRepository(context)
        const account = await repository.accounts.get(id)

        if (!account) {
          return { success: false, error: 'Account not found' }
        }

        const provider = providers.getRequired(account.provider)
        await provider.testConnection(account, account.credentials)

        // Update sync status on success
        await repository.accounts.updateSyncStatus(id, null)

        return {
          success: true,
          data: {
            connected: true,
            message: 'Connection successful',
          },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Try to update sync status with the error
        try {
          const repository = createRepository(context)
          await repository.accounts.updateSyncStatus(id, errorMessage)
        } catch {
          // Ignore update errors
        }

        return {
          success: false,
          error: errorMessage,
        }
      }
    },
  }
}
