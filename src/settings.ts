import { config } from 'dotenv'

if (process.env.NODE_ENV === 'development') {
  config()
}

type CommandsScope = 'guild' | 'global'

interface Settings {
  clientID: string
  guildID: string
  secretKey: string
  commandsScope: CommandsScope
  dataPath?: string
}

function getCommandsScope(): CommandsScope {
  const v = (process.env.MEMO_COMMANDS_SCOPE ?? 'guild').toLowerCase()
  return v === 'global' ? 'global' : 'guild'
}

const settings: Settings = {
  clientID: process.env.MEMO_CLIENT_ID ?? '',
  guildID: process.env.MEMO_GUILD_ID ?? '',
  secretKey: process.env.MEMO_SECRET_KEY ?? '',
  commandsScope: getCommandsScope(),
  dataPath: process.env.MEMO_DATA_PATH
}

export default settings
