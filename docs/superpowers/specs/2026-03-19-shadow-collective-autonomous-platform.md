# Shadow Collective Autonomous Platform

**Date:** 2026-03-19
**Status:** Approved
**Author:** Sachin (Mosac) + Claude

## Overview

Transform Mission Control v2.0.1 (builderz fork) into a fully autonomous agentic organization platform for Shadow Collective. MC becomes the orchestration engine that manages task delegation through the chain of command (User -> Shadow -> Nexus -> Specialists), while Discord serves as the real-time communications layer with full bidirectional sync.

## Goals

1. Full MC cleanup and branding (logo, xint removal, security hardening, GitHub config)
2. Discord channel restructure (8 categories -> 4, consolidated AGENTS category)
3. Bidirectional MC <-> Discord sync (Chat, tasks, activity, alerts)
4. Agent orchestration engine (task -> Shadow -> Nexus -> Specialists -> back up)
5. All 19 agents wired and functional from day one
6. Two completed tasks end-to-end as proof of life

## Architecture

### System Components

```
+-------------------+       +-------------------+       +-------------------+
|   Discord         |<----->|   Mission Control  |<----->|   LLM Layer       |
|   (Comms Layer)   |       |   (Orchestrator)   |       |   (Agent Brains)  |
|                   |       |                    |       |                   |
|   #general        |       |   Task Engine      |       |   Kilo Gateway    |
|   #taskboard      |       |   State Machine    |       |   OpenRouter      |
|   #ops-feed       |       |   Activity Feed    |       |   Free Models     |
|   #alerts         |       |   Chat (bi-sync)   |       |                   |
|   #agents (19)    |       |   Webhook System   |       |   19 Agent        |
|   #projects       |       |   API (130+ routes) |       |   System Prompts  |
+-------------------+       +-------------------+       +-------------------+
        ^                           ^                           ^
        |                           |                           |
        +------------- OpenClaw Gateway (Discord Bot) ---------+
                     Bot "Shadow" - App ID 1480149701209751640
                     systemd service on VPS 5.78.185.143
                     Webhook Identity Plugin v7
```

### Chain of Command

```
User (Sachin)
  |
  v
Shadow (Leader) -----> Receives all tasks, reviews final output
  |
  v
Nexus (Coordinator) -> Breaks down tasks, assigns specialists, consolidates results
  |
  v
Specialists (17) ----> Execute domain-specific work, report back to Nexus
```

The user NEVER assigns directly to specialists. All tasks enter through Shadow.

### Task State Machine

MC's existing task statuses are: `inbox | assigned | in_progress | review | quality_review | done`. Rather than replace these (which would break all panels, API routes, and tests), we add an `orchestration_state` column to the tasks table that tracks the chain-of-command position. The existing `status` field continues to work for the UI; `orchestration_state` drives the orchestration engine.

**Existing status mapping:**
```
inbox          = task just created, not yet picked up
assigned       = Shadow has accepted the task
in_progress    = agents are working (Shadow analyzing, Nexus breaking down, or specialists executing)
review         = Nexus consolidating results
quality_review = Shadow reviewing final output
done           = complete and reported back to user
```

**Orchestration states (new `orchestration_state` column):**
```
Happy path:
  CREATED -> SHADOW_ANALYZING -> DELEGATED_TO_NEXUS -> NEXUS_BREAKING_DOWN
  -> SUBTASKS_ASSIGNED -> AGENTS_WORKING -> SUBTASKS_COMPLETE
  -> NEXUS_CONSOLIDATING -> SHADOW_REVIEWING -> COMPLETE -> REPORTED

Error/exception paths (reachable from any active state):
  -> FAILED          LLM call failed after retries, or agent returned unusable output
  -> TIMED_OUT       No response within timeout (5min per subtask, 30min per parent)
  -> CANCELLED       User cancelled, or Shadow/Nexus rejected as infeasible
  -> BLOCKED         Waiting on external input (approval, missing info)

Recovery from error states:
  FAILED     -> CREATED (retry from top) or CANCELLED (give up)
  TIMED_OUT  -> CREATED (retry) or CANCELLED
  BLOCKED    -> previous active state (once unblocked)
```

**Subtask failure policy:** If a subtask fails, Nexus is notified and decides: retry the same agent, reassign to another agent, or mark the parent task as partial completion. Nexus's LLM call receives the failure context and makes the decision.

### Task Tree (Parent-Child Hierarchy)

The existing `tasks` table has no `parent_task_id` column. A schema migration is required as a Phase 1 prerequisite:

```sql
ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER REFERENCES tasks(id);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
```

This enables: user task -> Shadow's parent task -> Nexus subtasks -> specialist subtasks. The task board panel will show the tree structure. The `task-status.ts` normalization functions will be extended to handle orchestration state transitions.

Each state transition:
- Updates MC task board and activity feed
- Fires webhook event
- Posts to relevant Discord channel(s)
- Logs to activity timeline

### Orchestration Engine (Hybrid - Option C)

MC handles the workflow state machine. Each "agent" is an LLM call with that agent's system prompt/persona via Kilo Gateway + OpenRouter (free models).

**Flow:**
1. User message arrives (Discord #general or MC Chat)
2. MC Orchestrator routes to Shadow
3. Shadow (LLM call with Shadow's system prompt): analyzes task, decides delegation
4. MC posts Shadow's message to #general + MC Chat, creates subtasks for Nexus
5. Nexus (LLM call with Nexus's prompt + task context): breaks down, assigns specialists
6. MC posts Nexus's message to #general, assigns subtasks to specialists
7. Each specialist (LLM call with their prompt + subtask): executes work
8. MC posts each agent's messages to #general, results flow back
9. Nexus consolidates results
10. Shadow reviews and delivers final output to user

### Agent Structured Output Format

Shadow and Nexus return JSON via LLM function calling / structured output:

**Shadow's response schema:**
```json
{
  "message": "Natural language message for #general (personality, banter)",
  "action": "delegate | complete | reject | request_info",
  "delegate_to": "nexus",
  "task_summary": "Brief summary of what needs to be done",
  "priority": "high | medium | low",
  "notes": "Any context for Nexus"
}
```

**Nexus's response schema:**
```json
{
  "message": "Natural language message for #general",
  "action": "assign | consolidate | escalate | request_info",
  "assignments": [
    { "agent": "atlas", "subtask": "Research competitive positioning", "priority": "high" },
    { "agent": "ink", "subtask": "Draft project brief using research", "depends_on": ["atlas"] }
  ],
  "execution_order": "parallel | sequential | mixed",
  "notes": "Coordination context"
}
```

**Specialist response schema:**
```json
{
  "message": "Natural language message for #general",
  "status": "complete | partial | failed | need_help",
  "result": "The actual deliverable content",
  "artifacts": ["urls or file references if any"],
  "notes": "Context for Nexus consolidation"
}
```

**Parsing strategy:** LLM calls use system prompts that enforce JSON output. MC validates against the schema using Zod. If parsing fails, MC retries once with a "please respond in the correct JSON format" nudge. If second attempt fails, task enters FAILED state and Nexus is notified.

### Agent Execution Model

**Concurrency:** Subtasks execute based on Nexus's `execution_order`:
- `parallel`: all independent subtasks fire simultaneously (respecting rate limits)
- `sequential`: one at a time in order
- `mixed`: honor `depends_on` — parallel where possible, sequential where dependencies exist

**Rate limiting:** Free-tier models have aggressive limits. MC implements:
- Max 3 concurrent LLM calls across all agents
- 2-second minimum gap between calls to same model provider
- Queue system: subtasks wait in queue if concurrency limit reached

**Timeouts:**
- Per subtask: 5 minutes (free models can be slow)
- Per parent task: 30 minutes total
- Per LLM call: 2 minutes (retry after timeout)

## Reliability and Error Handling

### LLM Call Resilience

**Retry policy:** Exponential backoff with jitter
- 1st retry: 5s + random(0-2s)
- 2nd retry: 15s + random(0-5s)
- 3rd retry: 45s + random(0-10s)
- After 3 failures: task enters FAILED state

**Rate limit (429) handling:**
- Respect `Retry-After` header if present
- Otherwise use exponential backoff
- After 3 consecutive 429s, pause all calls to that provider for 60s

**Model fallback chain per agent:**
Each agent has a primary and fallback model. If primary is unavailable:
```
Primary (configured model) -> Fallback (kilo-gateway/minimax-m2.5:free) -> Last resort (openrouter/qwen3-coder:free)
```

**Gateway down:** If Kilo Gateway is unreachable, fall back to direct OpenRouter calls. If OpenRouter is also down, tasks queue with BLOCKED state and resume when connectivity returns.

**Garbage output handling:** If an agent returns a response that fails Zod validation after retry, Nexus receives the failure context and decides: retry with different prompt framing, reassign to another agent, or mark subtask as failed.

### Circuit Breaker

Per-model circuit breaker:
- **Closed** (normal): requests flow through
- **Open** (tripped after 5 failures in 2 min): all requests to that model fail fast, fallback used
- **Half-open** (after 60s): one test request allowed; if successful, close circuit

### MC <-> Discord Bidirectional Sync

| MC Panel | Discord Channel | Direction |
|----------|----------------|-----------|
| Chat | #general | Bidirectional |
| Task Board | #taskboard | MC -> Discord |
| Activity Feed | #activity (panel) | MC -> Discord via #ops-feed |
| Alerts | #alerts | MC -> Discord (Warden) |
| Approvals | #approvals | Bidirectional (reactions + channel) |
| Per-agent Chat | #shadow, #forge, etc. | Bidirectional |

**MC -> Discord:** MC webhook system fires events, formatted and posted to Discord via webhook URLs.
**Discord -> MC:** OpenClaw gateway (existing Discord bot) captures messages, calls MC API routes.

### Discord -> MC Ingest API Contract

New endpoint: `POST /api/discord/ingest`

```json
{
  "source": "discord",
  "channel_id": "1483439441312878593",
  "channel_name": "general",
  "author_id": "discord_user_id",
  "author_name": "Sachin",
  "message_id": "discord_message_id",
  "content": "message text",
  "thread_id": "optional_thread_id",
  "thread_name": "optional_thread_name",
  "is_reply": false,
  "reply_to_message_id": null,
  "timestamp": "2026-03-19T12:00:00Z"
}
```

**Authentication:** MC API key in `Authorization: Bearer <API_KEY>` header.
**Deduplication:** Each Discord message has a unique `message_id`. MC stores `discord_message_id` on chat messages and webhooks deliveries. Before processing, MC checks if `message_id` already exists. This prevents echo loops (MC -> Discord -> MC).
**Channel routing:** MC maps `channel_id` to internal context (e.g., #general -> Chat panel, agent channels -> per-agent chat sessions).

### Discord Routing Bug Workaround

Known issue: OpenClaw gateway routes ALL live Discord messages to `main` agent regardless of channel bindings. For per-agent channels (#shadow, #forge, etc.), we work around this at the MC layer:

1. The gateway forwards all messages to MC via the ingest endpoint
2. MC inspects `channel_id` to determine which agent the message is for
3. MC routes to the correct agent's LLM call using our own agent-to-channel mapping
4. Response posts back via that agent's Discord webhook (webhook identity plugin handles the identity)

This bypasses the gateway's broken routing entirely. MC becomes the routing authority.

## Discord Channel Architecture

### Final Structure (4 categories, ~30 channels)

```
COMMAND
  #general           Main stage. All agent comms happen here. Mirrored to MC Chat.
  #approvals         Dedicated approval requests + reaction-based approvals in #general.

OPERATIONS
  #taskboard         Task lifecycle events (created, assigned, in-progress, completed)
  #activity          Agent status changes (online, offline, busy, error)
  #alerts            Warden security/error alerts
  #ops-feed          Broader operational events (sessions, cron, deployments, health)
  #system-logs       Infrastructure/system-level logs

PROJECTS (Nexus-managed)
  #active-projects   Active project threads with structured updates
  #completed-projects Archived completed work
  #project-proposals New project ideas and proposals

AGENTS (19 channels - user's direct line to each agent)
  #shadow #nexus #forge #warden #stack #atlas #oracle
  #ink #canvas #ledger #apex #merchant #foundry
  #juris #diplomat #wire #ryder #harmony #archive
```

### Migration from Current Structure

**Retire (archive, preserve history):**
- INTELLIGENCE category (atlas-research, oracle-analytics)
- CONTENT category (ink-content, canvas-creative)
- BUSINESS category (ledger-finance, apex-trading, merchant-commerce, foundry-ventures, juris-legal)
- EXTERNAL category (diplomat-comms, wire-integrations, ryder-career)
- COMMUNITY category
- #nexus-briefing (Nexus now talks in #general)

**Rename:**
- #activity-log -> #activity (move to OPERATIONS)
- All agent channels lose domain suffixes: #forge-ops -> #forge, #atlas-research -> #atlas, etc.

**Create:**
- #taskboard (new in OPERATIONS)
- AGENTS category (consolidates all per-agent channels)

**Keep as-is:**
- #general, #approvals, #alerts, #ops-feed, #system-logs
- #active-projects, #completed-projects, #project-proposals

### Thread Strategy

**#general threads:** When a task starts, a thread is created in #general (e.g., "Project Brief - Research Phase"). All agents contribute naturally in the thread with personality and banter. Summary posts back to #general when done.

**#projects threads:** Nexus writes structured summaries to project-specific threads in #active-projects. NOT a duplicate of #general conversation — a curated record:
```
Status: Complete
Started: Mar 19 | Completed: Mar 19
Team: Atlas (research), Ink (writing)
Deliverable: [content/link]
Summary: ...
```

Token impact: minimal. Agents work once in #general threads. Nexus writes a small summary to #projects (200-500 extra tokens).

## Agent Roster (All 19)

### Phase 1: Core Leadership
| Agent | Role | Model |
|-------|------|-------|
| Shadow | Leader, task intake, final review | openrouter/hunter-alpha |
| Nexus | Coordinator, task breakdown, consolidation | kilo-gateway/minimax-m2.5:free |
| Forge | Engineering, code, technical builds | openrouter/qwen3-coder:free |
| Warden | Security, monitoring, alerts | openrouter/qwen3-coder:free |
| Stack | DevOps, infrastructure, deployments | openrouter/qwen3-coder:free |
| Atlas | Research, analysis, intelligence | kilo-gateway/minimax-m2.5:free |
| Ink | Writing, content, copy | openrouter/healer-alpha |

### Phase 2: Specialists
| Agent | Role | Model |
|-------|------|-------|
| Canvas | Design, visuals, UI/UX | kilo-gateway/minimax-m2.5:free |
| Ledger | Finance, budgets, accounting | kilo-gateway/minimax-m2.5:free |
| Wire | Integrations, APIs, connections | openrouter/healer-alpha |
| Juris | Legal, compliance, contracts | kilo-gateway/minimax-m2.5:free |
| Diplomat | Communications, PR, outreach | kilo-gateway/minimax-m2.5:free |
| Ryder | Career, hiring, HR | openrouter/glm-4.5-air:free |

### Phase 3: Advanced
| Agent | Role | Model |
|-------|------|-------|
| Oracle | Analytics, predictions, data | openrouter/hunter-alpha |
| Apex | Trading, markets, strategy | kilo-gateway/minimax-m2.5:free |
| Foundry | Ventures, innovation, R&D | openrouter/healer-alpha |
| Merchant | Commerce, sales, partnerships | kilo-gateway/minimax-m2.5:free |

### Phase 4: Support
| Agent | Role | Model |
|-------|------|-------|
| Harmony | Culture, team health, morale | openrouter/glm-4.5-air:free |
| Archive | Knowledge management, documentation | openrouter/glm-4.5-air:free |

## MC Cleanup & Branding (Phase 1)

### Custom Shadow Collective Logo
- Replace all MC logo PNGs in `/public/brand/` and `/public/mc-logo.png`
- Replace favicons in `/src/app/icon.png` and `/src/app/apple-icon.png`
- Generate Shadow Collective logo (dark theme, fits existing UI)

### Remove xint CLI / builderz .dev Links
- Remove xint integration references from `/src/app/api/integrations/route.ts`
- Remove or update `security@builderz.dev` in SECURITY.md
- Update package.json author field
- Clean up any remaining builderz-labs GitHub URLs

### Security Hardening
- Run `npm audit` and fix 3 auto-fixable issues
- Review and apply docker-compose.hardened.yml overlay
- Verify rate limiting, CSRF, CSP are active

### GitHub Configuration
- Set `main` as default branch on mosac-git/mission-control

## Implementation Phases

### Phase 1: MC Cleanup & Foundation
- Custom logo, xint removal, security fixes, GitHub branch
- Schema migration: add `parent_task_id` and `orchestration_state` to tasks table
- Schema migration: add `discord_message_id` to chat messages for dedup
- Quick wins, parallel execution

### Phase 2: Discord Channel Restructure + Sync
- Restructure Discord (retire categories, create AGENTS, rename channels)
- Configure MC webhooks -> Discord webhook URLs for each channel
- Build Discord -> MC message bridge (extend OpenClaw gateway or MC API)
- Wire MC Chat <-> Discord #general bidirectional sync

### Phase 3: Shadow Orchestration Engine
- Build task intake system (message -> Shadow)
- Shadow's system prompt for task analysis and delegation
- Task tree creation (parent task -> subtasks)
- State machine implementation with event firing
- Wire Shadow's responses to #general + MC Chat

### Phase 4: Full Chain (Nexus + All 19 Specialists)
- Nexus orchestration prompt (receives from Shadow, breaks down, assigns)
- System prompts for all 17 specialist agents
- Specialist execution -> result return -> Nexus consolidation -> Shadow review
- Thread creation in #general for task work
- Nexus project updates to #projects channels

### Phase 5: End-to-End Validation
- Complete roadmap review
- Two real tasks through the full chain
- Verify: MC task board, activity timeline, Discord #general conversation,
  #taskboard updates, #ops-feed events, #projects summaries all reflect correctly

## Existing Infrastructure Leveraged

- **MC Task System:** task routing, dispatch, status tracking, outcomes (130+ API routes)
- **MC Webhook System:** event subscriptions (agent.status_change, activity.*, notification.*), delivery tracking, retry logic
- **MC Activity Feed:** 80% complete timeline (9 activity types, agent filtering, dual view, smart polling)
- **MC Chat Panel:** exists but needs to be wired to Discord sync
- **OpenClaw Gateway:** Discord bot already running, 67 slash commands, WebSocket connected
- **Webhook Identity Plugin v7:** agents post as themselves with custom name/avatar
- **Agent Models:** all 19 agents have assigned free models via Kilo Gateway + OpenRouter

## Approval Flow

Approvals are triggered when an agent needs human authorization before proceeding. Triggers:
- Shadow flags a task as high-risk or high-cost
- An agent wants to execute an external action (post to social media, send email, make purchase)
- Nexus encounters ambiguity and needs clarification

**Flow:**
1. Agent sends approval request to MC (structured output with `action: "request_approval"`)
2. MC posts to #approvals channel with details and reaction options
3. MC also posts inline in #general thread: "Waiting for approval..."
4. User reacts with checkmark (approve) or X (deny) in either channel
5. MC captures reaction via Discord gateway, updates task state from BLOCKED -> previous active state
6. MC also supports approval via MC Approvals panel (existing `exec-approval` API)

## Success Criteria

1. MC fully branded as Shadow Collective (no MC/builderz references)
2. Discord restructured to 4 categories, all channels operational
3. Message in Discord #general appears in MC Chat (and vice versa)
4. Task created in MC shows in Discord #taskboard
5. Agent status changes appear in Discord #ops-feed
6. User gives task to Shadow -> full delegation chain executes -> result delivered
7. All 19 agents respond with personality when called upon
8. Two tasks completed end-to-end with full visibility in both MC and Discord
9. Nexus maintains project records in #projects channels
10. Warden posts alerts to #alerts channel
