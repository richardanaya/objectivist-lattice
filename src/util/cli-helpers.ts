import { Command } from "commander";
import { LatticeError, AmbiguousMatchError } from "./errors.js";
import { EXIT } from "../core/constants.js";
import { findNodeBySlug as findNode, type LatticeNode } from "../core/node.js";

/**
 * Walk up the commander chain to the root program and extract global options.
 */
export function resolveParentOpts(cmd: Command): Record<string, unknown> {
  let current: Command | null = cmd;
  while (current?.parent) {
    current = current.parent;
  }
  return current?.opts() ?? {};
}

/**
 * Handle errors uniformly: LatticeError → stderr + exit with code.
 * Unknown errors → re-throw.
 */
export function handleError(err: unknown): never {
  if (err instanceof LatticeError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(err.exitCode);
  }
  throw err;
}

/**
 * Resolve a node query to a unique slug. Throws on ambiguous or no match.
 */
export function resolveNodeSlug(
  query: string,
  nodes: Map<string, LatticeNode>,
): string {
  const result = findNode(query, nodes);

  if (result.ambiguous) {
    throw new AmbiguousMatchError(query, result.candidates);
  }

  if (!result.slug) {
    throw new LatticeError(
      `Node not found: '${query}'. Try an exact slug or a unique substring of the title.`,
      EXIT.BAD_INPUT,
    );
  }

  return result.slug;
}
