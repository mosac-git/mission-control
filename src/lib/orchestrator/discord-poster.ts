export interface DiscordWebhookConfig {
  channelName: string
  webhookUrl: string
}

/**
 * Generate a unique avatar URL for an agent using DiceBear initials API.
 * Free, no-auth, returns a unique PNG per seed string.
 */
function agentAvatarUrl(agentName: string): string {
  const encoded = encodeURIComponent(agentName)
  return `https://api.dicebear.com/7.x/initials/png?seed=${encoded}&backgroundColor=random&size=128`
}

export class DiscordPoster {
  private webhooks: Map<string, string>
  private fetchFn: typeof fetch
  private avatarOverrides: Map<string, string>

  constructor(
    configs: DiscordWebhookConfig[],
    fetchFn?: typeof fetch,
    avatarOverrides?: Record<string, string>,
  ) {
    this.webhooks = new Map(configs.map(c => [c.channelName, c.webhookUrl]))
    this.fetchFn = fetchFn || fetch
    this.avatarOverrides = new Map(Object.entries(avatarOverrides ?? {}))
  }

  /** Resolve avatar URL: explicit override > DiceBear generated */
  getAvatarUrl(agentName: string): string {
    return this.avatarOverrides.get(agentName) ?? agentAvatarUrl(agentName)
  }

  async postAsAgent(channel: string, agentName: string, content: string, threadId?: string) {
    const webhookUrl = this.webhooks.get(channel)
    if (!webhookUrl) throw new Error(`No webhook for channel: ${channel}`)

    const body: Record<string, unknown> = {
      content,
      username: agentName,
      avatar_url: this.getAvatarUrl(agentName),
    }
    if (threadId) body.thread_id = threadId

    await this.fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async postTaskUpdate(taskTitle: string, status: string, assignee?: string) {
    const emoji: Record<string, string> = {
      inbox: '📥', assigned: '📋', in_progress: '🔄',
      review: '👀', quality_review: '🔍', done: '✅',
    }
    const icon = emoji[status] || '📌'
    const msg = `${icon} **${taskTitle}**${assignee ? ` — ${assignee}` : ''} → ${status}`
    await this.postAsAgent('taskboard', 'Mission Control', msg)
  }

  async postOpsEvent(event: string, details: string) {
    await this.postAsAgent('ops-feed', 'Mission Control', `**${event}** — ${details}`)
  }

  async postAlert(title: string, details: string) {
    await this.postAsAgent('alerts', 'Warden', `🚨 **${title}** — ${details}`)
  }
}
