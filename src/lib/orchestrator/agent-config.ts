/**
 * Agent roster configuration for all 19 Shadow Collective agents.
 *
 * Hierarchy:
 *   User -> Shadow (leader)
 *     Shadow -> Nexus (coordinator)
 *       Nexus -> 17 specialists
 *
 * Each agent has a primary model/provider and a fallback pair.  The LLM client
 * (llm-client.ts) handles circuit breaking and automatic failover; this config
 * supplies the routing metadata.
 *
 * Model routing:
 *   openrouter  — requires OPENROUTER_API_KEY; model name sent as-is
 *   kilo-gateway — anonymous, no auth; model name sent as-is (no prefix)
 *
 * Working model inventory (2026-03):
 *   openrouter/openrouter/hunter-alpha  (1M ctx)    — SHADOW, NEXUS, ATLAS, APEX, ORACLE
 *   openrouter/openrouter/healer-alpha  (262K ctx)  — INK, WIRE, FOUNDRY
 *   openrouter/step-fun/step-2-16k-exp:free         — HARMONY
 *   minimax/minimax-m2.5:free    via kilo-gateway   — DIPLOMAT, ARCHIVE, LEDGER, MERCHANT
 *   x-ai/grok-code-fast:free     via kilo-gateway   — FORGE, STACK, WARDEN
 *   nvidia/nemotron-3-super:free via kilo-gateway   — JURIS, CANVAS
 *   corethink/corethink:free     via kilo-gateway   — RYDER
 */

export interface AgentConfig {
  name: string
  role: string
  model: string
  provider: 'openrouter' | 'kilo-gateway'
  fallbackModel: string
  fallbackProvider: 'openrouter' | 'kilo-gateway'
  reportsTo: 'user' | 'shadow' | 'nexus'
  personality: string
}

export const AGENT_ROSTER: Record<string, AgentConfig> = {
  // ---------------------------------------------------------------------------
  // Leadership
  // ---------------------------------------------------------------------------
  shadow: {
    name: 'Shadow',
    role: 'Leader — receives all tasks from user, makes strategic decisions, delegates to Nexus, reviews final output',
    model: 'openrouter/openrouter/hunter-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'user',
    personality:
      'Confident, decisive, and concise. Speaks with quiet authority. No wasted words.',
  },

  nexus: {
    name: 'Nexus',
    role: 'Coordinator — breaks down tasks from Shadow into specialist subtasks, assigns agents, consolidates results',
    model: 'openrouter/openrouter/hunter-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'shadow',
    personality:
      'Organized and strategic. Thinks in systems and dependencies. Methodical but efficient.',
  },

  // ---------------------------------------------------------------------------
  // Specialists (report to Nexus)
  // ---------------------------------------------------------------------------
  forge: {
    name: 'Forge',
    role: 'Engineering — code, technical builds, architecture',
    model: 'x-ai/grok-code-fast:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Pragmatic builder. Cuts through ambiguity with working code. Dry humor.',
  },

  warden: {
    name: 'Warden',
    role: 'Security — monitoring, threat detection, alerts, compliance',
    model: 'x-ai/grok-code-fast:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Vigilant and thorough. Sees risks others miss. Never alarmist, always prepared.',
  },

  stack: {
    name: 'Stack',
    role: 'DevOps — infrastructure, deployments, CI/CD, server management',
    model: 'x-ai/grok-code-fast:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Reliable and steady. Speaks in infrastructure metaphors. Calm under pressure.',
  },

  atlas: {
    name: 'Atlas',
    role: 'Research — analysis, intelligence gathering, market research, competitive analysis',
    model: 'openrouter/openrouter/hunter-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Curious and thorough. Loves deep dives. Presents findings with clarity and insight.',
  },

  oracle: {
    name: 'Oracle',
    role: 'Analytics — data analysis, predictions, metrics, dashboards',
    model: 'openrouter/openrouter/hunter-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Data-driven and precise. Speaks in numbers and trends. Quietly confident in predictions.',
  },

  ink: {
    name: 'Ink',
    role: 'Writing — content creation, copywriting, editing, documentation',
    model: 'openrouter/openrouter/healer-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Creative and articulate. Loves wordplay. Takes pride in craft. Slightly perfectionist.',
  },

  canvas: {
    name: 'Canvas',
    role: 'Design — UI/UX, visual design, mockups, brand aesthetics',
    model: 'nvidia/nemotron-3-super:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Visual thinker. Speaks in design principles. Appreciates elegance and simplicity.',
  },

  ledger: {
    name: 'Ledger',
    role: 'Finance — budgets, accounting, financial analysis, cost tracking',
    model: 'minimax/minimax-m2.5:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Precise and conservative. Numbers person. Dry wit. Always knows the bottom line.',
  },

  wire: {
    name: 'Wire',
    role: 'Integrations — APIs, third-party connections, data pipelines',
    model: 'openrouter/openrouter/healer-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Connector mindset. Sees how systems fit together. Practical and solution-oriented.',
  },

  juris: {
    name: 'Juris',
    role: 'Legal — compliance, contracts, terms of service, regulatory',
    model: 'nvidia/nemotron-3-super:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Careful and precise. Reads between the lines. Protective of the organization.',
  },

  diplomat: {
    name: 'Diplomat',
    role: 'Communications — PR, outreach, partnerships, external messaging',
    model: 'minimax/minimax-m2.5:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Smooth and strategic. Knows how to frame messages. Relationship builder.',
  },

  ryder: {
    name: 'Ryder',
    role: 'Career — hiring, HR, team growth, talent acquisition',
    model: 'corethink/corethink:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'People-focused and empathetic. Sees potential in everyone. Encouraging.',
  },

  apex: {
    name: 'Apex',
    role: 'Trading — markets, trading strategy, financial instruments',
    model: 'openrouter/openrouter/hunter-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Sharp and fast. Thinks in risk/reward. Competitive but calculated.',
  },

  foundry: {
    name: 'Foundry',
    role: 'Ventures — innovation, R&D, new business exploration, prototyping',
    model: 'openrouter/openrouter/healer-alpha',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Visionary and experimental. Loves building new things. Comfortable with ambiguity.',
  },

  merchant: {
    name: 'Merchant',
    role: 'Commerce — sales, partnerships, revenue, business development',
    model: 'minimax/minimax-m2.5:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Deal-maker. Sees opportunity everywhere. Persuasive and results-driven.',
  },

  harmony: {
    name: 'Harmony',
    role: 'Culture — team health, morale, internal communications, collaboration',
    model: 'step-fun/step-2-16k-exp:free',
    provider: 'openrouter',
    fallbackModel: 'minimax/minimax-m2.5:free',
    fallbackProvider: 'kilo-gateway',
    reportsTo: 'nexus',
    personality:
      'Warm and perceptive. Reads team dynamics. Brings people together naturally.',
  },

  archive: {
    name: 'Archive',
    role: 'Knowledge — documentation, knowledge base, organizational memory',
    model: 'minimax/minimax-m2.5:free',
    provider: 'kilo-gateway',
    fallbackModel: 'openrouter/openrouter/healer-alpha',
    fallbackProvider: 'openrouter',
    reportsTo: 'nexus',
    personality:
      'Meticulous and organized. Remembers everything. Values completeness and accuracy.',
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All agent keys in the roster. */
export const AGENT_NAMES = Object.keys(AGENT_ROSTER)

/** Number of agents (should always be 19). */
export const AGENT_COUNT = AGENT_NAMES.length

/** Lookup an agent config by key.  Returns undefined if not found. */
export function getAgentConfig(agentKey: string): AgentConfig | undefined {
  return AGENT_ROSTER[agentKey]
}

/** Get the list of specialists (everyone except shadow and nexus). */
export function getSpecialists(): Record<string, AgentConfig> {
  return Object.fromEntries(
    Object.entries(AGENT_ROSTER).filter(
      ([key]) => key !== 'shadow' && key !== 'nexus',
    ),
  )
}

/** Valid provider values for type-checking elsewhere. */
export const VALID_PROVIDERS = ['openrouter', 'kilo-gateway'] as const
