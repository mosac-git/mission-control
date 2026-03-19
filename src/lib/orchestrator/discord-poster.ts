export interface DiscordWebhookConfig {
  channelName: string
  webhookUrl: string
}

export class DiscordPoster {
  private webhooks: Map<string, string>
  private fetchFn: typeof fetch

  constructor(configs: DiscordWebhookConfig[], fetchFn?: typeof fetch) {
    this.webhooks = new Map(configs.map(c => [c.channelName, c.webhookUrl]))
    this.fetchFn = fetchFn || fetch
  }

  async postAsAgent(channel: string, agentName: string, content: string, threadId?: string) {
    const webhookUrl = this.webhooks.get(channel)
    if (!webhookUrl) throw new Error(`No webhook for channel: ${channel}`)

    const body: Record<string, unknown> = { content, username: agentName }
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
