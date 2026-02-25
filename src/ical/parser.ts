/**
 * iCal VEVENT parsing utilities using ical.js
 */

import ICAL from 'ical.js'
import type { CalendarEvent, EventResponseStatus } from '../types.js'

/**
 * Parse iCal data and extract events within a date range.
 */
export function parseICalData(
  icalData: string,
  accountId: string,
  calendarId: string,
  from: Date,
  to: Date,
  userEmail?: string
): Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>[] {
  const jcalData = ICAL.parse(icalData)
  const comp = new ICAL.Component(jcalData)
  const vevents = comp.getAllSubcomponents('vevent')
  const events: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>[] = []

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent)
    const uid = event.uid

    if (event.isRecurring()) {
      const iterator = event.iterator()
      let next = iterator.next()
      // Limit recurrence expansion to 365 occurrences
      let count = 0
      while (next && count < 365) {
        const occurrence = event.getOccurrenceDetails(next)
        const start = occurrence.startDate.toJSDate()
        const end = occurrence.endDate.toJSDate()

        if (start > to) break
        if (end >= from) {
          const occurrenceUid = `${uid}_${start.toISOString()}`
          events.push(buildEvent(vevent, event, occurrenceUid, accountId, calendarId, start, end, userEmail))
        }

        next = iterator.next()
        count++
      }
    } else {
      const start = event.startDate.toJSDate()
      const end = event.endDate ? event.endDate.toJSDate() : start

      if (end >= from && start <= to) {
        events.push(buildEvent(vevent, event, uid, accountId, calendarId, start, end, userEmail))
      }
    }
  }

  return events
}

function buildEvent(
  vevent: ICAL.Component,
  event: ICAL.Event,
  uid: string,
  accountId: string,
  calendarId: string,
  start: Date,
  end: Date,
  userEmail?: string
): Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> {
  const isAllDay = event.startDate.isDate

  const rruleProp = vevent.getFirstProperty('rrule')
  const recurrenceRule = rruleProp ? String(rruleProp.getFirstValue()) : null

  const organizerProp = vevent.getFirstProperty('organizer')
  const organizer = organizerProp ? String(organizerProp.getFirstValue()).replace('mailto:', '') : null

  const attendeeProps = vevent.getAllProperties('attendee')
  const attendees = attendeeProps.map((a: ICAL.Property) => {
    const val = a.getFirstValue()
    return typeof val === 'string' ? val.replace('mailto:', '') : ''
  })

  // Extract RSVP/participation status for the current user
  let responseStatus: EventResponseStatus | null = null
  if (userEmail) {
    const normalizedUserEmail = userEmail.toLowerCase()
    for (const a of attendeeProps) {
      const val = a.getFirstValue()
      const email = typeof val === 'string' ? val.replace('mailto:', '').toLowerCase() : ''
      if (email === normalizedUserEmail) {
        const partstat = a.getParameter('partstat')
        switch (partstat) {
          case 'ACCEPTED': responseStatus = 'accepted'; break
          case 'DECLINED': responseStatus = 'declined'; break
          case 'TENTATIVE': responseStatus = 'tentative'; break
          case 'NEEDS-ACTION': responseStatus = 'needsAction'; break
        }
        break
      }
    }
  }

  return {
    accountId,
    calendarId,
    uid,
    title: event.summary || '(No title)',
    description: event.description || null,
    location: event.location || null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: isAllDay,
    recurrenceRule,
    organizer,
    attendees,
    responseStatus,
    remoteUrl: null,
    etag: null,
    rawIcs: vevent.toString(),
  }
}
