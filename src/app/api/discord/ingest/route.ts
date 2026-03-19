import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import {
  type DiscordIngestPayload,
  mapChannelToContext,
} from '@/lib/orchestrator/discord-sync'

/**
 * POST /api/discord/ingest
 *
 * Receives a Discord message payload from the OpenClaw Discord bridge
 * (or any trusted caller with a valid API key) and routes it into the
 * appropriate Mission Control context.
 *
 * Authentication: Bearer <API_KEY> or X-Api-Key header.
 *
 * Dedup: messages whose discord_message_id already exists in the
 * activities table are silently ignored (echo suppression).
 *
 * Routing:
 *   chat      -> broadcasts chat.message to the global chat panel
 *   agent-dm  -> broadcasts chat.message with target_agent set
 *   approvals -> broadcasts approval.response event
 *   other     -> logs the activity only (operational / project / unknown)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let payload: DiscordIngestPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  if (!payload.discord_message_id || typeof payload.discord_message_id !== 'string') {
    return NextResponse.json({ error: 'discord_message_id is required' }, { status: 400 })
  }
  if (!payload.channel_name || typeof payload.channel_name !== 'string') {
    return NextResponse.json({ error: 'channel_name is required' }, { status: 400 })
  }
  if (!payload.content || typeof payload.content !== 'string') {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (!payload.author || typeof payload.author !== 'string') {
    return NextResponse.json({ error: 'author is required' }, { status: 400 })
  }

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  // Dedup check: reject if discord_message_id already exists in activities
  const existing = db
    .prepare('SELECT id FROM activities WHERE discord_message_id = ? LIMIT 1')
    .get(payload.discord_message_id) as { id: number } | undefined

  if (existing) {
    return NextResponse.json({ status: 'duplicate' })
  }

  const context = mapChannelToContext(payload.channel_name)
  const sentAt = payload.sent_at ?? Math.floor(Date.now() / 1000)
  const actor = `discord:${payload.author}`

  try {
    // Route based on context type
    if (context.type === 'chat') {
      // Insert message into messages table and broadcast to chat panel
      const conversationId = 'discord:general'
      const result = db
        .prepare(
          `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversationId,
          actor,
          null,
          payload.content,
          'text',
          JSON.stringify({ discord_message_id: payload.discord_message_id, channel: payload.channel_name, ...(payload.metadata ?? {}) }),
          workspaceId
        )

      const messageId = result.lastInsertRowid as number

      eventBus.broadcast('chat.message', {
        id: messageId,
        conversation_id: conversationId,
        from_agent: actor,
        to_agent: null,
        content: payload.content,
        message_type: 'text',
        metadata: { discord_message_id: payload.discord_message_id, channel: payload.channel_name },
        created_at: sentAt,
        workspace_id: workspaceId,
      })

      // Log activity with discord_message_id for dedup tracking
      db.prepare(
        `INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id, discord_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'discord_ingest',
        'message',
        messageId,
        actor,
        `Discord message from ${payload.author} in #${payload.channel_name}`,
        JSON.stringify({ context: context.type, channel: payload.channel_name }),
        workspaceId,
        payload.discord_message_id
      )
    } else if (context.type === 'agent-dm') {
      // DM to a specific agent — route as a targeted chat message
      const conversationId = `discord:agent:${context.agent}`
      const result = db
        .prepare(
          `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversationId,
          actor,
          context.agent,
          payload.content,
          'text',
          JSON.stringify({ discord_message_id: payload.discord_message_id, channel: payload.channel_name, target_agent: context.agent, ...(payload.metadata ?? {}) }),
          workspaceId
        )

      const messageId = result.lastInsertRowid as number

      eventBus.broadcast('chat.message', {
        id: messageId,
        conversation_id: conversationId,
        from_agent: actor,
        to_agent: context.agent,
        content: payload.content,
        message_type: 'text',
        metadata: {
          discord_message_id: payload.discord_message_id,
          channel: payload.channel_name,
          target_agent: context.agent,
        },
        created_at: sentAt,
        workspace_id: workspaceId,
      })

      // Log activity with discord_message_id for dedup tracking
      db.prepare(
        `INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id, discord_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'discord_ingest',
        'message',
        messageId,
        actor,
        `Discord DM to ${context.agent} from ${payload.author}`,
        JSON.stringify({ context: context.type, channel: payload.channel_name, target_agent: context.agent }),
        workspaceId,
        payload.discord_message_id
      )
    } else if (context.type === 'approvals') {
      // Approval response from Discord (e.g. approve/reject reactions or commands)
      eventBus.broadcast('approval.response' as any, {
        discord_message_id: payload.discord_message_id,
        author: payload.author,
        content: payload.content,
        channel: payload.channel_name,
        sent_at: sentAt,
        metadata: payload.metadata ?? {},
      })

      // Log activity with discord_message_id for dedup tracking
      db.prepare(
        `INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id, discord_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'discord_ingest',
        'approval',
        0,
        actor,
        `Discord approval response from ${payload.author} in #${payload.channel_name}`,
        JSON.stringify({ context: context.type, channel: payload.channel_name, content: payload.content }),
        workspaceId,
        payload.discord_message_id
      )
    } else {
      // Operational, project, or unknown channels — log activity only
      db.prepare(
        `INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id, discord_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'discord_ingest',
        'discord_message',
        0,
        actor,
        `Discord message from ${payload.author} in #${payload.channel_name}`,
        JSON.stringify({ context: context.type, channel: payload.channel_name, content: payload.content }),
        workspaceId,
        payload.discord_message_id
      )
    }

    logger.info(
      { channel: payload.channel_name, context: context.type, author: payload.author },
      'Discord message ingested'
    )

    return NextResponse.json({ status: 'ok', context: context.type })
  } catch (error) {
    logger.error({ err: error, payload }, 'Discord ingest error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
