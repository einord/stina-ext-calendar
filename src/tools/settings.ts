/**
 * Settings Tools
 *
 * Tools for managing calendar settings. Each tool creates a repository instance
 * using the user-scoped storage and secrets from ExecutionContext.
 */

import type { Tool, ToolResult, ExecutionContext } from '@stina/extension-api/runtime'
import { CalendarRepository } from '../db/repository.js'
import type { CalendarSettingsUpdate } from '../types.js'

/**
 * Creates a user-scoped repository from the execution context.
 * @param context Execution context with userStorage and userSecrets
 * @returns CalendarRepository instance
 */
function createRepository(context: ExecutionContext): CalendarRepository {
  return new CalendarRepository(context.userStorage, context.userSecrets)
}

/**
 * Creates the cal_settings_get tool.
 * Gets the current calendar settings including reminder time and instruction.
 * @returns Tool definition
 */
export function createGetSettingsTool(): Tool {
  return {
    id: 'cal_settings_get',
    name: 'Get Calendar Settings',
    description: 'Gets the current calendar settings including reminder time and instruction',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(
      _params: Record<string, unknown>,
      context: ExecutionContext
    ): Promise<ToolResult> {
      if (!context.userId) {
        return { success: false, error: 'User context required' }
      }

      try {
        const repository = createRepository(context)
        const settings = await repository.settings.get()

        return {
          success: true,
          data: {
            reminderMinutes: settings.reminderMinutes,
            instruction: settings.instruction,
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
 * Creates the cal_settings_update tool.
 * Updates the calendar settings such as reminder time and instruction.
 * @param onUpdate Optional callback after update
 * @returns Tool definition
 */
export function createUpdateSettingsTool(
  onUpdate?: (userId: string) => void
): Tool {
  return {
    id: 'cal_settings_update',
    name: 'Update Calendar Settings',
    description: 'Updates the calendar settings such as reminder time and instruction',
    parameters: {
      type: 'object',
      properties: {
        reminderMinutes: {
          type: 'number',
          description: 'How many minutes before an event to send a reminder',
        },
        instruction: {
          type: 'string',
          description: 'Instruction included in every calendar reminder sent to Stina',
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

      const input = params as CalendarSettingsUpdate

      try {
        const repository = createRepository(context)
        const settings = await repository.settings.update(input)

        if (onUpdate) {
          onUpdate(context.userId)
        }

        return {
          success: true,
          data: {
            reminderMinutes: settings.reminderMinutes,
            instruction: settings.instruction,
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
