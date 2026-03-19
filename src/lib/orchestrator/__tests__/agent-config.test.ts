import { describe, it, expect } from 'vitest'
import {
  AGENT_ROSTER,
  AGENT_NAMES,
  AGENT_COUNT,
  getAgentConfig,
  getSpecialists,
  VALID_PROVIDERS,
  type AgentConfig,
} from '../agent-config'
import { getAgentPrompt, getAgentChatPrompt } from '../agent-prompts'

// ---------------------------------------------------------------------------
// Expected roster
// ---------------------------------------------------------------------------

const EXPECTED_AGENTS = [
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
  'wire',
  'juris',
  'diplomat',
  'ryder',
  'apex',
  'foundry',
  'merchant',
  'harmony',
  'archive',
]

const SPECIALIST_KEYS = EXPECTED_AGENTS.filter(
  (k) => k !== 'shadow' && k !== 'nexus',
)

// ---------------------------------------------------------------------------
// Roster completeness
// ---------------------------------------------------------------------------

describe('AGENT_ROSTER', () => {
  it('contains exactly 19 agents', () => {
    expect(AGENT_COUNT).toBe(19)
    expect(AGENT_NAMES).toHaveLength(19)
  })

  it('contains every expected agent', () => {
    for (const key of EXPECTED_AGENTS) {
      expect(AGENT_ROSTER[key]).toBeDefined()
    }
  })

  it('does not contain unexpected agents', () => {
    for (const key of AGENT_NAMES) {
      expect(EXPECTED_AGENTS).toContain(key)
    }
  })
})

// ---------------------------------------------------------------------------
// Config field validation
// ---------------------------------------------------------------------------

describe('agent config fields', () => {
  it.each(EXPECTED_AGENTS)('%s has a non-empty name', (key) => {
    const config = AGENT_ROSTER[key]
    expect(config.name).toBeTruthy()
    expect(config.name.length).toBeGreaterThan(0)
  })

  it.each(EXPECTED_AGENTS)('%s has a non-empty role', (key) => {
    const config = AGENT_ROSTER[key]
    expect(config.role).toBeTruthy()
    expect(config.role.length).toBeGreaterThan(0)
  })

  it.each(EXPECTED_AGENTS)('%s has a non-empty personality', (key) => {
    const config = AGENT_ROSTER[key]
    expect(config.personality).toBeTruthy()
    expect(config.personality.length).toBeGreaterThan(0)
  })

  it.each(EXPECTED_AGENTS)('%s has a valid primary model string', (key) => {
    const config = AGENT_ROSTER[key]
    expect(config.model).toBeTruthy()
    // Model strings follow "provider/org/model-name" pattern
    expect(config.model.split('/').length).toBeGreaterThanOrEqual(2)
  })

  it.each(EXPECTED_AGENTS)('%s has a valid primary provider', (key) => {
    const config = AGENT_ROSTER[key]
    expect(VALID_PROVIDERS).toContain(config.provider)
  })

  it.each(EXPECTED_AGENTS)('%s has a valid fallback model string', (key) => {
    const config = AGENT_ROSTER[key]
    expect(config.fallbackModel).toBeTruthy()
    expect(config.fallbackModel.split('/').length).toBeGreaterThanOrEqual(2)
  })

  it.each(EXPECTED_AGENTS)('%s has a valid fallback provider', (key) => {
    const config = AGENT_ROSTER[key]
    expect(VALID_PROVIDERS).toContain(config.fallbackProvider)
  })

  it.each(EXPECTED_AGENTS)(
    '%s has different primary and fallback providers for redundancy',
    (key) => {
      const config = AGENT_ROSTER[key]
      expect(config.provider).not.toBe(config.fallbackProvider)
    },
  )
})

// ---------------------------------------------------------------------------
// Chain of command
// ---------------------------------------------------------------------------

describe('chain of command', () => {
  it('Shadow reports to user', () => {
    expect(AGENT_ROSTER.shadow.reportsTo).toBe('user')
  })

  it('Nexus reports to shadow', () => {
    expect(AGENT_ROSTER.nexus.reportsTo).toBe('shadow')
  })

  it.each(SPECIALIST_KEYS)('%s reports to nexus', (key) => {
    expect(AGENT_ROSTER[key].reportsTo).toBe('nexus')
  })

  it('only Shadow reports to user', () => {
    const userReports = AGENT_NAMES.filter(
      (k) => AGENT_ROSTER[k].reportsTo === 'user',
    )
    expect(userReports).toEqual(['shadow'])
  })

  it('only Nexus reports to shadow', () => {
    const shadowReports = AGENT_NAMES.filter(
      (k) => AGENT_ROSTER[k].reportsTo === 'shadow',
    )
    expect(shadowReports).toEqual(['nexus'])
  })
})

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('getAgentConfig', () => {
  it('returns config for valid agent', () => {
    const config = getAgentConfig('shadow')
    expect(config).toBeDefined()
    expect(config!.name).toBe('Shadow')
  })

  it('returns undefined for unknown agent', () => {
    expect(getAgentConfig('nonexistent')).toBeUndefined()
  })
})

describe('getSpecialists', () => {
  it('returns 17 specialists (excludes shadow and nexus)', () => {
    const specialists = getSpecialists()
    expect(Object.keys(specialists)).toHaveLength(17)
    expect(specialists).not.toHaveProperty('shadow')
    expect(specialists).not.toHaveProperty('nexus')
  })

  it('includes all expected specialist keys', () => {
    const specialists = getSpecialists()
    for (const key of SPECIALIST_KEYS) {
      expect(specialists[key]).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

describe('getAgentPrompt', () => {
  const minimalContext = { task: 'Write a project brief for the new product launch.' }

  it.each(EXPECTED_AGENTS)('%s returns a non-empty prompt', (key) => {
    const prompt = getAgentPrompt(key, minimalContext)
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(100)
  })

  it.each(EXPECTED_AGENTS)('%s prompt includes the agent name', (key) => {
    const config = AGENT_ROSTER[key]
    const prompt = getAgentPrompt(key, minimalContext)
    expect(prompt).toContain(config.name)
  })

  it.each(EXPECTED_AGENTS)('%s prompt includes the agent role', (key) => {
    const config = AGENT_ROSTER[key]
    const prompt = getAgentPrompt(key, minimalContext)
    expect(prompt).toContain(config.role)
  })

  it.each(EXPECTED_AGENTS)('%s prompt includes personality', (key) => {
    const config = AGENT_ROSTER[key]
    const prompt = getAgentPrompt(key, minimalContext)
    expect(prompt).toContain(config.personality)
  })

  it.each(EXPECTED_AGENTS)('%s prompt includes the task', (key) => {
    const prompt = getAgentPrompt(key, minimalContext)
    expect(prompt).toContain(minimalContext.task)
  })

  it('Shadow prompt references shadowResponseSchema', () => {
    const prompt = getAgentPrompt('shadow', minimalContext)
    expect(prompt).toContain('shadowResponseSchema')
  })

  it('Nexus prompt references nexusResponseSchema', () => {
    const prompt = getAgentPrompt('nexus', minimalContext)
    expect(prompt).toContain('nexusResponseSchema')
  })

  it('specialist prompt references specialistResponseSchema', () => {
    const prompt = getAgentPrompt('forge', minimalContext)
    expect(prompt).toContain('specialistResponseSchema')
  })

  it('Nexus prompt lists available specialists', () => {
    const prompt = getAgentPrompt('nexus', minimalContext)
    for (const key of SPECIALIST_KEYS) {
      expect(prompt).toContain(key)
    }
  })

  it('includes parent task when provided', () => {
    const prompt = getAgentPrompt('forge', {
      task: 'Build the API endpoint',
      parentTask: 'Create the new product launch system',
    })
    expect(prompt).toContain('Create the new product launch system')
  })

  it('includes subtasks when provided', () => {
    const prompt = getAgentPrompt('nexus', {
      task: 'Coordinate the product launch',
      subtasks: ['Research competitors', 'Draft copy', 'Build landing page'],
    })
    expect(prompt).toContain('Research competitors')
    expect(prompt).toContain('Draft copy')
    expect(prompt).toContain('Build landing page')
  })

  it('includes conversation history when provided', () => {
    const prompt = getAgentPrompt('shadow', {
      task: 'Review the final output',
      conversationHistory: [
        'Nexus: All subtasks complete. Consolidating now.',
        'Forge: API endpoint is live and tested.',
      ],
    })
    expect(prompt).toContain('Nexus: All subtasks complete.')
    expect(prompt).toContain('Forge: API endpoint is live and tested.')
  })

  it('throws for unknown agent', () => {
    expect(() => getAgentPrompt('ghost', minimalContext)).toThrow(
      'Unknown agent: "ghost"',
    )
  })
})

// ---------------------------------------------------------------------------
// Chat prompts (idle / Discord #general)
// ---------------------------------------------------------------------------

describe('getAgentChatPrompt', () => {
  it.each(EXPECTED_AGENTS)('%s returns a non-empty chat prompt', (key) => {
    const prompt = getAgentChatPrompt(key)
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(50)
  })

  it.each(EXPECTED_AGENTS)('%s chat prompt includes name and role', (key) => {
    const config = AGENT_ROSTER[key]
    const prompt = getAgentChatPrompt(key)
    expect(prompt).toContain(config.name)
    expect(prompt).toContain(config.role)
  })

  it('throws for unknown agent', () => {
    expect(() => getAgentChatPrompt('ghost')).toThrow(
      'Unknown agent: "ghost"',
    )
  })
})
