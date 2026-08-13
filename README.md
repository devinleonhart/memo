# Memo Discord Bot

A personal assistant.

## Env vars

Create `.env` and fill in values:

- `MEMO_SECRET_KEY`: your bot token
- `MEMO_CLIENT_ID`: Application ID
- `MEMO_GUILD_ID`: Your server ID
- `MEMO_COMMANDS_SCOPE`: `guild`
- `EMOTE_BASE_URL` (optional): base URL of the emote generator, defaults to `https://emote.devleo.me`

## Commands

- `/emote` — Generate a character emote and post it as an embed. The
  `character`, `eyebrows`, `eyes`, `mouth`, and optional `head` options are
  autocompleted from the emote generator's live catalog.

## Docker

Use the `docker compose` command.

```bash
cd /Users/devin/source/memo
docker compose up -d
docker compose logs -f
docker compose down
```

## Notes

- Slash commands are registered on startup.
