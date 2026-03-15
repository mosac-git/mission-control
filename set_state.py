#!/usr/bin/env python3
"""Update Shadow Collective agent state in mission-control state.json.

Usage:
    python3 set_state.py <agent> <state> [task] [room]

Examples:
    python3 set_state.py forge working "deploying v2.1.0"
    python3 set_state.py warden idle
    python3 set_state.py atlas working "scanning URLs" intelligence
    python3 set_state.py shadow meeting "strategy review" conference
"""

import json
import os
import sys
from datetime import datetime

STATE_FILE = os.environ.get(
    "MISSION_CONTROL_STATE_FILE",
    "/root/.openclaw/mission-control-state.json",
)

VALID_AGENTS = [
    "shadow", "nexus", "forge", "warden", "stack", "atlas", "ink",
    "canvas", "ledger", "wire", "juris", "diplomat", "ryder",
    "oracle", "apex", "foundry", "merchant", "harmony", "archive",
]

VALID_STATES = [
    "working", "thinking", "chatting", "meeting", "walking",
    "idle", "sleeping", "error", "approving", "locked",
]

VALID_ROOMS = [
    "ceo-suite", "chief-of-staff", "operations", "intelligence",
    "creative", "business", "external", "governance", "personal",
    "people", "conference", "lounge", "armory", "activity-board",
]

MAX_ACTIVITY_LOG = 50


def load_state():
    """Load current state from STATE_FILE, returning default if missing or malformed."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "agents" in data:
                return data
        except Exception:
            pass
    # Return minimal default
    return {
        "hq_name": "Shadow Collective HQ",
        "version": "3.0",
        "agents": {name: {"state": "idle", "room": "operations", "task": "", "phase": 1, "active": True} for name in VALID_AGENTS},
        "activity_log": [],
    }


def save_state(data):
    """Write state to STATE_FILE, creating parent directories if needed."""
    parent = os.path.dirname(STATE_FILE)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 set_state.py <agent> <state> [task] [room]")
        print(f"\nAgents:  {', '.join(VALID_AGENTS)}")
        print(f"States:  {', '.join(VALID_STATES)}")
        print(f"Rooms:   {', '.join(VALID_ROOMS)}")
        print("\nExamples:")
        print('  python3 set_state.py forge working "deploying v2.1.0"')
        print("  python3 set_state.py warden idle")
        print('  python3 set_state.py atlas working "scanning URLs" intelligence')
        sys.exit(1)

    agent_name = sys.argv[1].lower()
    state_name = sys.argv[2].lower()
    task = sys.argv[3] if len(sys.argv) > 3 else ""
    room = sys.argv[4].lower() if len(sys.argv) > 4 else None

    # Validate agent
    if agent_name not in VALID_AGENTS:
        print(f"Error: unknown agent '{agent_name}'")
        print(f"Valid agents: {', '.join(VALID_AGENTS)}")
        sys.exit(1)

    # Validate state
    if state_name not in VALID_STATES:
        print(f"Error: unknown state '{state_name}'")
        print(f"Valid states: {', '.join(VALID_STATES)}")
        sys.exit(1)

    # Validate room (if provided)
    if room and room not in VALID_ROOMS:
        print(f"Error: unknown room '{room}'")
        print(f"Valid rooms: {', '.join(VALID_ROOMS)}")
        sys.exit(1)

    # Load, update, save
    data = load_state()
    agents = data.get("agents", {})

    if agent_name not in agents:
        agents[agent_name] = {"state": "idle", "room": "operations", "task": "", "phase": 1, "active": True}

    agent = agents[agent_name]
    agent["state"] = state_name
    agent["task"] = task
    if room:
        agent["room"] = room

    # Append to activity_log
    activity_log = data.get("activity_log", [])
    activity_log.insert(0, {
        "agent": agent_name,
        "action": task or state_name,
        "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "done" if state_name in ("idle", "sleeping") else "pending",
    })
    # Keep last MAX_ACTIVITY_LOG entries
    data["activity_log"] = activity_log[:MAX_ACTIVITY_LOG]
    data["agents"] = agents

    save_state(data)
    room_display = agent["room"]
    print(f"[{agent_name}] state={state_name} task=\"{task}\" room={room_display}")


if __name__ == "__main__":
    main()
