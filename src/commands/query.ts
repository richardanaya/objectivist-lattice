import { Command } from "commander";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadAllNodes, type LatticeNode } from "../core/node.js";
import { buildReductionChain, findHollowChains, findRelatedNodes, buildIncomingLinks } from "../core/graph.js";
import { resolveFormat, formatNodes, formatChainTree } from "../util/format.js";
import { encode } from "@toon-format/toon";
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
  chain          Full proof tree: "Why do I believe X?" — walks to bedrock.
  tentative      Ungrounded beliefs that need review or deletion.
  tag            Everything you know about a topic, grouped by level.
  hollow-chains  Validated nodes whose chain contains a Tentative ancestor.
  related        Multi-hop graph walk to find epistemically connected nodes.

WHEN TO USE EACH:
  "What should I do about X?"         → query applications --tag X
  "What rules do I have about X?"     → query principles --tag X
  "Why do I believe X?"               → query chain <node>
  "What needs my attention today?"    → query tentative
  "Show me everything about X"        → query tag X
  "Give me a full inventory"          → query all
  "Is any validated node now hollow?" → query hollow-chains
  "What do I know related to X?"      → query related <query>

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
  the bedrock (axioms and/or percepts) at the base.

  This is how you answer: "WHY do I believe this?"

  If the chain reaches bedrock (axiom or percept) → the belief is grounded.
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

  // ─── hollow-chains ─────────────────────────────────────────────────
  const hollowCmd = new Command("hollow-chains")
    .description("Find Integrated/Validated nodes whose reduction chain contains a Tentative ancestor")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Finds every Integrated/Validated non-bedrock node that has at least one
  Tentative/Hypothesis node anywhere in its full reduction chain.

  This catches a specific failure mode: a parent node gets demoted back to
  Tentative (or was never properly validated) AFTER a child was already
  promoted to Integrated/Validated. The child's status looks clean but the
  epistemic ground beneath it has been pulled out. The chain is structurally
  intact — no broken links — but hollow.

  'lattice validate' will NOT catch this. This command exists specifically
  to find it.

  For each hollow node, the output lists the exact weak-link ancestors so
  you know what to fix. The resolution is always one of:
    a) Re-validate the weak-link ancestor (if the chain is actually sound)
    b) Demote the hollow node back to Tentative/Hypothesis until the chain
       is repaired (lattice update <slug> --status "Tentative/Hypothesis")

  A purge agent should run this alongside 'lattice validate' on every cycle.
  Exit code 1 if any hollow chains are found, 0 if the vault is clean.

OUTPUT:
  Default (TOON/JSON): array of { slug, title, level, weak_links: [...] }
  --table: human-readable summary per hollow node

GOLDEN EXAMPLES:

  1. Check for hollow chains (purge agent daily cycle):
     $ lattice query hollow-chains
     # Exit 0 → all validated chains are sound
     # Exit 1 → read output, demote or repair each listed node

  2. Parse programmatically to get slugs needing demotion:
     $ lattice query hollow-chains --json | jq '.[].slug'

  3. Human review at terminal:
     $ lattice query hollow-chains --table
`,
    );

  hollowCmd.action(async () => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const nodes = await loadAllNodes(vaultPath);
      const results = findHollowChains(nodes);

      if (format === "table") {
        if (results.length === 0) {
          process.stdout.write("All validated chains are sound. No hollow chains found.\n");
        } else {
          const lines: string[] = [
            `${results.length} hollow chain(s) found:\n`,
          ];
          for (const r of results) {
            lines.push(`${r.level}: ${r.title}`);
            lines.push(`  slug: ${r.slug}`);
            lines.push(`  weak links:`);
            for (const w of r.weak_links) {
              lines.push(`    ${w.level}: "${w.title}"  (${w.slug})`);
            }
            lines.push("");
          }
          process.stdout.write(lines.join("\n") + "\n");
        }
      } else {
        const output = format === "json"
          ? JSON.stringify(results, null, 2)
          : encode(results);
        process.stdout.write(output + "\n");
      }

      if (results.length > 0) {
        process.exit(EXIT.VALIDATION_ERROR);
      }
    } catch (err) {
      handleError(err);
    }
  });

  // ─── related ───────────────────────────────────────────────────────
  const relatedCmd = new Command("related")
    .description("Find related nodes via multi-hop graph walk in both directions")
    .argument("<query>", "Partial slug, tag name, or title keyword to seed the search")
    .option("--limit <n>", "Maximum results to return (default: 5)", "5")
    .option("--depth <n>", "Maximum hops in each direction (default: 3)", "3")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Finds knowledge related to a topic by walking the graph in both directions
  from one or more entry-point seeds, then scoring every discovered node.

  This is not a keyword search. It is a graph traversal. It finds nodes that
  are epistemically connected to your query — nodes that share ancestors,
  nodes that build on the same foundations, nodes that depend on the same
  principles — even if they share no tag and no keyword with the query.

HOW IT WORKS:

  1. ENTRY POINTS — resolve <query> to seeds (stops at first successful match):
       a) Slug match (partial/substring) → single seed node
       b) Tag match  → every node tagged with that name as seeds
       c) Title keyword match → matching nodes as seeds

  2. GRAPH WALK — from each seed, walk up to --depth hops in both directions:
       down: follows reduces_to toward bedrock
             "what is this grounded in?"
       up:   follows incoming links toward dependents
             "what else is built on top of this?"

  3. SCORING — each discovered node is scored by:
       reach_count × 2.0   nodes reachable from multiple seeds are
                           connective tissue between knowledge clusters
       1.0 / min_distance  closer neighbours score higher
       +0.5 if validated   prefer grounded knowledge
       +0.3 if application most actionable level
       +0.2 if principle   second most actionable

  4. RETURNS top --limit results sorted by score descending.

WHY THIS FINDS THINGS TAG SEARCH MISSES:
  Two principles about completely different topics may both reduce to the
  same axiom. They share no tag, no keyword — but they are in the same
  knowledge cluster. This command finds that connection. The graph walk
  surfaces the connective tissue; scoring ensures the most relevant and
  actionable nodes rise to the top.

OUTPUT:
  Each result includes:
    slug, title, level, status, score, reach_count, min_distance
    relationship — how this node connects to the entry point:
                   "ancestor"  it's in your foundation (reached going down)
                   "dependent" it's built on your entry point (reached going up)
                   "sibling"   shares a common ancestor (path went down then up)
                   Multiple values possible if reachable via different path shapes.
    path        — intermediate nodes on the shortest path from seed to this node.
                  Empty if distance=1. Expand this to understand WHY it was surfaced.
  --table: ranked list with relationship, distance, and path shown inline

GOLDEN EXAMPLES:

  1. Agent memory lookup during a discussion about deployment risk:
     $ lattice query related "deploy" --table
     # Finds: principles about testing, applications about CI, axioms about
     # determinism — all epistemically connected to deployment

  2. Explore everything connected to a specific node:
     $ lattice query related untested-code-will-exhibit --limit 10

  3. Enter via tag (all nodes tagged 'risk' become seeds):
     $ lattice query related risk --depth 2

  4. Machine-readable for agent consumption:
     $ lattice query related "rewrite vs refactor" --json
`,
    );

  relatedCmd.action(async (query: string, opts) => {
    try {
      const parentOpts = resolveParentOpts(cmd);
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const limit = Math.max(1, parseInt(opts.limit as string, 10) || 5);
      const depth = Math.max(1, parseInt(opts.depth as string, 10) || 3);

      const nodes = await loadAllNodes(vaultPath);
      const incomingLinks = buildIncomingLinks(nodes);

      // ── Entry point resolution ──────────────────────────────────
      let entryPoints: string[] = [];
      let entryMethod = "";

      // 1. Slug match
      try {
        const slug = resolveNodeSlug(query, nodes);
        entryPoints = [slug];
        entryMethod = `slug match: "${slug}"`;
      } catch {
        // 2. Tag match
        const tagLower = query.toLowerCase().trim();
        const tagMatches = Array.from(nodes.values())
          .filter((n) => n.tags.includes(tagLower))
          .map((n) => n.slug);

        if (tagMatches.length > 0) {
          entryPoints = tagMatches;
          entryMethod = `tag match: "${tagLower}" (${tagMatches.length} seeds)`;
        } else {
          // 3. Title substring match
          const titleLower = query.toLowerCase().trim();
          const titleMatches = Array.from(nodes.values())
            .filter((n) => n.title.toLowerCase().includes(titleLower))
            .map((n) => n.slug);

          if (titleMatches.length > 0) {
            entryPoints = titleMatches;
            entryMethod = `title match: "${query}" (${titleMatches.length} seeds)`;
          }
        }
      }

      if (entryPoints.length === 0) {
        throw new LatticeError(
          `No entry points found for "${query}". Try a partial slug, a tag name, or a title keyword.`,
          EXIT.BAD_INPUT,
        );
      }

      const results = findRelatedNodes(entryPoints, nodes, incomingLinks, depth, limit);

      if (format === "table") {
        if (results.length === 0) {
          process.stdout.write(`Entry: ${entryMethod}\nNo related nodes found within ${depth} hops.\n`);
        } else {
          const lines: string[] = [
            `Entry: ${entryMethod}`,
            `Related nodes (top ${results.length}, depth=${depth}):\n`,
          ];
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const rel = r.relationship.join("+");
            const validated = r.status === "Integrated/Validated" ? "✓" : "~";
            lines.push(
              `${i + 1}. [score ${r.score}] ${validated} ${r.level}: ${r.title}`,
            );
            lines.push(`   ${r.slug}`);
            lines.push(`   relationship=${rel}  distance=${r.min_distance}  reach=${r.reach_count}`);
            if (r.path.length > 0) {
              lines.push(`   via: ${r.path.map((p) => `${p.level}(${p.title})`).join(" → ")}`);
            }
          }
          process.stdout.write(lines.join("\n") + "\n");
        }
      } else {
        const output_obj = { entry: entryMethod, results };
        const output = format === "json"
          ? JSON.stringify(output_obj, null, 2)
          : encode(output_obj);
        process.stdout.write(output + "\n");
      }
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
  cmd.addCommand(hollowCmd);
  cmd.addCommand(relatedCmd);

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
