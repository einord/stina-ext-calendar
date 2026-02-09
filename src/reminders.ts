/**
 * Reminder scheduling for upcoming calendar events.
 */

import type { Disposable, StorageAPI, SecretsAPI } from '@stina/extension-api/runtime'
import type { ExecutionContext } from '@stina/extension-api/runtime'
import { CalendarRepository } from './db/repository.js'
import type { CalendarEvent, CalendarSettings } from './types.js'

type ChatAPI = {
  appendInstruction: (message: {
    text: string
    conversationId?: string
    userId?: string
  }) => Promise<void>
}

type SchedulerAPI = {
  schedule: (job: {
    id: string
    schedule: { type: 'at'; at: string } | { type: 'interval'; everyMs: number }
    payload?: Record<string, unknown>
    userId: string
  }) => Promise<void>
  cancel: (jobId: string) => Promise<void>
  onFire: (
    callback: (payload: { id: string; payload?: Record<string, unknown>; userId: string }, execContext: ExecutionContext) => void
  ) => Disposable
}

type UserProfile = {
  firstName?: string
  nickname?: string
  language?: string
  timezone?: string
}

type UserAPI = {
  getProfile: (userId?: string) => Promise<UserProfile>
}

export interface ReminderDeps {
  chat?: ChatAPI
  scheduler?: SchedulerAPI
  user?: UserAPI
  log: {
    info: (msg: string, data?: Record<string, unknown>) => void
    warn: (msg: string, data?: Record<string, unknown>) => void
    debug: (msg: string, data?: Record<string, unknown>) => void
  }
}

/**
 * Schedule reminders for upcoming events within the next 24 hours.
 */
export async function scheduleReminders(
  userId: string,
  userStorage: StorageAPI,
  userSecrets: SecretsAPI,
  deps: ReminderDeps
): Promise<void> {
  if (!deps.scheduler) return

  try {
    const repo = new CalendarRepository(userStorage, userSecrets)
    const settings = await repo.settings.get()

    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const events = await repo.events.getUpcoming(now.toISOString(), in24h.toISOString())

    for (const event of events) {
      const eventStart = new Date(event.startAt)
      const reminderTime = new Date(eventStart.getTime() - settings.reminderMinutes * 60 * 1000)

      // Only schedule if reminder time is in the future
      if (reminderTime.getTime() <= now.getTime()) continue

      const jobId = `cal-reminder-${event.id}`

      try {
        await deps.scheduler.schedule({
          id: jobId,
          schedule: { type: 'at', at: reminderTime.toISOString() },
          payload: { eventId: event.id, userId },
          userId,
        })

        deps.log.debug('Scheduled reminder', {
          eventId: event.id,
          title: event.title,
          reminderAt: reminderTime.toISOString(),
        })
      } catch (error) {
        deps.log.warn('Failed to schedule reminder', {
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    deps.log.warn('Failed to schedule reminders', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Handle a reminder firing: notify the user about an upcoming event.
 */
export async function handleReminderFire(
  firePayload: { id: string; payload?: Record<string, unknown>; userId: string },
  execContext: ExecutionContext,
  deps: ReminderDeps
): Promise<void> {
  if (!deps.chat) return

  const payload = firePayload.payload as { eventId: string; userId: string } | undefined
  if (!payload?.eventId) return

  const userId = firePayload.userId || execContext.userId
  if (!userId) return

  try {
    const repo = new CalendarRepository(execContext.userStorage, execContext.userSecrets)
    const event = await repo.events.get(payload.eventId)

    if (!event) {
      deps.log.debug('Event not found for reminder', { eventId: payload.eventId })
      return
    }

    const settings = await repo.settings.get()

    // Fetch user profile for personalization
    let userProfile: UserProfile | undefined
    if (deps.user) {
      try {
        userProfile = await deps.user.getProfile(userId)
      } catch (profileError) {
        deps.log.debug('Could not fetch user profile', {
          error: profileError instanceof Error ? profileError.message : String(profileError),
        })
      }
    }

    const userName = userProfile?.nickname || userProfile?.firstName
    const language = userProfile?.language
    const instruction = buildReminderInstruction(event, settings, userName, language)

    await deps.chat.appendInstruction({ text: instruction, userId })

    deps.log.info('Sent calendar reminder', {
      eventId: event.id,
      title: event.title,
    })
  } catch (error) {
    deps.log.warn('Failed to handle reminder', {
      eventId: payload.eventId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Set up a listener for reminder scheduler events.
 */
export function setupReminderListener(deps: ReminderDeps): Disposable | undefined {
  if (!deps.scheduler) return undefined

  return deps.scheduler.onFire(async (firePayload, execContext) => {
    if (!firePayload.id.startsWith('cal-reminder-')) return
    await handleReminderFire(firePayload, execContext, deps)
  })
}

/**
 * Build the instruction text for a calendar reminder.
 */
export function buildReminderInstruction(
  event: CalendarEvent,
  settings: CalendarSettings,
  userName?: string,
  language?: string
): string {
  const parts: string[] = []

  parts.push('[Calendar Reminder]')
  parts.push('')

  if (userName) {
    parts.push(`User: ${userName}`)
  }

  parts.push(`Event: ${event.title}`)
  parts.push(`Start: ${event.startAt}`)
  parts.push(`End: ${event.endAt}`)

  if (event.allDay) {
    parts.push('All day event')
  }

  if (event.location) {
    parts.push(`Location: ${event.location}`)
  }

  if (event.description) {
    parts.push(`Description: ${event.description}`)
  }

  if (event.attendees && event.attendees.length > 0) {
    parts.push(`Attendees: ${event.attendees.join(', ')}`)
  }

  if (language) {
    parts.push(`Language: ${language}`)
  }

  if (settings.instruction) {
    parts.push('')
    parts.push(`Instruction: ${settings.instruction}`)
  }

  return parts.join('\n')
}
