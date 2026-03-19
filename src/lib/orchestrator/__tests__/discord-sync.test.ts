import { describe, it, expect } from 'vitest'
import { isEchoMessage, mapChannelToContext } from '../discord-sync'

describe('discord sync', () => {
  it('detects echo messages by discord_message_id', () => {
    const knownIds = new Set(['msg_123', 'msg_456'])
    expect(isEchoMessage('msg_123', knownIds)).toBe(true)
    expect(isEchoMessage('msg_789', knownIds)).toBe(false)
  })

  it('maps general to chat context', () => {
    expect(mapChannelToContext('general')).toEqual({ type: 'chat', panel: 'chat' })
  })

  it('maps agent names to agent-dm context', () => {
    expect(mapChannelToContext('shadow')).toEqual({ type: 'agent-dm', agent: 'shadow' })
    expect(mapChannelToContext('forge')).toEqual({ type: 'agent-dm', agent: 'forge' })
    expect(mapChannelToContext('nexus')).toEqual({ type: 'agent-dm', agent: 'nexus' })
  })

  it('maps operational channels', () => {
    expect(mapChannelToContext('taskboard')).toEqual({ type: 'operational', feed: 'taskboard' })
    expect(mapChannelToContext('alerts')).toEqual({ type: 'operational', feed: 'alerts' })
    expect(mapChannelToContext('ops-feed')).toEqual({ type: 'operational', feed: 'ops-feed' })
  })

  it('maps project channels', () => {
    expect(mapChannelToContext('active-projects')).toEqual({ type: 'project', channel: 'active-projects' })
  })

  it('maps approvals', () => {
    expect(mapChannelToContext('approvals')).toEqual({ type: 'approvals' })
  })

  it('returns unknown for unrecognized channels', () => {
    expect(mapChannelToContext('random-channel')).toEqual({ type: 'unknown' })
  })
})
