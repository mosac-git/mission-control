/**
 * Discord -> Mission Control ingest utilities.
 * Provides dedup detection and channel-to-context routing.
 */

// All 19 Shadow Collective agent names
export const AGENT_NAMES = [
  'shadow',
  'forge',
  'nexus',
  'cipher',
  'echo',
  'veil',
  'arc',
  'nova',
  'pulse',
  'rune',
  'sable',
  'drift',
  'flux',
  'grid',
  'haze',
  'index',
  'jade',
  'kite',
  'lynx',
] as const

export const OPERATIONAL_CHANNELS = [
  'taskboard',
  'activity',
  'alerts',
  'ops-feed',
  'system-logs',
] as const

export const PROJECT_CHANNELS = [
  'active-projects',
  'completed-projects',
  'project-proposals',
] as const

// Context union type for routing decisions
export type SyncContext =
  | { type: 'chat'; panel: 'chat' }
  | { type: 'agent-dm'; agent: string }
  | { type: 'operational'; feed: string }
  | { type: 'project'; channel: string }
  | { type: 'approvals' }
  | { type: 'unknown' }

export interface DiscordIngestPayload {
  /** Discord snowflake message ID for dedup */
  discord_message_id: string
  /** Discord channel name (without #) */
  channel_name: string
  /** Display name of the Discord user or webhook that sent the message */
  author: string
  /** Raw message content */
  content: string
  /** Unix epoch seconds when the message was sent on Discord */
  sent_at?: number
  /** Optional metadata (e.g. embeds, attachments) */
  metadata?: Record<string, unknown>
}

/**
 * Returns true when the given discord_message_id is already known to MC,
 * indicating this message originated from MC itself (echo suppression).
 */
export function isEchoMessage(discordMessageId: string, knownIds: Set<string>): boolean {
  return knownIds.has(discordMessageId)
}

/**
 * Maps a Discord channel name to the appropriate Mission Control routing context.
 * Order of precedence: special channels > agent names > operational > project > unknown.
 */
export function mapChannelToContext(channelName: string): SyncContext {
  const name = channelName.toLowerCase().trim()

  // Explicit chat panel channels
  if (name === 'general' || name === 'chat') {
    return { type: 'chat', panel: 'chat' }
  }

  // Approvals channel
  if (name === 'approvals') {
    return { type: 'approvals' }
  }

  // Agent DM channels - match by agent name
  if ((AGENT_NAMES as readonly string[]).includes(name)) {
    return { type: 'agent-dm', agent: name }
  }

  // Operational channels
  if ((OPERATIONAL_CHANNELS as readonly string[]).includes(name)) {
    return { type: 'operational', feed: name }
  }

  // Project channels
  if ((PROJECT_CHANNELS as readonly string[]).includes(name)) {
    return { type: 'project', channel: name }
  }

  return { type: 'unknown' }
}
