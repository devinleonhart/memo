import { bootstrap } from './bootstrap'

bootstrap().catch((error) => {
  console.error('Unhandled promise rejection:', error)
})
