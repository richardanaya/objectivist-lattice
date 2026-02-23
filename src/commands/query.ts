import { Command } from "commander";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadAllNodes, type LatticeNode } from "../core/node.js";
import { buildReductionChain } from "../core/graph.js";
import { resolveFormat, formatNodes, formatChainTree } from "../util/format.js";
import { LatticeError } from "../util/errors.js";
import { EXIT, LEVELS } from "../core/constants.js";
import { resolveParentOpts, handleError, resolveNodeSlug } from "../util/cli-helpers.js";

export function makeQueryCommand(): Command {
  const cmd = new Command("query");

  cmd
    .description("Search and traverse the lattice")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Reads the lattice and returns structured results. This is the primary
  read interface — the commands an agent runs dozens of times per session
  to look up what it knows, verify its reasoning, and find gaps.

  Every query loads the full graph from disk into memory. No database.
  Performance: <0.5s for 10,000 nodes.

  Default output is TOON (compact, LLM-optimized). Use --json for scripts
  or --table for human-readable terminal output.

SUBCOMMANDS:
  all            Everything. Optionally filter by level, status, or tag.
  applications   Your validated action rules (what you DO).
  principles     Your validated general rules (what you KNOW).
  chain          Full proof tree: "Why do I believe X?" — walks to percepts.
  tentative      Ungrounded beliefs that need review or deletion.
  tag            Everything you know about a topic, grouped by level.

WHEN TO USE EACH:
  "What should I do about X?"         → query applications --tag X
  "What rules do I have about X?"     → query principles --tag X
  "Why do I believe X?"               → query chain <node>
  "What needs my attention today?"    → query tentative
  "Show me everything about X"        → query tag X
  "Give me a full inventory"          → query all

Run 'lattice query <subcommand> --help' for full details.
`,
    );

  // ─── all ───────────────────────────────────────────────────────
  const allCmd = new Command("all")
    .description("List all nodes in the vault")
    .option("--level <level>", "Filter by level (percept, axiom, principle, application)")
    .option("--status <status>", "Filter by status (Integrated/Validated or Tentative/Hypothesis)")
    .option("--tag <tag>", "Filter by tag")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Returns every node in the vault. Can be filtered by level, status, or tag.
  With no filters, this is the complete inventory of your knowledge.

  Use this when you need the big picture: "How many nodes do I have?
  What is the ratio of Tentative to Validated? Are there entire levels
  with nothing in them?"

FLAGS:
  --level <level>    Filter: percept, axiom, principle, application
  --status <status>  Filter: "Integrated/Validated" or "Tentative/Hypothesis"
  --tag <tag>        Filter: only nodes with this tag

OUTPUT:
  Array of node objects sorted by level (percepts first, applications last).

GOLDEN EXAMPLES:

  1. Full inventory of the lattice:
     $ lattice query all --table

  2. All percepts (your evidence base):
     $ lattice query all --level percept

  3. All validated knowledge about career:
     $ lattice query all --status "Integrated/Validated" --tag career

  4. Find tentative axioms that need grounding:
     $ lattice query all --level axiom --status "Tentative/Hypothesis"

  5. Count total nodes programmatically:
     $ lattice query all --json | jq 'length'
`,
    );

  allCmd.action(async (opts) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      let results = Array.from(nodes.values());

      if (opts.level) {
        const level = opts.level.toLowerCase();
        if (!LEVELS.includes(level as typeof LEVELS[number])) {
          throw new LatticeError(
            `Invalid level '${opts.level}'. Must be one of: percept, axiom, principle, application`,
            EXIT.BAD_INPUT,
          );
        }
        results = results.filter((n) => n.level === level);
      }

      if (opts.status) {
        results = results.filter((n) => n.status === opts.status);
      }

      if (opts.tag) {
        results = results.filter((n) => n.tags.includes(opts.tag.toLowerCase()));
      }

      // Sort by level order (percepts first)
      const levelOrder = ["percept", "axiom", "principle", "application"];
      results.sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));

      process.stdout.write(formatNodes(results, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  // ─── applications ──────────────────────────────────────────────
  const appCmd = new Command("applications")
    .description("List all validated applications")
    .option("--tag <tag>", "Filter by tag")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Returns your validated action rules — concrete decisions and policies
  that you actually follow. These are level=application nodes with
  status=Integrated/Validated.

  This is the "what do I DO?" query. Before taking any significant action,
  an agent should check: "Do I already have a validated application for
  this situation?"

  If yes → follow it.
  If no → you need to build the chain: observe (percept) → identify the
  pattern (principle) → deduce the action (application).

FLAGS:
  --tag <tag>   Filter by tag (e.g. "career", "decisions")

GOLDEN EXAMPLES:

  1. Before deploying code, check your deployment rules:
     $ lattice query applications --tag career

  2. Before making a financial decision:
     $ lattice query applications --tag money

  3. Get all validated action rules as TOON for processing:
     $ lattice query applications
`,
    );

  appCmd.action(async (opts) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      let results = filterByLevelAndStatus(nodes, "application", "Integrated/Validated");
      if (opts.tag) {
        results = results.filter((n) => n.tags.includes(opts.tag.toLowerCase()));
      }

      process.stdout.write(formatNodes(results, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  // ─── principles ────────────────────────────────────────────────
  const prinCmd = new Command("principles")
    .description("List all validated principles")
    .option("--tag <tag>", "Filter by tag")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Returns your validated general rules — induced patterns that predict
  future outcomes. These are level=principle nodes with
  status=Integrated/Validated.

  This is the "what do I KNOW?" query. Principles are the bridge between
  raw evidence (percepts/axioms) and concrete action (applications).
  If you have percepts but no principles, you have data but no knowledge.
  If you have applications but no principles, your actions are ungrounded.

FLAGS:
  --tag <tag>   Filter by tag

GOLDEN EXAMPLES:

  1. What general rules do I have about decision-making?
     $ lattice query principles --tag decisions

  2. What do I know about why things fail?
     $ lattice query principles --tag failure

  3. Show all principles to look for gaps:
     $ lattice query principles --table
`,
    );

  prinCmd.action(async (opts) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      let results = filterByLevelAndStatus(nodes, "principle", "Integrated/Validated");
      if (opts.tag) {
        results = results.filter((n) => n.tags.includes(opts.tag.toLowerCase()));
      }

      process.stdout.write(formatNodes(results, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  // ─── chain ─────────────────────────────────────────────────────
  const chainCmd = new Command("chain")
    .description("Full backward reduction tree for a node")
    .argument("<node>", "Node slug, filename, or partial title match")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  The most important query in the lattice. Walks backward from any node
  through its reduces_to links, building a complete proof tree down to
  the percepts at the base.

  This is how you answer: "WHY do I believe this?"

  If the chain is complete (reaches percepts) → the belief is grounded.
  If the chain has broken links → the belief is floating. Fix or delete it.
  If the chain is shallow → the belief needs more evidence.

  Diamond patterns are shown correctly: if a node appears in multiple
  reduction paths, it is displayed in each path (not pruned).

NODE MATCHING:
  You do not need the full slug. The command tries, in order:
    1. Exact slug match
    2. Single prefix match
    3. Single slug substring match
    4. Single title substring match
  If multiple nodes match, it returns an error listing the candidates.

OUTPUT:
  Default (TOON): nested { slug, title, level, status, reduces_to: [...] }
  --json: same as nested JSON
  --table: visual tree:
    application: Run full test suite before every deploy
    └─ principle: Untested code will exhibit its defects in production
       └─ axiom: Code behaves according to what it contains
          └─ percept: Deploy without tests crashed prod on March 3

GOLDEN EXAMPLES:

  1. Verify a decision before acting on it:
     $ lattice query chain run-full-test --table
     # See the complete reasoning chain. If it reaches a percept, act.
     # If it has gaps, investigate before acting.

  2. Debug a broken chain:
     $ lattice query chain some-shaky-principle
     # If output shows [BROKEN LINK: ...], the target was deleted or
     # renamed. Fix with 'lattice update' or delete the broken node.

  3. Audit someone else's claim in the lattice:
     $ lattice query chain "users abandon slow pages" --json
     # Parse the JSON to check: does this reach actual measurements?
`,
    );

  chainCmd.action(async (nodeQuery: string) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      const slug = resolveNodeSlug(nodeQuery, nodes);

      const tree = buildReductionChain(slug, nodes);
      if (!tree) {
        throw new LatticeError(
          `Could not build reduction chain for '${slug}'`,
          EXIT.VALIDATION_ERROR,
        );
      }

      process.stdout.write(formatChainTree(tree, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  // ─── tentative ─────────────────────────────────────────────────
  const tentCmd = new Command("tentative")
    .description("List all Tentative/Hypothesis nodes")
    .option(
      "--older-than <duration>",
      "Filter by age, e.g. 7d, 48h (d=days, h=hours)",
    )
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Returns every node with status=Tentative/Hypothesis, sorted oldest first.
  These are beliefs that have not been fully grounded — they are missing
  reduction links, pending review, or recently added without complete chains.

  This is the daily hygiene query. Run it every session. The goal is zero
  tentative nodes, or at minimum, no tentative node older than a few days.
  If a belief has sat ungrounded for a week, it is either worth validating
  (do it now) or not worth keeping (delete it).

FLAGS:
  --older-than <duration>   Filter by age: "7d" (days) or "48h" (hours)

GOLDEN EXAMPLES:

  1. Morning review — what needs attention today?
     $ lattice query tentative --table

  2. Find beliefs that have been floating too long:
     $ lattice query tentative --older-than 7d
     # These are candidates for deletion or immediate grounding.

  3. Agent self-check before a decision:
     $ lattice query tentative --older-than 48h
     # If the node you are about to act on is here, do NOT act.
     # Ground it first, then act.
`,
    );

  tentCmd.action(async (opts) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      let results = Array.from(nodes.values()).filter(
        (n) => n.status === "Tentative/Hypothesis",
      );

      if (opts.olderThan) {
        const thresholdMs = parseDuration(opts.olderThan);
        const cutoff = Date.now() - thresholdMs;
        results = results.filter((n) => n.created.getTime() < cutoff);
      }

      // Sort oldest first
      results.sort((a, b) => a.created.getTime() - b.created.getTime());

      process.stdout.write(formatNodes(results, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  // ─── tag ───────────────────────────────────────────────────────
  const tagCmd = new Command("tag")
    .description("List all nodes with a specific tag, grouped by level")
    .argument("<tag>", "Tag name from master list")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Returns all nodes tagged with a specific topic, regardless of level or
  status. Results are sorted by level: percepts first, then axioms,
  principles, and applications last.

  This is the "show me everything I know about X" query. The level
  ordering lets you read top-to-bottom: first the evidence, then the
  truths, then the rules, then the actions.

  If the output is heavy on percepts but light on principles, you have
  data but haven't drawn conclusions. If heavy on applications but light
  on percepts, your actions may be ungrounded — investigate.

GOLDEN EXAMPLES:

  1. Before a career decision, see your full knowledge on the topic:
     $ lattice query tag career --table
     # Read the output: are the applications grounded in principles?
     # Are the principles backed by percepts? Any gaps?

  2. Audit your knowledge about relationships:
     $ lattice query tag relationships
     # Default TOON output for efficient processing.

  3. Find out if you know anything about a topic at all:
     $ lattice query tag money --json | jq 'length'
     # Returns 0 if you have no nodes on this topic.
`,
    );

  tagCmd.action(async (tag: string) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      const tagLower = tag.toLowerCase().trim();
      const results = Array.from(nodes.values())
        .filter((n) => n.tags.includes(tagLower))
        .sort((a, b) => {
          const levelOrder = ["percept", "axiom", "principle", "application"];
          return levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level);
        });

      process.stdout.write(formatNodes(results, format) + "\n");
    } catch (err) {
      handleError(err);
    }
  });

  cmd.addCommand(allCmd);
  cmd.addCommand(appCmd);
  cmd.addCommand(prinCmd);
  cmd.addCommand(chainCmd);
  cmd.addCommand(tentCmd);
  cmd.addCommand(tagCmd);

  return cmd;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function filterByLevelAndStatus(
  nodes: Map<string, LatticeNode>,
  level: string,
  status: string,
): LatticeNode[] {
  return Array.from(nodes.values()).filter(
    (n) => n.level === level && n.status === status,
  );
}

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(d|h)$/);
  if (!match) {
    throw new LatticeError(
      `Invalid duration '${s}'. Use format like 7d (days) or 48h (hours).`,
      EXIT.BAD_INPUT,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "d") return value * 24 * 60 * 60 * 1000;
  return value * 60 * 60 * 1000;
}
