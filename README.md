# Memo Discord Bot

A small Discord bot.

## What it does (so far)

- `/memo`: responds with `hello`

## Prereqs

- Node.js 24+ (to match `wordsmith`)
- `pnpm` (`npm i -g pnpm`) or Docker
- (Optional) `asdf` + `.tool-versions` for consistent local Node/pnpm versions

## Setup (Discord Developer Portal)

1. Go to the Discord Developer Portal: [My Applications](https://discord.com/developers/applications)
2. Click **New Application** → name it **memo**
3. In the left sidebar:
   - **Bot** → **Add Bot**
   - Copy the **Token** (you’ll put it in your `.env`)
4. **OAuth2 → URL Generator**
   - **Scopes**: `bot`, `applications.commands`
   - **Bot Permissions** (minimum): `Send Messages`
5. Use the generated URL to invite the bot to your server.

## Configure env vars

Copy `env.example` to `.env` and fill in values:

- `MEMO_SECRET_KEY`: your bot token
- `MEMO_CLIENT_ID`: Application ID (Developer Portal → General Information)
- `MEMO_GUILD_ID`: your server ID (right click server → Copy Server ID)
- `MEMO_COMMANDS_SCOPE`: `guild` (fast dev) or `global` (public; slower to propagate)

## Run locally

```bash
cd /Users/devin/source/memo
pnpm install
pnpm dev
```

The bot registers slash commands on startup.

- If `MEMO_COMMANDS_SCOPE=guild`, changes appear immediately in that server.
- If `MEMO_COMMANDS_SCOPE=global`, updates can take a while to appear.

## Docker (optional)

```bash
cd /Users/devin/source/memo
docker compose up -d
docker compose logs -f
docker compose down
```

## Notes

- Slash commands are registered on startup.
