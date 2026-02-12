/**
 * Reminder scheduling for upcoming calendar events.
 */

import type { CalendarEvent, CalendarSettings } from './types.js'
import type { ChatAPI, UserAPI, UserProfile, LogAPI } from './shared-deps.js'

/**
 * Fire a reminder for a calendar event, notifying the user via chat instruction.
 */
export async function fireReminder(
  event: CalendarEvent,
  settings: CalendarSettings,
  deps: { chat: ChatAPI; user?: UserAPI; log: LogAPI },
  userId: string
): Promise<void> {
  if (!deps.chat) return

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
