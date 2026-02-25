/**
 * In-memory state management for the event detail modal.
 */

const MAX_STATES = 100

export interface EventDetailData {
  id: string
  title: string
  formattedTime: string
  allDay: boolean
  location: string | null
  description: string | null
  accountName: string
  calendarName: string
  organizer: string | null
  attendeesText: string
  responseStatus: string | null
}

export interface EventDetailState {
  showModal: boolean
  event: EventDetailData | null
}

const states = new Map<string, EventDetailState>()

function getDefaultState(): EventDetailState {
  return {
    showModal: false,
    event: null,
  }
}

export function getEventDetailState(userId: string): EventDetailState {
  if (!states.has(userId)) {
    if (states.size >= MAX_STATES) {
      const oldestKey = states.keys().next().value
      if (oldestKey) states.delete(oldestKey)
    }
    states.set(userId, getDefaultState())
  }
  return states.get(userId)!
}

export function deleteEventDetailState(userId: string): void {
  states.delete(userId)
}

export function clearAllEventDetailStates(): void {
  states.clear()
}
