/**
 * iCal VCALENDAR generation for CalDAV PUT operations
 */

import ICalGenerator from 'ical-generator'
import type { CalendarEventInput, CalendarEventUpdate, CalendarEvent } from '../types.js'

/**
 * Generate an iCal string for a new event.
 */
export function generateICalEvent(input: CalendarEventInput, uid: string): string {
  const calendar = ICalGenerator({ name: 'Stina Calendar' })

  const event = calendar.createEvent({
    id: uid,
    start: new Date(input.startAt),
    end: new Date(input.endAt),
    summary: input.title,
    description: input.description || undefined,
    location: input.location || undefined,
    allDay: input.allDay || false,
  })

  if (input.attendees) {
    for (const attendee of input.attendees) {
      event.createAttendee({ email: attendee })
    }
  }

  return calendar.toString()
}

/**
 * Generate an updated iCal string for an existing event.
 */
export function generateUpdatedICalEvent(
  existing: CalendarEvent,
  update: CalendarEventUpdate
): string {
  const calendar = ICalGenerator({ name: 'Stina Calendar' })

  const event = calendar.createEvent({
    id: existing.uid,
    start: new Date(update.startAt ?? existing.startAt),
    end: new Date(update.endAt ?? existing.endAt),
    summary: update.title ?? existing.title,
    description: (update.description !== undefined ? update.description : existing.description) || undefined,
    location: (update.location !== undefined ? update.location : existing.location) || undefined,
    allDay: update.allDay ?? existing.allDay,
  })

  const attendees = update.attendees ?? existing.attendees
  for (const attendee of attendees) {
    event.createAttendee({ email: attendee })
  }

  return calendar.toString()
}
