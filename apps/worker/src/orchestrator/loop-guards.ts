/**
 * Loop prevention (FR-015): pure guards used by the DOC orchestrator before
 * any subtask is created. Violations are refused and escalated to the owner —
 * never silently dropped.
 */
import { MAX_DELEGATION_DEPTH } from '@flux88/core/task-machine';

/** True when adding one more delegation level would exceed the limit. */
export function exceedsDepthLimit(parentDepth: number, limit: number = MAX_DELEGATION_DEPTH): boolean {
  return parentDepth + 1 > limit;
}

/**
 * True when assigning `next` would hand work back to an agent already in the
 * delegation chain for this work item (circular delegation, e.g. A → B → A).
 */
export function detectDelegationLoop(chainAssignees: readonly string[], next: string): boolean {
  return chainAssignees.includes(next);
}

/**
 * True when the planned dependency edges contain a cycle. Edges are
 * `[taskIndex, dependsOnIndex]` pairs over `nodeCount` planned subtasks.
 */
export function hasCycle(edges: ReadonlyArray<readonly [number, number]>, nodeCount: number): boolean {
  const adjacency = new Map<number, number[]>();
  for (const [from, to] of edges) {
    if (from < 0 || from >= nodeCount || to < 0 || to >= nodeCount) return true; // malformed = refuse
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  }
  const state = new Array<0 | 1 | 2>(nodeCount).fill(0); // 0 unvisited, 1 visiting, 2 done
  const visit = (node: number): boolean => {
    if (state[node] === 1) return true;
    if (state[node] === 2) return false;
    state[node] = 1;
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    state[node] = 2;
    return false;
  };
  for (let i = 0; i < nodeCount; i += 1) {
    if (state[i] === 0 && visit(i)) return true;
  }
  return false;
}
