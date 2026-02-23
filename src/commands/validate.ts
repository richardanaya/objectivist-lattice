import { Command } from "commander";
import { unlink } from "node:fs/promises";
import { resolveVaultPath, requireVault } from "../core/vault.js";
import { loadAllNodes } from "../core/node.js";
import { loadTags } from "../core/tags.js";
import { validateGraph } from "../core/graph.js";
import { resolveFormat, formatValidationResult } from "../util/format.js";
import { EXIT } from "../core/constants.js";
import { handleError } from "../util/cli-helpers.js";

export function makeValidateCommand(): Command {
  const cmd = new Command("validate");

  cmd
    .description("Full integrity check on the lattice vault")
    .option(
      "--fix-auto",
      "Auto-delete Tentative nodes >14d with empty reduces_to",
    )
    .option(
      "--dry-run",
      "With --fix-auto: show what would be deleted without actually deleting",
    )
    .option("--quiet", "Exit code only (0=clean, 1=issues found)")
    .addHelpText(
      "after",
      `
WHAT THIS DOES:
  Runs a complete integrity audit on every node in the vault. This is
  the epistemic health check — it answers: "Is my knowledge base
  internally consistent, or are there floating abstractions, broken
  chains, or abandoned drafts rotting in the corners?"

  An LLM agent should run this at the START of every session and after
  any batch of changes. Think of it as "compile your knowledge base."
  Exit code 0 means the lattice is clean. Exit code 1 means something
  needs attention.

CHECKS PERFORMED:
  - Broken links: reduces_to targets that do not exist as files
  - Level mismatches: a principle reducing to another principle, etc.
  - Cycles: circular reduction chains (A reduces to B reduces to A)
  - Rogue tags: tags on nodes that are not in the master tags.json
  - Missing reductions: principle or application nodes with no reduces_to links
    (these are floating abstractions — the thing the lattice exists to prevent)
    Note: axioms and percepts are bedrock — empty reduces_to is correct for them.
  - Stale tentatives: Tentative/Hypothesis nodes older than 14 days
    (if you have not grounded a belief in two weeks, it is probably noise)

FLAGS:
  --fix-auto   Auto-delete stale Tentatives (>14d) that have ZERO reduces_to.
               These are abandoned drafts with no evidence at all.
               Tentatives with partial chains are flagged but NOT deleted.
  --dry-run    With --fix-auto: show what WOULD be deleted, without deleting.
  --quiet      Suppress output. Exit code only (0=clean, 1=issues).

OUTPUT:
  Default (TOON): { total_nodes, issues_found, issues: [...], deleted, time_ms }
  --json: same as JSON object
  --table:
    ✓ 4,872 nodes scanned
    ✓ 0 broken links
    ⚠ 3 stale Tentative(s) >14d
    Total: 0.41s

GOLDEN EXAMPLES:

  1. Morning health check (start of every agent session):
     $ lattice validate
     # Exit 0 → proceed with confidence
     # Exit 1 → read the issues, fix them before doing anything else

  2. After a batch of adds, verify nothing is broken:
     $ lattice validate --quiet && echo "clean" || echo "FIX ISSUES"

  3. Clean up abandoned drafts:
     $ lattice validate --fix-auto --dry-run   # preview first
     $ lattice validate --fix-auto              # then actually delete

  4. Parse validation results programmatically:
     $ lattice validate --json
     # Returns: { "total_nodes": 487, "issues_found": 2, "issues": [...] }
`,
    );

  cmd.action(async (opts) => {
    try {
      const parentOpts = cmd.parent?.opts() ?? {};
      const vaultPath = resolveVaultPath(parentOpts.vault ?? ".");
      await requireVault(vaultPath);
      const format = resolveFormat(parentOpts);

      const startTime = Date.now();

      const nodes = await loadAllNodes(vaultPath);
      const masterTags = await loadTags(vaultPath);
      let issues = validateGraph(nodes, masterTags);

      // --fix-auto: delete stale tentatives with no reduction chain
      let deletedCount = 0;
      if (opts.fixAuto) {
        const staleTentatives = issues.filter(
          (i) => i.type === "stale_tentative",
        );
        for (const issue of staleTentatives) {
          const node = nodes.get(issue.slug);
          const isBedrockNode = node && (node.level === "percept" || node.level === "axiom");
          if (node && !isBedrockNode && node.reduces_to.length === 0) {
            if (opts.dryRun) {
              process.stderr.write(
                `Would delete: ${node.filePath}\n`,
              );
              deletedCount++;
            } else {
              try {
                await unlink(node.filePath);
                nodes.delete(issue.slug);
                deletedCount++;
              } catch {
                // Ignore delete failures
              }
            }
          }
        }

        // Re-validate after deletions (skip if dry-run)
        if (deletedCount > 0 && !opts.dryRun) {
          issues = validateGraph(nodes, masterTags);
        }
      }

      const timeMs = Date.now() - startTime;

      if (opts.quiet) {
        process.exit(issues.length === 0 ? EXIT.SUCCESS : EXIT.VALIDATION_ERROR);
      }

      const output = formatValidationResult(
        nodes.size,
        issues,
        format,
        deletedCount,
        timeMs,
      );
      process.stdout.write(output + "\n");

      if (issues.length > 0) {
        process.exit(EXIT.VALIDATION_ERROR);
      }
    } catch (err) {
      handleError(err);
    }
  });

  return cmd;
}
