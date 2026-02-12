/**
 * Shared dependency types used across sync, reminders, and worker.
 */

export type ChatAPI = {
  appendInstruction: (message: {
    text: string
    conversationId?: string
    userId?: string
  }) => Promise<void>
}

export type UserProfile = {
  firstName?: string
  nickname?: string
  language?: string
  timezone?: string
}

export type UserAPI = {
  getProfile: (userId?: string) => Promise<UserProfile>
}

export type LogAPI = {
  info: (msg: string, data?: Record<string, unknown>) => void
  warn: (msg: string, data?: Record<string, unknown>) => void
  debug: (msg: string, data?: Record<string, unknown>) => void
}
