import { LEVEL_RANK, type Level } from "./constants.js";
import type { LatticeNode } from "./node.js";
import {
  CycleDetectedError,
  LevelMismatchError,
  TargetNotFoundError,
  UnvalidatedParentError,
} from "../util/errors.js";

// ─── Graph types ─────────────────────────────────────────────────────

/** A tree node for displaying reduction chains. */
export interface ChainTreeNode {
  slug: string;
  title: string;
  level: Level;
  status: string;
  children: ChainTreeNode[];
}

/** Validation issue found during full integrity scan. */
export interface ValidationIssue {
  slug: string;
  type:
    | "broken_link"
    | "level_mismatch"
    | "cycle"
    | "rogue_tag"
    | "missing_reduction"
    | "stale_tentative";
  message: string;
}

// ─── Level validation ────────────────────────────────────────────────

/**
 * Check that a reduction link respects level ordering.
 * A node at rank R can only reduce to nodes at rank < R.
 *
 * Axioms and percepts share rank 0. Neither can reduce to the other —
 * both are irreducible bedrock. Principles (rank 1) reduce to axioms
 * or percepts. Applications (rank 2) reduce to principles or bedrock.
 */
export function validateLevelOrder(
  sourceLevel: Level,
  targetLevel: Level,
): void {
  if (LEVEL_RANK[sourceLevel] <= LEVEL_RANK[targetLevel]) {
    throw new LevelMismatchError(sourceLevel, targetLevel);
  }
}

// ─── Cycle detection ─────────────────────────────────────────────────

/**
 * Check if adding edge (fromSlug → toSlug) would create a cycle.
 * Uses DFS from toSlug following reduces_to edges.
 * If toSlug can reach fromSlug via existing edges, adding this edge
 * would create a cycle.
 *
 * Note: in our DAG, edges go from child → parent (reduces_to direction).
 * A cycle exists if the target can reach the source by following
 * reduces_to chains from source.
 *
 * Actually, since reduces_to is child→parent and we're adding
 * fromSlug.reduces_to → toSlug, we need to check if toSlug can reach
 * fromSlug by following its own reduces_to chain. That would mean
 * fromSlug is an ancestor of toSlug, and adding toSlug as a parent
 * of fromSlug creates a cycle.
 *
 * Wait — the correct check is: can we reach fromSlug starting from
 * toSlug by walking reduces_to edges? If yes, then toSlug is already
 * a descendant of fromSlug (or IS fromSlug), so adding fromSlug→toSlug
 * creates a cycle.
 */
export function wouldCreateCycle(
  fromSlug: string,
  toSlug: string,
  nodes: Map<string, LatticeNode>,
): boolean {
  // If source == target, trivial cycle
  if (fromSlug === toSlug) return true;

  // BFS/DFS from toSlug following reduces_to edges
  const visited = new Set<string>();
  const stack = [toSlug];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromSlug) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = nodes.get(current);
    if (!node) continue;
    for (const parent of node.reduces_to) {
      stack.push(parent);
    }
  }

  return false;
}

/**
 * Validate all reduces_to links for a new node being added.
 * Checks: targets exist, level ordering correct, no cycles.
 */
export function validateReductionLinks(
  sourceSlug: string,
  sourceLevel: Level,
  reducesTo: string[],
  nodes: Map<string, LatticeNode>,
): void {
  for (const targetSlug of reducesTo) {
    const target = nodes.get(targetSlug);
    if (!target) {
      throw new TargetNotFoundError(targetSlug);
    }

    validateLevelOrder(sourceLevel, target.level);

    if (wouldCreateCycle(sourceSlug, targetSlug, nodes)) {
      throw new CycleDetectedError();
    }
  }
}

/**
 * Validate that all direct parents (reduces_to targets) of a node are
 * Integrated/Validated before the node itself can be promoted.
 * Throws UnvalidatedParentError on the first unvalidated parent found.
 *
 * Only checks direct parents — the caller is responsible for ensuring
 * the full chain is clean via repeated promotion from the bottom up.
 */
export function validateParentsAreValidated(
  reducesTo: string[],
  nodes: Map<string, LatticeNode>,
): void {
  for (const parentSlug of reducesTo) {
    const parent = nodes.get(parentSlug);
    // Missing parents are caught by validateReductionLinks; skip here
    if (!parent) continue;
    if (parent.status === "Tentative/Hypothesis") {
      throw new UnvalidatedParentError(parentSlug);
    }
  }
}

// ─── Chain traversal ─────────────────────────────────────────────────

/**
 * Build a full reduction chain tree starting from a given node.
 * Walks backward (reduces_to) building a tree structure.
 * Handles missing nodes gracefully (shows them as broken links).
 *
 * Diamond DAGs are handled correctly: if the same node appears in
 * multiple reduction paths, it is included in each path (duplicated
 * in the tree). A depth limit prevents infinite loops on corrupt
 * cyclic data. Max depth 100 levels should be more than enough for
 * any real knowledge lattice.
 */
export function buildReductionChain(
  slug: string,
  nodes: Map<string, LatticeNode>,
): ChainTreeNode | null {
  const node = nodes.get(slug);
  if (!node) return null;

  const MAX_DEPTH = 100;

  function walk(s: string, ancestors: Set<string>, depth: number): ChainTreeNode | null {
    // Cycle guard: if we've seen this node in the current path, stop
    if (ancestors.has(s)) {
      return {
        slug: s,
        title: `[CYCLE: ${s}]`,
        level: "percept" as Level,
        status: "cycle",
        children: [],
      };
    }

    // Depth guard: prevent runaway on corrupt data
    if (depth > MAX_DEPTH) return null;

    const n = nodes.get(s);
    if (!n) {
      return {
        slug: s,
        title: `[BROKEN LINK: ${s}]`,
        level: "percept" as Level,
        status: "unknown",
        children: [],
      };
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(s);

    const children: ChainTreeNode[] = [];
    for (const parentSlug of n.reduces_to) {
      const child = walk(parentSlug, nextAncestors, depth + 1);
      if (child) children.push(child);
    }

    return {
      slug: n.slug,
      title: n.title,
      level: n.level,
      status: n.status,
      children,
    };
  }

  return walk(slug, new Set(), 0);
}

// ─── Incoming link computation ───────────────────────────────────────

/**
 * Build a reverse index: for each node, which other nodes reduce to it.
 */
export function buildIncomingLinks(
  nodes: Map<string, LatticeNode>,
): Map<string, string[]> {
  const incoming = new Map<string, string[]>();

  for (const [slug] of nodes) {
    incoming.set(slug, []);
  }

  for (const [slug, node] of nodes) {
    for (const target of node.reduces_to) {
      const list = incoming.get(target);
      if (list) {
        list.push(slug);
      } else {
        incoming.set(target, [slug]);
      }
    }
  }

  return incoming;
}

// ─── Full validation scan ────────────────────────────────────────────

/**
 * Run full integrity validation on the entire graph.
 * Returns a list of all issues found.
 */
export function validateGraph(
  nodes: Map<string, LatticeNode>,
  masterTags: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tagSet = new Set(masterTags);

  for (const [slug, node] of nodes) {
    // Check reduces_to targets exist
    for (const target of node.reduces_to) {
      if (!nodes.has(target)) {
        issues.push({
          slug,
          type: "broken_link",
          message: `Broken link: reduces_to target '${target}' does not exist`,
        });
      }
    }

    // Check level ordering
    for (const target of node.reduces_to) {
      const targetNode = nodes.get(target);
      if (targetNode) {
        if (LEVEL_RANK[node.level] <= LEVEL_RANK[targetNode.level]) {
          issues.push({
            slug,
            type: "level_mismatch",
            message: `Level mismatch: ${node.level} reduces to ${targetNode.level} (${target})`,
          });
        }
      }
    }

    // Check that only bedrock nodes (axiom, percept) have empty reduces_to
    const isBedrock = node.level === "percept" || node.level === "axiom";
    if (!isBedrock && node.reduces_to.length === 0) {
      issues.push({
        slug,
        type: "missing_reduction",
        message: `Non-bedrock node (level: ${node.level}) has no reduces_to links`,
      });
    }

    // Check tags
    for (const tag of node.tags) {
      if (!tagSet.has(tag)) {
        issues.push({
          slug,
          type: "rogue_tag",
          message: `Rogue tag '${tag}' not in tags.json`,
        });
      }
    }

    // Check stale tentatives (>14 days) — bedrock is always validated, never stale
    if (!isBedrock && node.status === "Tentative/Hypothesis") {
      const age = Date.now() - node.created.getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      if (age > 14 * dayMs) {
        issues.push({
          slug,
          type: "stale_tentative",
          message: `Tentative for ${Math.floor(age / dayMs)} days (>14 day threshold)`,
        });
      }
    }
  }

  // Cycle detection: attempt topological sort
  const inDegree = new Map<string, number>();
  for (const [slug] of nodes) {
    inDegree.set(slug, 0);
  }
  for (const [, node] of nodes) {
    for (const target of node.reduces_to) {
      if (inDegree.has(target)) {
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [slug, deg] of inDegree) {
    if (deg === 0) queue.push(slug);
  }
  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    const node = nodes.get(current);
    if (!node) continue;
    for (const target of node.reduces_to) {
      const deg = inDegree.get(target);
      if (deg !== undefined) {
        const newDeg = deg - 1;
        inDegree.set(target, newDeg);
        if (newDeg === 0) queue.push(target);
      }
    }
  }

  if (processed < nodes.size) {
    // There are cycles — find which nodes are in them
    for (const [slug] of nodes) {
      const deg = inDegree.get(slug);
      if (deg !== undefined && deg > 0) {
        issues.push({
          slug,
          type: "cycle",
          message: `Node is part of a cycle in the reduction graph`,
        });
      }
    }
  }

  return issues;
}

// ─── Hollow chain detection ──────────────────────────────────────────

/**
 * A validated node whose reduction chain contains at least one
 * Tentative/Hypothesis node. Structurally intact but epistemically hollow.
 */
export interface HollowChainResult {
  /** The validated node whose chain is hollow. */
  slug: string;
  title: string;
  level: string;
  /** The specific weak-link nodes found anywhere in the chain. */
  weak_links: Array<{ slug: string; title: string; level: string }>;
}

/**
 * Walk every Integrated/Validated non-bedrock node and check whether its
 * full reduction chain (all ancestors, not just direct parents) contains
 * any Tentative/Hypothesis nodes.
 *
 * This catches the case where a parent was demoted after the child was
 * already validated — the child's status is still Integrated/Validated
 * but the epistemic ground beneath it has been pulled out.
 *
 * Returns one result per hollow node, listing every weak-link ancestor.
 */
export function findHollowChains(
  nodes: Map<string, LatticeNode>,
): HollowChainResult[] {
  const results: HollowChainResult[] = [];

  for (const node of nodes.values()) {
    const isBedrock = node.level === "percept" || node.level === "axiom";
    if (isBedrock) continue;
    if (node.status !== "Integrated/Validated") continue;

    // Walk full chain, collecting any Tentative ancestors
    const weakLinks: Array<{ slug: string; title: string; level: string }> = [];
    const visited = new Set<string>();
    const stack = [...node.reduces_to];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const ancestor = nodes.get(current);
      if (!ancestor) continue; // broken links are caught by validateGraph

      if (ancestor.status === "Tentative/Hypothesis") {
        weakLinks.push({
          slug: ancestor.slug,
          title: ancestor.title,
          level: ancestor.level,
        });
      }

      // Continue walking even past Tentative nodes — there may be more below
      for (const parent of ancestor.reduces_to) {
        stack.push(parent);
      }
    }

    if (weakLinks.length > 0) {
      results.push({
        slug: node.slug,
        title: node.title,
        level: node.level,
        weak_links: weakLinks,
      });
    }
  }

  return results;
}

/**
 * Find nodes that directly reduce to the given slug and are still Tentative/Hypothesis.
 * Used to surface promotion hints after a node becomes Integrated/Validated.
 */
export function findTentativeChildren(
  slug: string,
  nodes: Map<string, LatticeNode>,
): LatticeNode[] {
  const results: LatticeNode[] = [];
  for (const node of nodes.values()) {
    if (
      node.status === "Tentative/Hypothesis" &&
      node.reduces_to.includes(slug)
    ) {
      results.push(node);
    }
  }
  return results;
}

/**
 * Check if the full reduction chain of a node reaches at least one bedrock node
 * (axiom or percept). Used for determining if a chain is "complete" for
 * Integrated/Validated status.
 *
 * Both axioms (philosophical bedrock) and percepts (empirical bedrock) are
 * valid termination points for a reduction chain.
 */
export function chainReachesBedrock(
  slug: string,
  nodes: Map<string, LatticeNode>,
): boolean {
  const visited = new Set<string>();
  const stack = [slug];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = nodes.get(current);
    if (!node) continue;
    if (node.level === "percept" || node.level === "axiom") return true;

    for (const parent of node.reduces_to) {
      stack.push(parent);
    }
  }

  return false;
}
