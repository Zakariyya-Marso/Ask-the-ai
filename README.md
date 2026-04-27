# Ask The AI - Discord Bot Control Website

This app gives you a Discord login dashboard where a user can:

1. Login with their Discord account.
2. Click an Invite button to add the **Ask The AI** bot to a server.
3. Pick a server and a text channel to configure where the bot should work.

## Setup

1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Fill in your Discord OAuth app values (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`).
3. Put your bot invite URL in `DISCORD_BOT_INVITE_URL`.
4. Run:
   ```bash
   npm start
   ```
5. Open http://localhost:3000

## Notes

- OAuth scopes used: `identify`, `guilds`.
- Only servers where the user can manage the guild are listed.
- Config is stored in `data/configs.json` keyed by Discord user ID.

## Production tips

- Put this behind HTTPS.
- Use a stronger `SESSION_SECRET`.
- Replace in-memory sessions with Redis/database sessions.
