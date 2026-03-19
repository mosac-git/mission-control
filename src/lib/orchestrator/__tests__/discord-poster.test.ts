import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscordPoster } from '../discord-poster'

describe('DiscordPoster', () => {
  let poster: DiscordPoster
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    poster = new DiscordPoster(
      [
        { channelName: 'general', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
        { channelName: 'taskboard', webhookUrl: 'https://discord.com/api/webhooks/456/def' },
        { channelName: 'ops-feed', webhookUrl: 'https://discord.com/api/webhooks/789/ghi' },
        { channelName: 'alerts', webhookUrl: 'https://discord.com/api/webhooks/012/jkl' },
      ],
      mockFetch,
    )
  })

  it('posts message to correct channel webhook', async () => {
    await poster.postAsAgent('general', 'Shadow', 'Task received.')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"username":"Shadow"'),
      }),
    )
  })

  it('includes thread_id when provided', async () => {
    await poster.postAsAgent('general', 'Nexus', 'Breaking down.', 'thread_123')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.thread_id).toBe('thread_123')
  })

  it('throws for unknown channel', async () => {
    await expect(poster.postAsAgent('nonexistent', 'Shadow', 'test')).rejects.toThrow('No webhook for channel')
  })

  it('formats task update with emoji', async () => {
    await poster.postTaskUpdate('Build landing page', 'done', 'Forge')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.content).toContain('Build landing page')
    expect(body.content).toMatch(/done/)
  })

  it('posts ops events to ops-feed', async () => {
    await poster.postOpsEvent('Agent Online', 'Shadow connected')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/789/ghi',
      expect.any(Object),
    )
  })

  it('posts alerts to alerts channel', async () => {
    await poster.postAlert('Security Warning', 'Unusual login detected')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/012/jkl',
      expect.any(Object),
    )
  })
})
