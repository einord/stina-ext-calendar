# Calendar Manager Extension for Stina

Subscribe to calendars from iCal URL, Google Calendar, iCloud, Outlook, or generic CalDAV servers. View upcoming events in a side panel and get AI-driven reminders before events start.

## Features

- **Multiple Providers**: iCal URL, Google Calendar, iCloud (CalDAV), Outlook (Graph API), and generic CalDAV
- **Event Sync**: Automatic polling with incremental sync (sync tokens, delta links)
- **AI Reminders**: Configurable reminders that notify Stina before events start
- **Side Panel**: Upcoming events grouped by day (Today, Tomorrow)
- **Full CRUD**: Create, update, and delete events (with user confirmation)
- **OAuth2 Support**: Device Code Flow for Google and Outlook

## Installation

1. Download the latest release
2. Install the extension in Stina via Settings > Extensions
3. Configure your calendar accounts in Settings > Calendar Accounts

## Provider Setup

### iCal URL

1. Find the public/private iCal URL for your calendar (usually ends in `.ics`)
2. Add it as a new account with the iCal URL provider
3. Events are synced automatically (read-only)

### Google Calendar

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Google Calendar API
3. Create OAuth2 credentials (Desktop app)
4. Configure the Client ID and Secret in Stina admin settings
5. Add an account and complete the OAuth flow

### iCloud

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in and go to Security > App-Specific Passwords
3. Generate a new password for Stina
4. Use your Apple ID email and the app-specific password

### Outlook

1. Register an app in [Azure Portal](https://portal.azure.com)
2. Add API permissions: `Calendars.ReadWrite`
3. Configure the Client ID and Tenant ID in Stina admin settings
4. Add an account and complete the OAuth flow

### CalDAV

1. Enter your CalDAV server URL
2. Use your username and password

## Development

- `pnpm install`
- `pnpm build`
- `pnpm dev`
- `pnpm typecheck`

## Packaging

- `pnpm pack-extension`

## License

MIT
