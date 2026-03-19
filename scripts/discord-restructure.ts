#!/usr/bin/env tsx
/**
 * Discord Channel Restructure Script
 *
 * Migrates Shadow Collective Discord from 8 categories to 4:
 *   COMMAND, OPERATIONS, PROJECTS, AGENTS
 *
 * Retired categories and channels are moved to ARCHIVED (not deleted).
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=<token> DISCORD_GUILD_ID=<id> pnpm dlx tsx scripts/discord-restructure.ts
 */

const BASE_URL = 'https://discord.com/api/v10'

const token = process.env.DISCORD_BOT_TOKEN
const guildId = process.env.DISCORD_GUILD_ID

if (!token) {
  console.error('ERROR: DISCORD_BOT_TOKEN is not set')
  process.exit(1)
}
if (!guildId) {
  console.error('ERROR: DISCORD_GUILD_ID is not set')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscordChannel {
  id: string
  name: string
  type: number // 0=text, 4=category, 2=voice, etc.
  parent_id?: string | null
  position: number
  topic?: string | null
}

// ---------------------------------------------------------------------------
// Target structure
// ---------------------------------------------------------------------------

const TARGET_CATEGORIES = ['COMMAND', 'OPERATIONS', 'PROJECTS', 'AGENTS'] as const

// Channels to archive (move to ARCHIVED category)
const CHANNELS_TO_ARCHIVE = new Set([
  'atlas-research',
  'oracle-analytics',
  'ink-content',
  'canvas-creative',
  'ledger-finance',
  'apex-trading',
  'merchant-commerce',
  'foundry-ventures',
  'juris-legal',
  'diplomat-comms',
  'wire-integrations',
  'ryder-career',
  'nexus-briefing',
])

// Old categories to archive
const CATEGORIES_TO_ARCHIVE = new Set([
  'INTELLIGENCE',
  'CONTENT',
  'BUSINESS',
  'EXTERNAL',
  'COMMUNITY',
])

// Channels to rename: old-name -> new-name
const RENAME_MAP: Record<string, string> = {
  'activity-log': 'activity',
  'forge-ops': 'forge',
}

// Channel mappings: channel-name -> target category name
const COMMAND_CHANNELS = ['general', 'approvals']
const OPERATIONS_CHANNELS = ['taskboard', 'activity', 'alerts', 'ops-feed', 'system-logs']
const PROJECTS_CHANNELS = ['active-projects', 'completed-projects', 'project-proposals']
const AGENTS_CHANNELS = [
  'shadow',
  'nexus',
  'forge',
  'warden',
  'stack',
  'atlas',
  'oracle',
  'ink',
  'canvas',
  'ledger',
  'apex',
  'merchant',
  'foundry',
  'juris',
  'diplomat',
  'wire',
  'ryder',
  'harmony',
  'archive',
]

const CHANNEL_CATEGORY_MAP: Record<string, (typeof TARGET_CATEGORIES)[number]> = {}
for (const ch of COMMAND_CHANNELS) CHANNEL_CATEGORY_MAP[ch] = 'COMMAND'
for (const ch of OPERATIONS_CHANNELS) CHANNEL_CATEGORY_MAP[ch] = 'OPERATIONS'
for (const ch of PROJECTS_CHANNELS) CHANNEL_CATEGORY_MAP[ch] = 'PROJECTS'
for (const ch of AGENTS_CHANNELS) CHANNEL_CATEGORY_MAP[ch] = 'AGENTS'

// ---------------------------------------------------------------------------
// Discord API helpers
// ---------------------------------------------------------------------------

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function discordRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  await delay(1000) // respect rate limits — 1 s between calls

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && 'message' in data
      ? (data as Record<string, unknown>).message
      : text
    throw new Error(`Discord API ${method} ${path} => ${res.status}: ${msg}`)
  }

  return { status: res.status, data }
}

async function getChannels(): Promise<DiscordChannel[]> {
  const { data } = await discordRequest('GET', `/guilds/${guildId}/channels`)
  return data as DiscordChannel[]
}

async function createChannel(name: string, type: number, parentId?: string): Promise<DiscordChannel> {
  const { data } = await discordRequest('POST', `/guilds/${guildId}/channels`, {
    name,
    type,
    ...(parentId ? { parent_id: parentId } : {}),
  })
  return data as DiscordChannel
}

async function modifyChannel(
  channelId: string,
  patch: Partial<{ name: string; parent_id: string | null; position: number }>,
): Promise<DiscordChannel> {
  const { data } = await discordRequest('PATCH', `/channels/${channelId}`, patch)
  return data as DiscordChannel
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findByName(channels: DiscordChannel[], name: string): DiscordChannel | undefined {
  return channels.find((c) => c.name.toLowerCase() === name.toLowerCase())
}

function findCategoryByName(channels: DiscordChannel[], name: string): DiscordChannel | undefined {
  return channels.find(
    (c) => c.type === 4 && c.name.toLowerCase() === name.toLowerCase(),
  )
}

function log(action: string, detail: string): void {
  console.log(`[${action.padEnd(12)}] ${detail}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.log('Shadow Collective — Discord Restructure Script')
  console.log(`Guild: ${guildId}`)
  console.log('---')

  // -------------------------------------------------------------------------
  // Step 1: Fetch current state
  // -------------------------------------------------------------------------
  log('FETCH', 'Loading all channels...')
  let channels = await getChannels()
  log('FETCH', `Found ${channels.length} channels/categories`)

  // -------------------------------------------------------------------------
  // Step 2: Apply pending renames before anything else so downstream lookups
  //         use the final names.
  // -------------------------------------------------------------------------
  log('RENAME', 'Applying channel renames...')
  for (const [oldName, newName] of Object.entries(RENAME_MAP)) {
    const ch = findByName(channels, oldName)
    if (ch) {
      log('RENAME', `${oldName} -> ${newName}`)
      await modifyChannel(ch.id, { name: newName })
      ch.name = newName // update local cache
    } else {
      // may already be renamed from a previous run
      const already = findByName(channels, newName)
      if (already) {
        log('RENAME', `${newName} already exists, skipping rename`)
      } else {
        log('RENAME', `WARNING: source channel "${oldName}" not found`)
      }
    }
  }

  // Refresh channel list after renames
  channels = await getChannels()

  // -------------------------------------------------------------------------
  // Step 3: Ensure ARCHIVED category exists
  // -------------------------------------------------------------------------
  log('CATEGORY', 'Ensuring ARCHIVED category...')
  let archivedCategory = findCategoryByName(channels, 'ARCHIVED')
  if (!archivedCategory) {
    archivedCategory = await createChannel('ARCHIVED', 4)
    log('CREATE', 'Created ARCHIVED category')
  } else {
    log('SKIP', 'ARCHIVED category already exists')
  }

  // Refresh after potential creation
  channels = await getChannels()
  archivedCategory = findCategoryByName(channels, 'ARCHIVED')!

  // -------------------------------------------------------------------------
  // Step 4: Move channels targeted for archive into ARCHIVED category
  // -------------------------------------------------------------------------
  log('ARCHIVE', 'Moving retired channels to ARCHIVED...')
  for (const chName of CHANNELS_TO_ARCHIVE) {
    const ch = findByName(channels, chName)
    if (!ch) {
      log('ARCHIVE', `WARNING: channel "${chName}" not found, skipping`)
      continue
    }
    if (ch.parent_id === archivedCategory.id) {
      log('SKIP', `#${chName} already in ARCHIVED`)
      continue
    }
    await modifyChannel(ch.id, { parent_id: archivedCategory.id })
    log('ARCHIVE', `#${chName} moved to ARCHIVED`)
  }

  // -------------------------------------------------------------------------
  // Step 5: Move old categories to ARCHIVED (by moving any remaining children
  //         then orphaning the category — Discord has no "archive category")
  //         We leave the empty category intact to preserve any remaining
  //         channels that weren't explicitly listed for archival.
  // -------------------------------------------------------------------------
  log('ARCHIVE', 'Moving remaining channels from retired categories to ARCHIVED...')
  channels = await getChannels()

  for (const catName of CATEGORIES_TO_ARCHIVE) {
    const cat = findCategoryByName(channels, catName)
    if (!cat) {
      log('SKIP', `Category "${catName}" not found`)
      continue
    }

    // Move any remaining children
    const children = channels.filter((c) => c.parent_id === cat.id && c.type !== 4)
    for (const child of children) {
      await modifyChannel(child.id, { parent_id: archivedCategory.id })
      log('ARCHIVE', `#${child.name} (from ${catName}) moved to ARCHIVED`)
    }

    // Rename the old category to signal it's been processed
    const archivedCatName = `archived-${catName.toLowerCase()}`
    await modifyChannel(cat.id, { name: archivedCatName })
    log('ARCHIVE', `Category "${catName}" renamed to "${archivedCatName}"`)
  }

  // -------------------------------------------------------------------------
  // Step 6: Ensure target categories exist
  // -------------------------------------------------------------------------
  log('CATEGORY', 'Ensuring target categories...')
  channels = await getChannels()
  const categoryIds: Record<string, string> = {}

  for (const catName of TARGET_CATEGORIES) {
    let cat = findCategoryByName(channels, catName)
    if (!cat) {
      cat = await createChannel(catName, 4)
      log('CREATE', `Created category ${catName}`)
      // refresh so subsequent steps see it
      channels = await getChannels()
      cat = findCategoryByName(channels, catName)!
    } else {
      log('SKIP', `Category ${catName} already exists`)
    }
    categoryIds[catName] = cat.id
  }

  // -------------------------------------------------------------------------
  // Step 7: Create new channels that don't exist yet
  // -------------------------------------------------------------------------
  log('CREATE', 'Creating missing channels...')
  channels = await getChannels()

  const allTargetChannels = [
    ...COMMAND_CHANNELS,
    ...OPERATIONS_CHANNELS,
    ...PROJECTS_CHANNELS,
    ...AGENTS_CHANNELS,
  ]

  for (const chName of allTargetChannels) {
    const existing = findByName(channels, chName)
    if (existing) {
      log('SKIP', `#${chName} already exists`)
      continue
    }
    const catName = CHANNEL_CATEGORY_MAP[chName]!
    const catId = categoryIds[catName]
    await createChannel(chName, 0, catId)
    log('CREATE', `#${chName} in ${catName}`)
    // Update local cache to avoid re-creating
    channels = await getChannels()
  }

  // -------------------------------------------------------------------------
  // Step 8: Move existing channels to correct target categories
  // -------------------------------------------------------------------------
  log('MOVE', 'Moving channels to correct categories...')
  channels = await getChannels()

  for (const chName of allTargetChannels) {
    const ch = findByName(channels, chName)
    if (!ch) {
      log('MOVE', `WARNING: #${chName} not found (should have been created above)`)
      continue
    }

    const catName = CHANNEL_CATEGORY_MAP[chName]!
    const targetCatId = categoryIds[catName]

    if (ch.parent_id === targetCatId) {
      log('SKIP', `#${chName} already in ${catName}`)
      continue
    }

    await modifyChannel(ch.id, { parent_id: targetCatId })
    log('MOVE', `#${chName} -> ${catName}`)
  }

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  console.log('\n---')
  console.log('Restructure complete.')
  console.log()
  console.log('Final structure:')
  console.log('  ARCHIVED  — retired channels (history preserved)')
  for (const catName of TARGET_CATEGORIES) {
    const members: string[] = []
    for (const [ch, cat] of Object.entries(CHANNEL_CATEGORY_MAP)) {
      if (cat === catName) members.push(`#${ch}`)
    }
    console.log(`  ${catName.padEnd(12)} — ${members.join(', ')}`)
  }
}

run().catch((err: Error) => {
  console.error(`\nERROR: ${err.message}`)
  process.exit(1)
})
