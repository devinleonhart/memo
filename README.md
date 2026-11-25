# Memo

A Discord bot for my servers: it posts emotes and files images into Blackbook.

## Features

- `/emote`: composes an emote of a character and posts it. The character and its parts are completed from the Emote Generator's catalog.
- `/blackbook count`: counts the `:blackbookit:` reactions in a channel.
- `/blackbook export`: uploads the images marked with `:blackbookit:` to a Blackbook universe.
- Reacting to a message with `:blackbookit:` asks for a universe and uploads that message's images.

Images are fetched only from public addresses, and one that was uploaded before is not uploaded again.

## Development

Needs Node and pnpm at the versions in `.tool-versions`, and a `.env` with the variables below.

```bash
pnpm install
pnpm dev           # runs with tsx, restarting on changes
pnpm quality       # type check, lint, format check and tests
pnpm quality:ci    # the same with the coverage gate: everything CI checks
pnpm format        # formats with Prettier
pnpm lint:fix      # fixes lint problems
docker compose up  # the same in a container, from Dockerfile.dev
```

Slash commands are registered on startup.

## Environment

| Variable                                    | Purpose                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MEMO_SECRET_KEY`                           | The bot's token                                                                                                              |
| `MEMO_CLIENT_ID`                            | The application's ID                                                                                                         |
| `MEMO_GUILD_ID`                             | The server's ID; required when the scope is `guild`                                                                          |
| `MEMO_COMMANDS_SCOPE`                       | `guild` (default) or `global`                                                                                                |
| `BLACKBOOK_BASE_URL`, `BLACKBOOK_API_TOKEN` | Blackbook's address and its import token                                                                                     |
| `MEMO_BLACKBOOK_UNIVERSES`                  | The universes to offer, as `CODE=Name` pairs separated by `;`. They are kept out of the code on purpose                      |
| `MEMO_SPOOL_DIR`                            | Where downloads and the index of uploaded images are kept; in the image `/data/blackbook-spool`, which should be on a volume |
| `EMOTE_BASE_URL`                            | The Emote Generator's address (default `https://emote.devleo.me`)                                                            |

## Deployment

A merge to `master` runs CI, which publishes `devleo/memo:latest` to Docker Hub when the checks pass. On the server:

```bash
docker compose pull memo-bot
docker compose up -d memo-bot
```

## Architecture

```
src/commands/    # One folder for each slash command
src/events/      # Discord events: ready, interactions, reactions
src/registry.ts  # The list of commands and events; a new one must be added here
src/bootstrap.ts # Checks the settings, wires the registry to the client, registers commands, logs in
src/services/    # The Emote Generator, the Blackbook import, and fetching of public addresses
src/settings.ts  # The environment, read once
```
