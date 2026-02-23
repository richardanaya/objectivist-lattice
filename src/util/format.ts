import { encode } from "@toon-format/toon";
import type { LatticeNode } from "../core/node.js";
import type { ChainTreeNode, ValidationIssue } from "../core/graph.js";

// ─── Output format enum ─────────────────────────────────────────────

export type OutputFormat = "toon" | "json" | "table";

/**
 * Determine the output format from CLI flags.
 * Priority: --json > --table > default (toon).
 */
export function resolveFormat(opts: {
  json?: boolean;
  table?: boolean;
}): OutputFormat {
  if (opts.json) return "json";
  if (opts.table) return "table";
  return "toon";
}

// ─── Node serialization ─────────────────────────────────────────────

/** Serialize a LatticeNode to a plain object (for JSON/TOON output). */
function nodeToObject(node: LatticeNode): Record<string, unknown> {
  return {
    slug: node.slug,
    title: node.title,
    level: node.level,
    reduces_to: node.reduces_to,
    status: node.status,
    tags: node.tags,
    proposition: node.proposition,
    created: node.created.toISOString(),
  };
}

// ─── Node list formatting ────────────────────────────────────────────

export function formatNodes(
  nodes: LatticeNode[],
  format: OutputFormat,
): string {
  if (nodes.length === 0) {
    if (format === "table") return "No nodes found.";
    if (format === "json") return "[]";
    return encode([]);
  }

  const objects = nodes.map(nodeToObject);

  switch (format) {
    case "json":
      return JSON.stringify(objects, null, 2);
    case "toon":
      return encode(objects);
    case "table":
      return formatNodesTable(nodes);
  }
}

function formatNodesTable(nodes: LatticeNode[]): string {
  // Calculate column widths
  const headers = ["Level", "Title", "Status", "Tags", "Slug"];
  const rows = nodes.map((n) => [
    n.level,
    n.title.length > 50 ? n.title.slice(0, 47) + "..." : n.title,
    n.status,
    n.tags.join(","),
    n.slug,
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const sep = widths.map((w) => "\u2500".repeat(w)).join("  ");
  const headerLine = headers
    .map((h, i) => h.padEnd(widths[i]))
    .join("  ");
  const dataLines = rows.map((r) =>
    r.map((cell, i) => cell.padEnd(widths[i])).join("  "),
  );

  return [headerLine, sep, ...dataLines].join("\n");
}

// ─── Chain tree formatting ───────────────────────────────────────────

export function formatChainTree(
  tree: ChainTreeNode,
  format: OutputFormat,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(chainTreeToObject(tree), null, 2);
    case "toon":
      return encode(chainTreeToObject(tree));
    case "table":
      return renderTreeText(tree, "", true);
  }
}

function chainTreeToObject(
  tree: ChainTreeNode,
): Record<string, unknown> {
  return {
    slug: tree.slug,
    title: tree.title,
    level: tree.level,
    status: tree.status,
    reduces_to: tree.children.map(chainTreeToObject),
  };
}

function renderTreeText(
  node: ChainTreeNode,
  prefix: string,
  isRoot: boolean,
): string {
  const label = `${node.level}: ${node.title}`;
  let line: string;
  if (isRoot) {
    line = label;
  } else {
    line = prefix + "\u2514\u2500 " + label;
  }

  const lines = [line];
  const childPrefix = isRoot ? "" : prefix + "   ";
  for (const child of node.children) {
    lines.push(renderTreeText(child, childPrefix, false));
  }
  return lines.join("\n");
}

// ─── Validation issues formatting ────────────────────────────────────

export function formatValidationResult(
  totalNodes: number,
  issues: ValidationIssue[],
  format: OutputFormat,
  deletedCount?: number,
  timeMs?: number,
): string {
  const result = {
    total_nodes: totalNodes,
    issues_found: issues.length,
    issues: issues.map((i) => ({
      slug: i.slug,
      type: i.type,
      message: i.message,
    })),
    deleted: deletedCount ?? 0,
    time_ms: timeMs ?? 0,
  };

  switch (format) {
    case "json":
      return JSON.stringify(result, null, 2);
    case "toon":
      return encode(result);
    case "table":
      return formatValidationTable(totalNodes, issues, deletedCount, timeMs);
  }
}

function formatValidationTable(
  totalNodes: number,
  issues: ValidationIssue[],
  deletedCount?: number,
  timeMs?: number,
): string {
  const lines: string[] = [];

  const brokenLinks = issues.filter((i) => i.type === "broken_link");
  const levelMismatches = issues.filter((i) => i.type === "level_mismatch");
  const cycles = issues.filter((i) => i.type === "cycle");
  const rogueTags = issues.filter((i) => i.type === "rogue_tag");
  const missingReductions = issues.filter(
    (i) => i.type === "missing_reduction",
  );
  const staleTentatives = issues.filter((i) => i.type === "stale_tentative");

  const ok = (label: string) => `\u2713 ${label}`;
  const warn = (label: string, count: number) =>
    `\u26A0 ${count} ${label}`;

  lines.push(ok(`${totalNodes} nodes scanned`));

  if (brokenLinks.length === 0) lines.push(ok("0 broken links"));
  else lines.push(warn("broken link(s)", brokenLinks.length));

  if (levelMismatches.length === 0) lines.push(ok("0 level mismatches"));
  else lines.push(warn("level mismatch(es)", levelMismatches.length));

  if (cycles.length === 0) lines.push(ok("0 cycles"));
  else lines.push(warn("node(s) in cycles", cycles.length));

  if (rogueTags.length === 0) lines.push(ok("0 rogue tags"));
  else lines.push(warn("rogue tag(s)", rogueTags.length));

  if (missingReductions.length === 0)
    lines.push(ok("All non-percepts have reduction chains"));
  else lines.push(warn("missing reduction chain(s)", missingReductions.length));

  if (staleTentatives.length === 0)
    lines.push(ok("0 stale Tentatives (>14d)"));
  else lines.push(warn("stale Tentative(s) >14d", staleTentatives.length));

  if (deletedCount && deletedCount > 0) {
    lines.push(`  ${deletedCount} stale Tentative(s) auto-deleted`);
  }

  // List individual issues
  if (issues.length > 0) {
    lines.push("");
    lines.push("Issues:");
    for (const issue of issues) {
      lines.push(`  ${issue.slug}: ${issue.message}`);
    }
  }

  if (timeMs !== undefined) {
    lines.push(`\nTotal: ${(timeMs / 1000).toFixed(2)}s`);
  }

  return lines.join("\n");
}

// ─── Single-node created output ──────────────────────────────────────

export function formatCreated(
  slug: string,
  filePath: string,
  node: Record<string, unknown>,
  format: OutputFormat,
): string {
  switch (format) {
    case "json":
      return JSON.stringify({ created: filePath, slug, node }, null, 2);
    case "toon":
      return encode({ created: filePath, slug, node });
    case "table":
      return `Node created: ${filePath}`;
  }
}

// ─── Tag list formatting ─────────────────────────────────────────────

export function formatTagList(
  tags: string[],
  format: OutputFormat,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(tags, null, 2);
    case "toon":
      return encode(tags);
    case "table":
      return tags.map((t) => `  - ${t}`).join("\n");
  }
}
