import { type BotCommand, type BotEvent } from './core/command'

// Events
import interactionCreate from './events/client/interactionCreate'
import messageReactionAdd from './events/client/messageReactionAdd'
import ready from './events/client/ready'

// Commands
import blackbook from './commands/blackbook/blackbook'
import emote from './commands/emote/emote'

export const commands: BotCommand[] = [blackbook, emote]

export const events: BotEvent[] = [interactionCreate, messageReactionAdd, ready]
