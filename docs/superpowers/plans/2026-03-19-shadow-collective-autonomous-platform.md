# Shadow Collective Autonomous Platform Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform MC v2.0.1 into a fully autonomous agentic organization with Discord bidirectional sync, orchestration engine, and all 19 agents operational.

**Architecture:** MC orchestrates the chain of command (User -> Shadow -> Nexus -> 17 Specialists) via LLM calls through Kilo Gateway + OpenRouter. Discord is the comms layer with full bidirectional sync. Each agent has a system prompt defining their persona. The task state machine uses a dual-column approach: existing `status` for UI compatibility, new `orchestration_state` for the chain-of-command engine.

**Tech Stack:** Next.js 16, React 19, TypeScript, SQLite (better-sqlite3), Zustand, Tailwind, Discord REST API (raw fetch), OpenRouter API, Kilo Gateway

**Spec:** `docs/superpowers/specs/2026-03-19-shadow-collective-autonomous-platform.md`

**Conventions (from CLAUDE.md):**
- pnpm only (no npm/yarn/npx)
- Conventional Commits (feat:, fix:, docs:, test:, refactor:, chore:)
- NO AI attribution in commits (no Co-Authored-By trailers)
- No icon libraries -- use raw text/emoji
- Tests must be under `src/` to match vitest include glob (`src/**/*.test.ts`)

---

## File Structure

### New Files
```
src/lib/orchestrator/
  engine.ts              - Main orchestration engine (task intake, state machine, agent dispatch)
  agent-prompts.ts       - System prompts for all 19 agents
  llm-client.ts          - LLM call wrapper with retry, fallback, circuit breaker
  schemas.ts             - Zod schemas for agent structured output (Shadow, Nexus, Specialist)
  task-tree.ts           - Parent-child task tree operations
  discord-sync.ts        - MC to Discord bidirectional sync logic
  discord-poster.ts      - Post messages to Discord channels via webhooks
  agent-config.ts        - Agent roster configuration (models, roles, personalities)

src/app/api/discord/
  ingest/route.ts        - Discord to MC ingest endpoint

src/app/api/orchestrator/
  route.ts               - Orchestrator control API (start task, check status, cancel)

scripts/
  discord-restructure.ts - Discord channel restructure automation

src/lib/orchestrator/__tests__/
  engine.test.ts         - Orchestration engine tests
  llm-client.test.ts     - LLM client retry/fallback tests
  schemas.test.ts        - Agent output schema validation tests
  task-tree.test.ts      - Task tree operations tests
  discord-sync.test.ts   - Discord sync dedup/routing tests
  agent-config.test.ts   - Agent roster validation tests
  discord-poster.test.ts - Discord poster tests
  approval.test.ts       - Approval flow tests
```

### Modified Files
```
src/lib/schema.sql                          - Add parent_task_id, orchestration_state, discord_message_id
src/lib/migrations.ts                       - Add migrations 042-044
src/lib/event-bus.ts                        - Add orchestration event types
src/lib/webhooks.ts                         - Add orchestration webhook events
src/lib/task-status.ts                      - Extend with orchestration state transitions
src/store/index.ts                          - Add orchestration state to Task type
src/components/layout/nav-rail.tsx          - Remove xint/builderz promo links
src/app/api/integrations/route.ts           - Remove xint references
src/app/layout.tsx                          - Update logo references
src/app/login/page.tsx                      - Update logo
src/app/setup/page.tsx                      - Update logo
src/components/ui/loader.tsx                - Update logo paths
public/brand/                               - Replace logo PNGs
src/app/icon.png                            - Replace favicon
src/app/apple-icon.png                      - Replace apple icon
package.json                                - Update author, repository
SECURITY.md                                 - Update contact email
src/app/api/chat/messages/route.ts          - Wire to orchestrator
```

---

## Phase 1: MC Cleanup & Foundation

### Task 1: Remove xint CLI and builderz.dev Promo Links from Sidebar

**Files:**
- Modify: `src/components/layout/nav-rail.tsx:415-443`

- [ ] **Step 1: Read the current promo section**

Read `src/components/layout/nav-rail.tsx` lines 410-450 to see the exact promo banner code.

- [ ] **Step 2: Remove the promo banners**

In `src/components/layout/nav-rail.tsx`, delete the xint CLI link block (lines ~418-429) and the builderz.dev link block (lines ~430-441). These are inside an `{sidebarExpanded && ...}` conditional near the bottom of the nav rail.

- [ ] **Step 3: Verify the nav rail renders without errors**

Run: `cd /Users/sachin/Projects/mission-control && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/nav-rail.tsx
git commit -m "fix: remove xint CLI and builderz.dev promo links from sidebar"
```

---

### Task 2: Remove xint Integration References

**Files:**
- Modify: `src/app/api/integrations/route.ts:56-63`

- [ ] **Step 1: Read the integrations file**

Read `src/app/api/integrations/route.ts` lines 43-90 to find xint references.

- [ ] **Step 2: Remove xint recommendation entries**

Remove the xint CLI recommendation lines (lines ~56-63) that reference `https://github.com/0xNyk/xint` and `https://github.com/0xNyk/xint-rs`. Keep the X/Twitter integration entry itself, just remove the xint-specific tool recommendation.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/integrations/route.ts
git commit -m "fix: remove xint CLI references from integrations"
```

---

### Task 3: Update Package Metadata and Security Contact

**Files:**
- Modify: `package.json:80,82-84`
- Modify: `SECURITY.md:7`

- [ ] **Step 1: Update package.json author and repository**

In `package.json`:
- Line 80: Change `"author": "Builderz Labs"` to `"author": "Shadow Collective"`
- Lines 82-84: Change repository URL from `https://github.com/builderz-labs/mission-control.git` to `https://github.com/mosac-git/mission-control.git`

- [ ] **Step 2: Update SECURITY.md contact**

In `SECURITY.md` line 7: Change `security@builderz.dev` to the Shadow Collective contact (or remove the email and direct to GitHub issues).

- [ ] **Step 3: Commit**

```bash
git add package.json SECURITY.md
git commit -m "chore: update package metadata and security contact to Shadow Collective"
```

---

### Task 4: Replace Logo and Branding Assets

**Files:**
- Replace: `public/brand/mc-logo-512.png`, `mc-logo-256.png`, `mc-logo-128.png`, `public/mc-logo.png`
- Replace: `src/app/icon.png`, `src/app/apple-icon.png`
- Modify: `src/app/layout.tsx:61,69,75`
- Modify: `src/app/login/page.tsx:203-205`
- Modify: `src/app/setup/page.tsx:189-191`
- Modify: `src/components/ui/loader.tsx:24-53`

- [ ] **Step 1: Generate Shadow Collective logo**

Generate a Shadow Collective logo in 512x512, 256x256, 128x128, and 32x32 sizes. Dark theme, minimal, fits the existing dark UI. Save to:
- `public/brand/sc-logo-512.png`
- `public/brand/sc-logo-256.png`
- `public/brand/sc-logo-128.png`
- `public/brand/sc-logo.png` (128px default)
- `src/app/icon.png` (32x32 favicon)
- `src/app/apple-icon.png` (180x180)

- [ ] **Step 2: Update layout.tsx metadata logo references**

In `src/app/layout.tsx`:
- Line 61: Change `/brand/mc-logo-128.png` to `/brand/sc-logo-128.png`
- Line 69: Change `/brand/mc-logo-512.png` to `/brand/sc-logo-512.png`
- Line 75: Change `/brand/mc-logo-512.png` to `/brand/sc-logo-512.png`

- [ ] **Step 3: Update login and setup page logos**

In `src/app/login/page.tsx` line ~203: Update logo src to `/brand/sc-logo-256.png`
In `src/app/setup/page.tsx` line ~189: Update logo src to `/brand/sc-logo-256.png`

- [ ] **Step 4: Update loader component logo paths**

In `src/components/ui/loader.tsx` lines 24-53: Replace `mc-logo` references with `sc-logo` in the logo paths array and PRELOADED_IMAGES.

- [ ] **Step 5: Remove old MC logo files**

Delete: `public/brand/mc-logo-512.png`, `mc-logo-256.png`, `mc-logo-128.png`, `public/mc-logo.png`

- [ ] **Step 6: Build and verify**

Run: `pnpm build`
Expected: Build succeeds with no missing asset errors.

- [ ] **Step 7: Commit**

```bash
git add public/brand/ src/app/icon.png src/app/apple-icon.png src/app/layout.tsx src/app/login/page.tsx src/app/setup/page.tsx src/components/ui/loader.tsx
git commit -m "feat: replace MC logos with Shadow Collective branding"
```

---

### Task 5: Security Hardening

- [ ] **Step 1: Run audit**

Run: `cd /Users/sachin/Projects/mission-control && pnpm audit`
Review output for fixable vulnerabilities.

- [ ] **Step 2: Fix auto-fixable issues**

Run: `pnpm update` for affected packages, or manually bump versions in package.json. Note: `pnpm audit` does not support `--fix` flag like npm.

- [ ] **Step 3: Verify build after fixes**

Run: `pnpm build && pnpm test`
Expected: Build and tests pass.

- [ ] **Step 4: Commit**

```bash
git add pnpm-lock.yaml package.json
git commit -m "fix: resolve security vulnerabilities from audit"
```

---

### Task 6: Set main as Default Branch on GitHub

- [ ] **Step 1: Set default branch**

Run: `gh repo edit mosac-git/mission-control --default-branch main`
Expected: Default branch updated to main.

- [ ] **Step 2: Verify**

Run: `gh repo view mosac-git/mission-control --json defaultBranchRef`
Expected: Shows `main`.

---

### Task 7: Schema Migrations for Orchestration Foundation

**Files:**
- Modify: `src/lib/migrations.ts` (add after migration 041)
- Modify: `src/lib/schema.sql` (update reference schema)

- [ ] **Step 1: Write test for new schema columns**

Create: `src/lib/orchestrator/__tests__/task-tree.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

describe('task tree schema', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'inbox',
        assigned_to TEXT,
        parent_task_id INTEGER REFERENCES tasks(id),
        orchestration_state TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX idx_tasks_orch_state ON tasks(orchestration_state);
    `)
  })

  it('supports parent-child task relationships', () => {
    db.prepare('INSERT INTO tasks (title, status) VALUES (?, ?)').run('Parent task', 'inbox')
    const parent = db.prepare('SELECT id FROM tasks WHERE title = ?').get('Parent task') as any
    db.prepare('INSERT INTO tasks (title, status, parent_task_id) VALUES (?, ?, ?)').run('Subtask', 'inbox', parent.id)
    const subtask = db.prepare('SELECT * FROM tasks WHERE parent_task_id = ?').get(parent.id) as any
    expect(subtask.title).toBe('Subtask')
    expect(subtask.parent_task_id).toBe(parent.id)
  })

  it('supports orchestration_state column', () => {
    db.prepare('INSERT INTO tasks (title, orchestration_state) VALUES (?, ?)').run('Test', 'SHADOW_ANALYZING')
    const task = db.prepare('SELECT orchestration_state FROM tasks WHERE title = ?').get('Test') as any
    expect(task.orchestration_state).toBe('SHADOW_ANALYZING')
  })

  it('retrieves full task tree', () => {
    db.prepare('INSERT INTO tasks (title) VALUES (?)').run('Root')
    const root = db.prepare('SELECT id FROM tasks WHERE title = ?').get('Root') as any
    db.prepare('INSERT INTO tasks (title, parent_task_id) VALUES (?, ?)').run('Child 1', root.id)
    db.prepare('INSERT INTO tasks (title, parent_task_id) VALUES (?, ?)').run('Child 2', root.id)
    const children = db.prepare('SELECT * FROM tasks WHERE parent_task_id = ?').all(root.id) as any[]
    expect(children).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it passes (schema is in-memory)**

Run: `pnpm test src/lib/orchestrator/__tests__/task-tree.test.ts`
Expected: PASS

- [ ] **Step 3: Add migration 042 - task tree and orchestration state**

In `src/lib/migrations.ts`, add after the last migration (041):

```typescript
{
  id: '042_task_orchestration',
  up(db) {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id);
      ALTER TABLE tasks ADD COLUMN orchestration_state TEXT;
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_orch_state ON tasks(orchestration_state)`);
  },
},
```

- [ ] **Step 4: Add migration 043 - discord message dedup on messages table**

The `messages` table (created in migration 004) stores chat messages. Add `discord_message_id` there for chat dedup. Also add to `activities` for activity dedup.

```typescript
{
  id: '043_discord_message_id',
  up(db) {
    db.exec(`ALTER TABLE messages ADD COLUMN discord_message_id TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_discord_msg ON messages(discord_message_id) WHERE discord_message_id IS NOT NULL`);
    db.exec(`ALTER TABLE activities ADD COLUMN discord_message_id TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_discord_msg ON activities(discord_message_id) WHERE discord_message_id IS NOT NULL`);
  },
},
```

- [ ] **Step 5: Update schema.sql reference to include new columns**

In `src/lib/schema.sql`, add to the tasks table definition (after existing columns):
```sql
  parent_task_id INTEGER REFERENCES tasks(id),
  orchestration_state TEXT,
```

Add to messages table:
```sql
  discord_message_id TEXT,
```

Add to activities table:
```sql
  discord_message_id TEXT,
```

- [ ] **Step 6: Build to verify migrations compile**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/migrations.ts src/lib/schema.sql src/lib/orchestrator/__tests__/
git commit -m "feat: add task tree and orchestration state schema migrations"
```

---

## Phase 2: Discord Channel Restructure + Sync

### Task 8: Discord Channel Restructure

This task is executed via Discord API. The script automates the restructure.

- [ ] **Step 1: Create channel restructure script**

Create `scripts/discord-restructure.ts` that uses Discord REST API to:
1. Create an ARCHIVED category and move retired channels there (preserve history)
2. Create/verify COMMAND, OPERATIONS, PROJECTS, AGENTS categories
3. Move existing channels to correct categories
4. Create new channels (taskboard, 19 agent channels, etc.)
5. Rename channels (activity-log to activity, forge-ops to forge, etc.)

Channels to archive: atlas-research, oracle-analytics, ink-content, canvas-creative, ledger-finance, apex-trading, merchant-commerce, foundry-ventures, juris-legal, diplomat-comms, wire-integrations, ryder-career, nexus-briefing.

Categories to archive: INTELLIGENCE, CONTENT, BUSINESS, EXTERNAL, COMMUNITY.

The script reads DISCORD_BOT_TOKEN and DISCORD_GUILD_ID from env vars and uses fetch() against the Discord REST API (https://discord.com/api/v10).

- [ ] **Step 2: Commit the script**

```bash
git add scripts/discord-restructure.ts
git commit -m "feat: add Discord channel restructure script"
```

- [ ] **Step 3: Run the restructure (requires user credentials)**

Run: `DISCORD_BOT_TOKEN=<token> DISCORD_GUILD_ID=<id> pnpm dlx tsx scripts/discord-restructure.ts`

---

### Task 9: Discord to MC Ingest Endpoint

**Files:**
- Create: `src/lib/orchestrator/discord-sync.ts`
- Create: `src/app/api/discord/ingest/route.ts`
- Create: `src/lib/orchestrator/__tests__/discord-sync.test.ts`

- [ ] **Step 1: Write test for discord sync utilities**

Create `src/lib/orchestrator/__tests__/discord-sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isEchoMessage, mapChannelToContext } from '@/lib/orchestrator/discord-sync'

describe('discord sync', () => {
  it('detects echo messages by discord_message_id', () => {
    const knownIds = new Set(['msg_123', 'msg_456'])
    expect(isEchoMessage('msg_123', knownIds)).toBe(true)
    expect(isEchoMessage('msg_789', knownIds)).toBe(false)
  })

  it('maps channel names to MC contexts', () => {
    expect(mapChannelToContext('general')).toEqual({ type: 'chat', panel: 'chat' })
    expect(mapChannelToContext('shadow')).toEqual({ type: 'agent-dm', agent: 'shadow' })
    expect(mapChannelToContext('taskboard')).toEqual({ type: 'operational', feed: 'taskboard' })
    expect(mapChannelToContext('unknown-channel')).toEqual({ type: 'unknown' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/orchestrator/__tests__/discord-sync.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create discord-sync.ts**

Create `src/lib/orchestrator/discord-sync.ts` with:
- `isEchoMessage(discordMessageId, knownIds)` - dedup check
- `mapChannelToContext(channelName)` - routes channel to MC context
- `DiscordIngestPayload` type definition
- Constants for AGENT_NAMES, OPERATIONAL_CHANNELS, PROJECT_CHANNELS

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/orchestrator/__tests__/discord-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Create the ingest API route**

Create `src/app/api/discord/ingest/route.ts` with POST handler that:
1. Verifies API key from Authorization header
2. Checks dedup via discord_message_id in activities table
3. Routes based on channel context (chat, agent-dm, approvals, etc.)
4. Broadcasts events via eventBus
5. Logs activity with discord_message_id
6. Returns status response

- [ ] **Step 6: Commit**

```bash
git add src/lib/orchestrator/discord-sync.ts src/app/api/discord/ingest/route.ts src/lib/orchestrator/__tests__/discord-sync.test.ts
git commit -m "feat: add Discord ingest endpoint with dedup and channel routing"
```

---

### Task 10: MC to Discord Webhook Sync

**Files:**
- Modify: `src/lib/event-bus.ts:8-34` (add orchestration events)
- Modify: `src/lib/webhooks.ts:37-46` (add to EVENT_MAP)

- [ ] **Step 1: Add orchestration event types to event bus**

In `src/lib/event-bus.ts`, extend the EventType union to include:
- orchestration.task_received
- orchestration.shadow_analyzing
- orchestration.delegated
- orchestration.subtasks_assigned
- orchestration.agent_working
- orchestration.subtask_complete
- orchestration.consolidating
- orchestration.reviewing
- orchestration.complete
- orchestration.failed
- discord.message
- approval.response

- [ ] **Step 2: Add orchestration events to webhook EVENT_MAP**

In `src/lib/webhooks.ts`, extend the EVENT_MAP (lines ~37-46) to map the new orchestration events to webhook event types.

- [ ] **Step 3: Write test for new event type mappings**

Create `src/lib/orchestrator/__tests__/webhook-events.test.ts` that verifies all orchestration events are present in the EVENT_MAP and map to valid webhook event types.

- [ ] **Step 4: Run test**

Run: `pnpm test src/lib/orchestrator/__tests__/webhook-events.test.ts`
Expected: PASS

- [ ] **Step 5: Update task-status.ts with orchestration state transitions**

In `src/lib/task-status.ts`, add orchestration state awareness:
- When `orchestration_state` changes, the corresponding `status` field is updated to stay in sync
- `SHADOW_ANALYZING` -> status `assigned`
- `AGENTS_WORKING` -> status `in_progress`
- `NEXUS_CONSOLIDATING` -> status `review`
- `SHADOW_REVIEWING` -> status `quality_review`
- `COMPLETE` -> status `done`

- [ ] **Step 6: Update Zustand store Task type**

In `src/store/index.ts`, add `orchestration_state?: string` and `parent_task_id?: number` to the Task type definition (~line 99).

- [ ] **Step 7: Build to verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/event-bus.ts src/lib/webhooks.ts src/lib/task-status.ts src/store/index.ts src/lib/orchestrator/__tests__/webhook-events.test.ts
git commit -m "feat: add orchestration events, status sync, and store types"
```

---

## Phase 3: Shadow Orchestration Engine

### Task 11: LLM Client with Retry, Fallback, and Circuit Breaker

**Files:**
- Create: `src/lib/orchestrator/llm-client.ts`
- Create: `src/lib/orchestrator/__tests__/llm-client.test.ts`

- [ ] **Step 1: Write tests for circuit breaker and LLM client**

Create `src/lib/orchestrator/__tests__/llm-client.test.ts` testing:
- CircuitBreaker: starts closed, opens after threshold failures, resets on success
- LLMClient: returns parsed response on success, retries on failure with backoff, uses fallback model when primary fails

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/orchestrator/__tests__/llm-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement LLM client**

Create `src/lib/orchestrator/llm-client.ts` with:
- `CircuitBreaker` class (threshold, resetMs, isOpen, recordFailure, recordSuccess)
- `LLMClient` class with:
  - `call(opts)` - tries primary model, falls back to alternatives
  - `callWithRetry(opts)` - exponential backoff with jitter (5s, 15s, 45s)
  - 429 handling with Retry-After header respect
  - Provider-wide pause: after 3 consecutive 429s from same provider, pause ALL calls to that provider for 60s
  - Gateway-down fallback: if Kilo Gateway unreachable, fall back to direct OpenRouter. If both down, queue tasks with BLOCKED state
  - 2-minute timeout per LLM call via AbortSignal.timeout
  - Provider URL mapping (openrouter, kilo-gateway)
  - Model fallback chain: primary -> minimax-m2.5:free -> qwen3-coder:free

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/orchestrator/__tests__/llm-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/llm-client.ts src/lib/orchestrator/__tests__/llm-client.test.ts
git commit -m "feat: add LLM client with retry, fallback, and circuit breaker"
```

---

### Task 12: Agent Output Schemas (Zod Validation)

**Files:**
- Create: `src/lib/orchestrator/schemas.ts`
- Create: `src/lib/orchestrator/__tests__/schemas.test.ts`

- [ ] **Step 1: Write schema validation tests**

Create `src/lib/orchestrator/__tests__/schemas.test.ts` testing:
- Valid Shadow response (delegate action) parses successfully
- Invalid Shadow action rejected
- Valid Nexus response with assignments array parses
- Valid Specialist response parses
- Missing required fields rejected

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/orchestrator/__tests__/schemas.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement schemas**

Create `src/lib/orchestrator/schemas.ts` with Zod schemas:
- `shadowResponseSchema` - message, action (delegate/complete/reject/request_info/request_approval), delegate_to, task_summary, priority, notes
- `nexusResponseSchema` - message, action (assign/consolidate/escalate/request_info), assignments array with depends_on, execution_order (parallel/sequential/mixed)
- `specialistResponseSchema` - message, status (complete/partial/failed/need_help), result, artifacts, notes

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/orchestrator/__tests__/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/schemas.ts src/lib/orchestrator/__tests__/schemas.test.ts
git commit -m "feat: add Zod schemas for agent structured output validation"
```

---

### Task 13: Agent System Prompts and Configuration

**Files:**
- Create: `src/lib/orchestrator/agent-prompts.ts`
- Create: `src/lib/orchestrator/agent-config.ts`

- [ ] **Step 1: Create agent configuration registry**

Create `src/lib/orchestrator/agent-config.ts` with `AgentConfig` interface and `AGENT_ROSTER` record containing all 19 agents with: name, role, model, provider, fallbackModel, fallbackProvider, reportsTo, personality.

Models per spec:
- shadow/oracle: openrouter/hunter-alpha
- nexus/atlas/diplomat/apex/merchant/archive/ledger/juris/canvas: kilo-gateway/minimax-m2.5:free
- forge/stack/warden: openrouter/qwen3-coder:free
- ink/wire/foundry: openrouter/healer-alpha
- ryder/harmony: openrouter/glm-4.5-air:free

- [ ] **Step 2: Create agent prompts**

Create `src/lib/orchestrator/agent-prompts.ts` with `getAgentPrompt(agentName, taskContext)` function. Each agent gets a system prompt defining:
- Name, role, personality
- Chain of command (who they report to, who reports to them)
- Output format (JSON schema they must follow - reference the Zod schemas)
- Domain expertise
- Instructions to be natural, show personality, use banter in #general messages

Key prompts:
- Shadow: leader, receives all tasks, delegates to Nexus, reviews final output
- Nexus: coordinator, breaks down tasks, assigns specialists, consolidates
- Each specialist: domain expert, reports to Nexus, executes assigned subtasks

- [ ] **Step 3: Write agent config validation tests**

Create `src/lib/orchestrator/__tests__/agent-config.test.ts` testing:
- All 19 agents present in AGENT_ROSTER
- Each agent has valid model and provider
- Each agent has a non-empty personality and role
- Shadow reports to 'user', all others report to 'shadow' or 'nexus'
- `getAgentPrompt` returns non-empty string for each agent

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/orchestrator/__tests__/agent-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/agent-config.ts src/lib/orchestrator/agent-prompts.ts src/lib/orchestrator/__tests__/agent-config.test.ts
git commit -m "feat: add agent roster config and system prompts for all 19 agents"
```

---

### Task 14: Orchestration Engine Core

**Files:**
- Create: `src/lib/orchestrator/engine.ts`
- Create: `src/lib/orchestrator/task-tree.ts`
- Create: `src/lib/orchestrator/__tests__/engine.test.ts`

- [ ] **Step 1: Write task tree operations**

Add to `src/lib/orchestrator/__tests__/task-tree.test.ts` (extend from Task 7):
- `getSubtasks(tasks, parentId)` returns child tasks
- `getParentChain(tasks, taskId)` returns ancestors
- `buildTaskTree(tasks)` returns nested tree structure

- [ ] **Step 2: Implement task-tree.ts**

Create `src/lib/orchestrator/task-tree.ts` with the three functions.

- [ ] **Step 3: Write orchestration engine tests**

Create `src/lib/orchestrator/__tests__/engine.test.ts` testing:
- Task intake creates task and assigns to Shadow
- Shadow response with delegate action creates Nexus subtask
- State transitions fire correct events
- Error states handled (FAILED, TIMED_OUT, CANCELLED)

Use mocked LLM client and DB.

- [ ] **Step 4: Implement the orchestration engine**

Create `src/lib/orchestrator/engine.ts` with `OrchestrationEngine` class:
- `handleUserMessage(message, source)` - entry point
- `processTask(taskId)` - main state machine
- `callAgent(agentName, context)` - LLM call with prompt
- `handleShadowResponse(taskId, response)` - delegation
- `handleNexusResponse(taskId, response)` - subtask creation
- `handleSpecialistResponse(subtaskId, response)` - result recording
- `consolidateResults(parentTaskId)` - Nexus consolidation
- `finalReview(taskId)` - Shadow review
- `reportToUser(taskId, result)` - deliver output

Each method updates orchestration_state, fires events, posts to Discord and MC Chat.

Concurrency: max 3 concurrent LLM calls, 2s gap per provider, queue system.

- [ ] **Step 5: Run all orchestrator tests**

Run: `pnpm test src/lib/orchestrator/__tests__/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/orchestrator/engine.ts src/lib/orchestrator/task-tree.ts src/lib/orchestrator/__tests__/
git commit -m "feat: add orchestration engine with task tree and state machine"
```

---

### Task 15: Wire Orchestrator to MC Chat and API

**Files:**
- Create: `src/app/api/orchestrator/route.ts`
- Modify: `src/app/api/chat/messages/route.ts`

- [ ] **Step 1: Create orchestrator API route**

Create `src/app/api/orchestrator/route.ts`:
- POST: submit task to orchestrator (calls engine.handleUserMessage)
- GET: check orchestration status for a task (returns state, subtasks, progress)
- DELETE: cancel an orchestration (sets state to CANCELLED)

- [ ] **Step 2: Wire MC Chat to orchestrator**

Modify `src/app/api/chat/messages/route.ts` to detect task-like messages from the user in main chat and route them through the orchestration engine. Agent responses from the engine post back as chat messages.

- [ ] **Step 3: Build and verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/orchestrator/route.ts src/app/api/chat/messages/route.ts
git commit -m "feat: wire orchestrator to MC Chat and API routes"
```

---

## Phase 4: Full Chain (All 19 Agents)

### Task 16: MC to Discord Poster

**Files:**
- Create: `src/lib/orchestrator/discord-poster.ts`

- [ ] **Step 1: Create Discord poster module**

Create `src/lib/orchestrator/discord-poster.ts` with `DiscordPoster` class:
- Maintains channel name to Discord webhook URL mapping
- `postAsAgent(channel, agentName, content, threadId?)` - posts via webhook as agent identity
- `createThread(channel, name)` - creates Discord thread via API
- `postTaskUpdate(taskTitle, status, assignee?)` - formatted task update to #taskboard
- `postOpsEvent(event, details)` - operational event to #ops-feed

Webhook URLs stored as env vars or MC settings (one per channel).

- [ ] **Step 2: Write Discord poster tests**

Create `src/lib/orchestrator/__tests__/discord-poster.test.ts` with mocked fetch testing:
- Correct webhook URL selected per channel name
- Agent name set as webhook username
- Thread ID passed when provided
- Task update formatting (emoji + title + status)
- Error handling when webhook URL missing

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/orchestrator/__tests__/discord-poster.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/orchestrator/discord-poster.ts src/lib/orchestrator/__tests__/discord-poster.test.ts
git commit -m "feat: add Discord poster for MC to Discord webhook sync"
```

---

### Task 17: Wire Full Orchestration Chain

**Files:**
- Modify: `src/lib/orchestrator/engine.ts`

- [ ] **Step 1: Integrate all components in engine**

Update engine.ts to wire:
1. LLM client for agent calls
2. Agent configs for model selection
3. Agent prompts for system prompts
4. Schemas for Zod validation
5. Discord poster for channel messages
6. Event bus for MC webhooks
7. Task tree for parent-child management
8. Concurrency queue (max 3, 2s provider gap, depends_on chains)

- [ ] **Step 2: Add execution queue**

Implement queue respecting Nexus execution_order (parallel/sequential/mixed) and depends_on chains.

- [ ] **Step 3: Integration test with mock LLM**

Test full chain: user message -> Shadow -> Nexus -> Atlas + Ink -> Nexus consolidate -> Shadow review -> deliver. Verify all state transitions, events, Discord posts.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test src/lib/orchestrator/__tests__/`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/
git commit -m "feat: wire full orchestration chain with concurrency and dependency handling"
```

---

### Task 18: Approval Flow

**Files:**
- Create: `src/lib/orchestrator/approval.ts`
- Create: `src/lib/orchestrator/__tests__/approval.test.ts`
- Modify: `src/lib/orchestrator/engine.ts`

- [ ] **Step 1: Write approval flow tests**

Create `src/lib/orchestrator/__tests__/approval.test.ts` testing:
- Agent request_approval action triggers BLOCKED state
- Approval message posted to #approvals channel
- Inline "Waiting for approval..." posted in #general thread
- Approval response (from Discord reaction or MC panel) unblocks task
- Denial response cancels the subtask
- Timeout after no response keeps task BLOCKED

- [ ] **Step 2: Implement approval module**

Create `src/lib/orchestrator/approval.ts`:
- `requestApproval(taskId, agentName, reason)` - sets task to BLOCKED, posts to #approvals and #general
- `handleApprovalResponse(taskId, approved, source)` - unblocks or cancels based on response
- Integration with existing `exec-approval` API for MC panel approvals
- Discord reaction capture via ingest endpoint (checkmark = approve, X = deny)

- [ ] **Step 3: Wire into orchestration engine**

Update `engine.ts` to check for `request_approval` action in Shadow/Nexus/Specialist responses and route through the approval module.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/orchestrator/__tests__/approval.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrator/approval.ts src/lib/orchestrator/__tests__/approval.test.ts src/lib/orchestrator/engine.ts
git commit -m "feat: add approval flow with Discord reactions and MC panel support"
```

---

## Phase 5: End-to-End Validation

### Task 19: Deploy and Configure (requires VPS access)

- [ ] **Step 1: Build production image on VPS**

```bash
cd /opt/mission-control-v2 && git pull origin main
docker build -t mission-control:v2.1.0 .
```

- [ ] **Step 2: Set environment variables**

Add to container env: OPENROUTER_API_KEY, KILO_GATEWAY_URL, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, and Discord webhook URLs for each channel.

- [ ] **Step 3: Restart container with new image**

Stop old container, start new one with updated env and image tag.

- [ ] **Step 4: Configure Discord webhook URLs in MC**

Set webhook URLs for: general, taskboard, ops-feed, alerts, active-projects, and all 19 agent channels.

- [ ] **Step 5: Run Discord restructure script if not done**

Execute Task 8 Step 3.

---

### Task 20: First Task End-to-End

- [ ] **Step 1: Send first task**

Via MC Chat or Discord #general: "Write a project brief for Shadow Collective"

- [ ] **Step 2: Verify chain executes**

Check: Shadow acknowledges -> Nexus breaks down -> specialists execute -> results consolidate -> Shadow delivers. All visible in #general thread, MC Chat, #taskboard, #ops-feed.

- [ ] **Step 3: Verify Nexus project update**

Nexus posts structured summary to #active-projects.

---

### Task 21: Second Task End-to-End

- [ ] **Step 1: Send second task**

Choose task exercising different specialists (e.g., "Review our infrastructure security").

- [ ] **Step 2: Verify different agents activate**

Warden, Stack, Atlas should be involved. Warden findings go to #alerts.

---

### Task 22: Final Verification Checklist

- [ ] MC fully branded as Shadow Collective (no MC/builderz references)
- [ ] Discord restructured to 4 categories, all channels operational
- [ ] Message in Discord #general appears in MC Chat (and vice versa)
- [ ] Task created in MC shows in Discord #taskboard
- [ ] Agent status changes appear in Discord #ops-feed
- [ ] Full delegation chain works: User -> Shadow -> Nexus -> Specialists -> back
- [ ] All 19 agents respond with personality
- [ ] Two tasks completed end-to-end
- [ ] Nexus maintains project records in #projects
- [ ] Warden posts alerts to #alerts
