import { OrchestrationEngine } from './engine'
import { LLMClient } from './llm-client'
import { DiscordPoster, type DiscordWebhookConfig } from './discord-poster'

// Singleton engine instance
let _engine: OrchestrationEngine | null = null

export function getOrchestrationEngine(): OrchestrationEngine {
  if (!_engine) {
    const llm = new LLMClient()

    // Load Discord webhook configs from env vars
    // Format: DISCORD_WEBHOOK_<CHANNEL>=<url>
    const discordConfigs: DiscordWebhookConfig[] = []
    const channelNames = [
      'general', 'taskboard', 'ops-feed', 'alerts', 'active-projects', 'approvals',
      'shadow', 'nexus', 'forge', 'warden', 'stack', 'atlas', 'oracle',
      'ink', 'canvas', 'ledger', 'apex', 'merchant', 'foundry',
      'juris', 'diplomat', 'wire', 'ryder', 'harmony', 'archive',
    ]
    for (const name of channelNames) {
      const envKey = `DISCORD_WEBHOOK_${name.toUpperCase().replace(/-/g, '_')}`
      const url = process.env[envKey]
      if (url) discordConfigs.push({ channelName: name, webhookUrl: url })
    }

    const discord = discordConfigs.length > 0 ? new DiscordPoster(discordConfigs) : null

    // Lazy-require the production DB to avoid importing it at module load time
    // (the DB module pulls in migrations and file I/O which break in unit tests).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDatabase } = require('../db') as { getDatabase: () => import('../orchestrator/engine').EngineDb }
    const db = getDatabase()

    _engine = new OrchestrationEngine({ llm, discord, db, providerMinGap: 2000 })
  }
  return _engine
}

// Re-export key types
export { OrchestrationEngine } from './engine'
export type { LLMClient } from './llm-client'
export type { DiscordPoster } from './discord-poster'
