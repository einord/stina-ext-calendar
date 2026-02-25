/**
 * Calendar Event Tools
 *
 * Tools for managing calendar events. Each tool creates a repository instance
 * using the user-scoped storage and secrets from ExecutionContext.
 */

import type { Tool, ToolResult, ExecutionContext } from '@stina/extension-api/runtime'
import { CalendarRepository } from '../db/repository.js'
import type { ProviderRegistry } from '../providers/index.js'
import { ensureFreshCredentials, type CredentialRefreshConfig } from '../credentials.js'
import type { CalendarEventInput, CalendarEventUpdate } from '../types.js'

/**
 * Creates a user-scoped repository from the execution context.
 * @param context Execution context with userStorage and userSecrets
 * @returns CalendarRepository instance
 */
function createRepository(context: ExecutionContext): CalendarRepository {
  return new CalendarRepository(context.userStorage, context.userSecrets)
}

/**
 * Creates the cal_events_list tool.
 * Lists calendar events within a date range.
 * @returns Tool definition
 */
export function createListEventsTool(): Tool {
  return {
    id: 'cal_events_list',
    name: 'List Calendar Events',
    description: 'Lists calendar events within a date range',
    parameters: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Filter events to a specific account ID (optional, lists all if not provided)',
        },
        from: {
          type: 'string',
          description: 'Start of date range (ISO 8601, default: today)',
        },
        to: {
          type: 'string',
          description: 'End of date range (ISO 8601, default: today + 30 days)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return',
        },
        offset: {
          type: 'number',
          description: 'Number of events to skip for pagination',
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

      const { accountId, from, to, limit, offset } = params as {
        accountId?: string
        from?: string
        to?: string
        limit?: number
        offset?: number
      }

      try {
        const repository = createRepository(context)

        const now = new Date()
        const defaultFrom = now.toISOString()
        const defaultTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

        const events = await repository.events.list({
          accountId,
          from: from ?? defaultFrom,
          to: to ?? defaultTo,
          limit,
          offset,
        })

        return {
          success: true,
          data: {
            events: events.map((event) => ({
              id: event.id,
              accountId: event.accountId,
              calendarId: event.calendarId,
              title: event.title,
              description: event.description,
              location: event.location,
              startAt: event.startAt,
              endAt: event.endAt,
              allDay: event.allDay,
              attendees: event.attendees,
              organizer: event.organizer,
            })),
            count: events.length,
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
 * Creates the cal_events_get tool.
 * Gets a specific calendar event by ID.
 * @returns Tool definition
 */
export function createGetEventTool(): Tool {
  return {
    id: 'cal_events_get',
    name: 'Get Calendar Event',
    description: 'Gets details of a specific calendar event',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the event',
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
        const event = await repository.events.get(id)

        if (!event) {
          return { success: false, error: 'Event not found' }
        }

        return {
          success: true,
          data: {
            id: event.id,
            accountId: event.accountId,
            calendarId: event.calendarId,
            uid: event.uid,
            title: event.title,
            description: event.description,
            location: event.location,
            startAt: event.startAt,
            endAt: event.endAt,
            allDay: event.allDay,
            recurrenceRule: event.recurrenceRule,
            organizer: event.organizer,
            attendees: event.attendees,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
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
 * Creates the cal_events_create tool.
 * Creates a new calendar event on the remote calendar and local cache.
 * @param providers Provider registry
 * @param credentialConfig OAuth credential configuration
 * @returns Tool definition
 */
export function createCreateEventTool(
  providers: ProviderRegistry,
  credentialConfig: CredentialRefreshConfig,
  emitEventChanged?: () => void
): Tool {
  return {
    id: 'cal_events_create',
    name: 'Create Calendar Event',
    description: 'Creates a new calendar event',
    parameters: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'The account ID to create the event in',
        },
        calendarId: {
          type: 'string',
          description: 'The calendar ID within the account (optional, uses default)',
        },
        title: {
          type: 'string',
          description: 'Event title',
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
        location: {
          type: 'string',
          description: 'Event location',
        },
        startAt: {
          type: 'string',
          description: 'Event start time (ISO 8601)',
        },
        endAt: {
          type: 'string',
          description: 'Event end time (ISO 8601)',
        },
        allDay: {
          type: 'boolean',
          description: 'Whether this is an all-day event',
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of attendee email addresses',
        },
      },
      required: ['accountId', 'title', 'startAt', 'endAt'],
    },
    async execute(
      params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      const input = params as unknown as CalendarEventInput

      try {
        const repository = createRepository(context)
        const account = await repository.accounts.get(input.accountId)

        if (!account) {
          return { success: false, error: 'Account not found' }
        }

        const provider = providers.getRequired(account.provider)

        // Refresh credentials if needed
        const credentials = await ensureFreshCredentials(
          account,
          repository.accounts,
          credentialConfig
        )

        // Create on remote
        const createdEvent = await provider.createEvent(account, credentials, input)

        // Upsert in local cache
        const cachedEvent = await repository.events.upsertByUid(account.id, {
          accountId: account.id,
          calendarId: createdEvent.calendarId,
          uid: createdEvent.uid,
          title: createdEvent.title,
          description: createdEvent.description,
          location: createdEvent.location,
          startAt: createdEvent.startAt,
          endAt: createdEvent.endAt,
          allDay: createdEvent.allDay,
          recurrenceRule: createdEvent.recurrenceRule,
          organizer: createdEvent.organizer,
          attendees: createdEvent.attendees,
          responseStatus: createdEvent.responseStatus ?? null,
          remoteUrl: createdEvent.remoteUrl,
          etag: createdEvent.etag,
          rawIcs: createdEvent.rawIcs,
        })

        emitEventChanged?.()

        return {
          success: true,
          data: {
            id: cachedEvent.id,
            title: cachedEvent.title,
            startAt: cachedEvent.startAt,
            endAt: cachedEvent.endAt,
            allDay: cachedEvent.allDay,
            location: cachedEvent.location,
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
 * Creates the cal_events_update tool.
 * Updates an existing calendar event on the remote calendar and local cache.
 * @param providers Provider registry
 * @param credentialConfig OAuth credential configuration
 * @returns Tool definition
 */
export function createUpdateEventTool(
  providers: ProviderRegistry,
  credentialConfig: CredentialRefreshConfig,
  emitEventChanged?: () => void
): Tool {
  return {
    id: 'cal_events_update',
    name: 'Update Calendar Event',
    description: 'Updates an existing calendar event',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the event to update',
        },
        title: {
          type: 'string',
          description: 'New event title',
        },
        description: {
          type: 'string',
          description: 'New event description',
        },
        location: {
          type: 'string',
          description: 'New event location',
        },
        startAt: {
          type: 'string',
          description: 'New event start time (ISO 8601)',
        },
        endAt: {
          type: 'string',
          description: 'New event end time (ISO 8601)',
        },
        allDay: {
          type: 'boolean',
          description: 'Whether this is an all-day event',
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated list of attendee email addresses',
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

      const { id, ...updateFields } = params as { id: string } & Partial<CalendarEventUpdate>

      try {
        const repository = createRepository(context)

        // Get existing event from cache
        const existingEvent = await repository.events.get(id)
        if (!existingEvent) {
          return { success: false, error: 'Event not found' }
        }

        const account = await repository.accounts.get(existingEvent.accountId)
        if (!account) {
          return { success: false, error: 'Account not found' }
        }

        const provider = providers.getRequired(account.provider)

        // Refresh credentials if needed
        const credentials = await ensureFreshCredentials(
          account,
          repository.accounts,
          credentialConfig
        )

        const update: CalendarEventUpdate = {
          title: updateFields.title,
          description: updateFields.description,
          location: updateFields.location,
          startAt: updateFields.startAt,
          endAt: updateFields.endAt,
          allDay: updateFields.allDay,
          attendees: updateFields.attendees,
        }

        // Update on remote
        const updatedEvent = await provider.updateEvent(
          account,
          credentials,
          existingEvent.uid,
          update,
          existingEvent
        )

        // Update local cache
        const cachedEvent = await repository.events.upsertByUid(account.id, {
          accountId: account.id,
          calendarId: updatedEvent.calendarId,
          uid: updatedEvent.uid,
          title: updatedEvent.title,
          description: updatedEvent.description,
          location: updatedEvent.location,
          startAt: updatedEvent.startAt,
          endAt: updatedEvent.endAt,
          allDay: updatedEvent.allDay,
          recurrenceRule: updatedEvent.recurrenceRule,
          organizer: updatedEvent.organizer,
          attendees: updatedEvent.attendees,
          responseStatus: updatedEvent.responseStatus ?? null,
          remoteUrl: updatedEvent.remoteUrl,
          etag: updatedEvent.etag,
          rawIcs: updatedEvent.rawIcs,
        })

        emitEventChanged?.()

        return {
          success: true,
          data: {
            id: cachedEvent.id,
            title: cachedEvent.title,
            startAt: cachedEvent.startAt,
            endAt: cachedEvent.endAt,
            allDay: cachedEvent.allDay,
            location: cachedEvent.location,
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
 * Creates the cal_events_delete tool.
 * Deletes a calendar event from the remote calendar and local cache.
 * @param providers Provider registry
 * @param credentialConfig OAuth credential configuration
 * @returns Tool definition
 */
export function createDeleteEventTool(
  providers: ProviderRegistry,
  credentialConfig: CredentialRefreshConfig,
  emitEventChanged?: () => void
): Tool {
  return {
    id: 'cal_events_delete',
    name: 'Delete Calendar Event',
    description: 'Deletes a calendar event',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the event to delete',
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

        // Get existing event from cache
        const existingEvent = await repository.events.get(id)
        if (!existingEvent) {
          return { success: false, error: 'Event not found' }
        }

        const account = await repository.accounts.get(existingEvent.accountId)
        if (!account) {
          return { success: false, error: 'Account not found' }
        }

        const provider = providers.getRequired(account.provider)

        // Refresh credentials if needed
        const credentials = await ensureFreshCredentials(
          account,
          repository.accounts,
          credentialConfig
        )

        // Delete from remote
        await provider.deleteEvent(account, credentials, existingEvent.uid, existingEvent)

        // Remove from local cache
        await repository.events.delete(id)

        emitEventChanged?.()

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
 * Creates the cal_events_sync tool.
 * Forces sync of calendar events from all or a specific account.
 * @param providers Provider registry
 * @param credentialConfig OAuth credential configuration
 * @returns Tool definition
 */
export function createSyncEventsTool(
  providers: ProviderRegistry,
  credentialConfig: CredentialRefreshConfig
): Tool {
  return {
    id: 'cal_events_sync',
    name: 'Sync Calendar Events',
    description: 'Forces sync of calendar events from all accounts',
    parameters: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Sync a specific account (optional, syncs all if not provided)',
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

      const { accountId } = params as { accountId?: string }

      try {
        const repository = createRepository(context)

        // Get accounts to sync
        let accounts
        if (accountId) {
          const account = await repository.accounts.get(accountId)
          accounts = account ? [account] : []
        } else {
          accounts = await repository.accounts.list()
        }

        if (accounts.length === 0) {
          return {
            success: true,
            data: { synced: 0, message: 'No accounts configured' },
          }
        }

        const now = new Date()
        const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const to = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

        const results: Array<{ accountId: string; accountName: string; eventsCount: number; error?: string }> = []

        for (const account of accounts) {
          if (!account.enabled) continue

          try {
            const provider = providers.getRequired(account.provider)

            // Refresh credentials if needed
            const credentials = await ensureFreshCredentials(
              account,
              repository.accounts,
              credentialConfig
            )

            // Get existing sync state
            const syncState = await repository.syncState.get(account.id)

            // Sync events from remote
            const syncResult = await provider.syncEvents(
              account,
              credentials,
              from,
              to,
              syncState?.syncToken
            )

            // Upsert events in local cache
            for (const event of syncResult.events) {
              await repository.events.upsertByUid(account.id, {
                accountId: account.id,
                calendarId: event.calendarId,
                uid: event.uid,
                title: event.title,
                description: event.description,
                location: event.location,
                startAt: event.startAt,
                endAt: event.endAt,
                allDay: event.allDay,
                recurrenceRule: event.recurrenceRule,
                organizer: event.organizer,
                attendees: event.attendees,
                responseStatus: event.responseStatus ?? null,
                remoteUrl: event.remoteUrl,
                etag: event.etag,
                rawIcs: event.rawIcs,
              })
            }

            // Update sync state
            await repository.syncState.upsert(
              account.id,
              syncResult.syncToken ?? null,
              syncResult.deltaLink ?? null
            )

            // Update account sync status
            await repository.accounts.updateSyncStatus(account.id, null)

            results.push({
              accountId: account.id,
              accountName: account.name,
              eventsCount: syncResult.events.length,
            })
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            await repository.accounts.updateSyncStatus(account.id, errorMessage)
            results.push({
              accountId: account.id,
              accountName: account.name,
              eventsCount: 0,
              error: errorMessage,
            })
          }
        }

        return {
          success: true,
          data: {
            synced: results.length,
            results,
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
