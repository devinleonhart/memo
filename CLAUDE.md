# Memo

Read README.md for commands and variables. discord.js 14 in TypeScript, compiled to CommonJS.

- `pnpm quality:ci` is everything CI checks: both type checks, lint, format check and tests with the coverage floor.
- A command or event exists only when it is in `src/registry.ts`. Each is a typed default export
  (`src/core/command.ts`).
- There are two tsconfigs, as in Wordsmith: `tsconfig.json` checks `src` and `tests` the way Vitest and tsx load
  them; `tsconfig.build.json` compiles `src` the way Node runs `dist/`.
- Keep `src` free of `any`. Tests may use it for mocks.
- A link from a Discord user is fetched only through `fetchPublic` (`src/services/publicFetch.ts`), which refuses
  every address that is not public.
- The universes come from `MEMO_BLACKBOOK_UNIVERSES`. Keep their names out of the code and the tests.
- Node and pnpm are stated in `.tool-versions`, `package.json` and both Dockerfiles. CI fails if they disagree.
- `pnpm-workspace.yaml` overrides two packages inside discord.js with patched versions. Read its comment before
  removing one.
- On the server the service is `memo-bot` and the container `memo`. It reaches Blackbook at `http://blackbook:3000`,
  and its volume at `/data` belongs to user 100, group 101.
- To start the built bot without logging in, give it a false `MEMO_SECRET_KEY`: it lists its commands and stops at
  Discord's refusal.
