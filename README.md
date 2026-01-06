# Memo Discord Bot

A personal assistant.

## Env vars

Create `.env` and fill in values:

- `MEMO_SECRET_KEY`: your bot token
- `MEMO_CLIENT_ID`: Application ID
- `MEMO_GUILD_ID`: Your server ID
- `MEMO_COMMANDS_SCOPE`: `guild`

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
