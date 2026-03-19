/**
 * Task tree utilities for the orchestration engine.
 *
 * Operates on flat arrays of task-like objects and provides:
 *  - getSubtasks: direct children of a parent
 *  - getParentChain: ancestor chain from a task up to root
 *  - buildTaskTree: nested tree from a flat list
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskLike {
  id: number
  title: string
  parent_task_id: number | null
  [key: string]: unknown
}

export interface TaskTreeNode extends TaskLike {
  children: TaskTreeNode[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get direct children of a given parent task.
 * Returns an empty array when the parent has no subtasks.
 */
export function getSubtasks(tasks: TaskLike[], parentId: number): TaskLike[] {
  return tasks.filter((t) => t.parent_task_id === parentId)
}

/**
 * Walk up the parent chain from `taskId` to the root.
 * Returns ancestors ordered nearest-first (immediate parent first, root last).
 * The task itself is **not** included in the result.
 *
 * Guards against cycles by tracking visited IDs.
 */
export function getParentChain(tasks: TaskLike[], taskId: number): TaskLike[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const chain: TaskLike[] = []
  const visited = new Set<number>()

  let current = byId.get(taskId)
  if (!current) return chain

  // Walk up via parent_task_id
  while (current?.parent_task_id != null) {
    if (visited.has(current.parent_task_id)) break // cycle guard
    visited.add(current.parent_task_id)
    const parent = byId.get(current.parent_task_id)
    if (!parent) break
    chain.push(parent)
    current = parent
  }

  return chain
}

/**
 * Build a nested tree structure from a flat task list.
 *
 * Returns the root node (the single task with `parent_task_id === null`).
 * If there are multiple roots, the first one encountered (by array order) is
 * returned.  If there are no tasks, returns `null`.
 */
export function buildTaskTree(tasks: TaskLike[]): TaskTreeNode | null {
  if (tasks.length === 0) return null

  // Create tree nodes from flat tasks
  const nodeMap = new Map<number, TaskTreeNode>()
  for (const task of tasks) {
    nodeMap.set(task.id, { ...task, children: [] })
  }

  let root: TaskTreeNode | null = null

  for (const task of tasks) {
    const node = nodeMap.get(task.id)!
    if (task.parent_task_id == null) {
      // This is a root
      if (!root) root = node
    } else {
      const parentNode = nodeMap.get(task.parent_task_id)
      if (parentNode) {
        parentNode.children.push(node)
      } else if (!root) {
        // Orphan — treat as root if no root yet
        root = node
      }
    }
  }

  return root
}
